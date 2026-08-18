import { parentPort } from "worker_threads";
import { Parser, Language, type Node, type Tree } from "web-tree-sitter";
import * as path from "path";
import * as fs from "fs";
import { createHash } from "crypto";
import { resolveWasmPath } from "./resolve-wasm-path.js";
import type {
  SupportedLanguage,
  LanguageProvider,
  LanguageRegistry,
} from "@workspace/ast-core";
import {
  parseImportDescriptors,
  SUPPORTED_LANGUAGES,
} from "@workspace/ast-core";
import { loadDefaultRegistry } from "@workspace/ast-core";
import { IpcLoggerClient, type AstExportKind } from "@workspace/contracts";
import { AstMessages, AstNodeTypes } from "./ast-constants.js";

/**
 * Symbol-level feature hash (STOR-005): a hash of the AST node's own exact source span
 * (`node.text`), independent of the containing file's blob hash. Lets a single-symbol edit
 * produce a one-line JSONL diff for that symbol without touching its untouched siblings' hashes.
 *
 * Inlines the "sha256"/"hex" literals `../constants/encoding.js` also exports rather than
 * importing them: this file is the one place in the codebase that must run standalone inside a
 * `worker_threads` Worker, and a relative `.js`-to-`.ts` sibling import needs a resolve hook that
 * tsx registers on the main thread but does not propagate into workers — a Node/tsx limitation,
 * not a bundling one (dist/ sidesteps it by shipping a fully-compiled worker instead).
 */
function symbolContentHash(node: Node): string {
  return createHash("sha256").update(node.text).digest("hex");
}

/**
 * Worker threads share the host process's stdout/stderr by default, so `console.*` here would
 * corrupt MCP's stdio JSON-RPC stream exactly like it would in the main thread (see
 * docs/gitbook/architecture/logging-architecture.md). A live `ILogger` callback can't cross the
 * `postMessage` structured-clone boundary, so unexpected crashes are reported through the
 * standard IPC Logger Protocol instead (see
 * docs/gitbook/guidelines/playbook-ipc-logging.md) — `AstWorkerPool` routes it back to its own
 * injected logger via `IpcLogRouter`.
 */
const logger = new IpcLoggerClient((message) =>
  parentPort?.postMessage(message),
);

process.on("uncaughtException", (err) => {
  logger.error(AstMessages.WORKER_UNCAUGHT_EXCEPTION, {
    error: err instanceof Error ? err.message : String(err),
  });
});
process.on("unhandledRejection", (err) => {
  logger.error(AstMessages.WORKER_UNHANDLED_REJECTION, {
    error: err instanceof Error ? err.message : String(err),
  });
});

export interface AstParseRequest {
  taskId: string;
  filePath: string;
  code: string;
  language: SupportedLanguage;
}

export interface ImportDescriptor {
  localName: string;
  originalName: string;
  modulePath: string;
}

export interface AstParseResponse {
  taskId: string;
  success: boolean;
  error?: string;
  data?: {
    imports: ImportDescriptor[];
    exports: Array<{ name: string; type: AstExportKind }>;
    functions: Array<{
      name: string;
      startLine: number;
      endLine: number;
      contentHash?: string;
      containerName?: string; // NEW — the enclosing class/struct name, or undefined for a top-level function
    }>;
    classes: Array<{
      name: string;
      startLine: number;
      endLine: number;
      methods: string[];
      contentHash?: string;
    }>;
    calls: Array<{
      sourceFunction: string;
      targetFunction: string;
      /** 0-based source position of the call-site's callee expression start (matches Tier A's own
       *  `startLine`/`startPosition` convention). The seed Tier B forward resolution (issue #11
       *  plan A, Slice 2) issues `textDocument/definition` at this position per call site to
       *  resolve the callee precisely -- see
       *  forward-tier-b-edge-resolution-plan.md Slice 1. */
      startLine: number;
      startColumn: number;
    }>;
    implements?: Array<{ sourceClass: string; targetInterface: string }>;
    extends?: Array<{ sourceClass: string; targetClass: string }>;
    /**
     * `new Worker(<path>)` spawn sites (TS/JS only — see `WORKER_SPAWN_LANGUAGES`), one per
     * resolved spawn call, attributing it to its enclosing function like `calls` does.
     * `persist-ast-graph.ts` resolves `targetPath` to a real file and inserts a `DEPENDS_ON`
     * edge from it — the fix for the `ast-worker-pool.ts` -> `ast-worker.ts` false-negative
     * blast-radius gap (dynamic `worker_threads` spawns are invisible to the static
     * imports/calls pipeline, since the target script is a runtime path string, not a static
     * `import`).
     */
    workerSpawns?: Array<{ sourceFunction: string; targetPath: string }>;
    decisions?: string[];
  };
}

let parserInitialized = false;
let registryPromise: Promise<LanguageRegistry> | null = null;

function getRegistry(): Promise<LanguageRegistry> {
  registryPromise ??= loadDefaultRegistry();
  return registryPromise;
}

// Worker-lifetime cache for loaded tree-sitter grammars, keyed by the resolved wasmPath
// (deterministic per language -- see resolveWasmPath()). Language.load() is a real WASM
// dynamic-library load (WebAssembly.instantiate + relocation into the shared runtime's
// Table/Memory), not a cheap call -- reloading the same grammar per file (the pre-existing
// behavior) is pure waste once a worker has already loaded it once. Mirrors registryPromise's
// own memoization shape immediately above. web-tree-sitter's Language class has no
// delete()/dispose method (verified against the installed 0.25.10 type defs), so there is
// nothing to release even if this cache were bounded -- see
// docs/ai_plans/implement_wasm-language-load-cache.md §2.1 for the full check.
const languageCache = new Map<string, Promise<Language>>();

function getLanguage(wasmPath: string): Promise<Language> {
  let cached = languageCache.get(wasmPath);
  if (!cached) {
    cached = Language.load(wasmPath);
    languageCache.set(wasmPath, cached);
  }
  return cached;
}

/**
 * Re-exported for backward compatibility (existing importer: `ast-worker.fixture.unit.test.ts`)
 * — the real implementation moved to `resolve-wasm-path.ts` so it can also be imported from the
 * main thread (by `SemanticDiffAnalyzerService`) without pulling in this file's
 * `worker_threads`-only side effects (`parentPort?.on(...)`, process-level
 * `uncaughtException`/`unhandledRejection` handlers). See that file's doc comment for why.
 */
export { resolveWasmPath };

/** Regex fallback for imports so graph edges still work when WASM fails to load (e.g. in tests). */
function extractFallbackImports(code: string): ImportDescriptor[] {
  const fallbackImports: ImportDescriptor[] = [];
  const importMatches = code.matchAll(
    /import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g,
  );
  for (const match of importMatches) {
    fallbackImports.push({
      localName: match[1].trim(),
      originalName: match[1].trim(),
      modulePath: match[2],
    });
  }
  return fallbackImports;
}

function getNodeName(node: Node): string {
  return (
    node.childForFieldName("name")?.text ||
    node.descendantsOfType("identifier")[0]?.text ||
    AstMessages.ANONYMOUS_NAME
  );
}

/**
 * For anonymous callables (arrow_function/function_expression with no own name), resolve
 * the binding name from the nearest enclosing variable_declarator / assignment_expression /
 * pair (object property) / public_field_definition (class field arrow method). Returns
 * "anonymous" for truly unbound cases (IIFEs, bare callback arguments).
 *
 * Named nodes (function_declaration, method_definition) already have a "name" field, so the
 * fast path below returns the same result getNodeName() would — safe to use uniformly for
 * every function-kind node, not just anonymous ones.
 *
 * GRPH-006 follow-up: C/C++'s `function_definition` has no direct "name" field at all — the name
 * sits two levels down, inside `function_declarator`'s own "declarator" field (`identifier` for a
 * free function, `field_identifier` for an inline method, `qualified_identifier` -- scope::name --
 * for an out-of-line one). Verified this was silently returning "anonymous" for every C/C++
 * function before this fix (never previously observed for C++ specifically because
 * `cppConfig`'s functions query didn't even extract methods until the GRPH-006 follow-up fix to
 * `cpp.ts` — this pass surfaced both bugs together).
 */
/** GRPH-006 follow-up: resolves a C/C++ `function_definition`'s name from its declarator-nested
 *  shape (see `resolveCallableName`'s own doc comment) -- `identifier`/`field_identifier` return
 *  their own text directly, `qualified_identifier` (an out-of-line `Class::method`) returns just
 *  its `name` field, not the qualifier. Extracted purely to keep `resolveCallableName`'s own
 *  complexity within budget. */
function resolveDeclaratorNestedName(node: Node): string | undefined {
  const declaratorName = node
    .childForFieldName("declarator")
    ?.childForFieldName("declarator");
  if (!declaratorName) return undefined;
  return declaratorName.type === AstNodeTypes.QUALIFIED_IDENTIFIER
    ? (declaratorName.childForFieldName("name")?.text ??
        AstMessages.ANONYMOUS_NAME)
    : declaratorName.text;
}

export function resolveCallableName(node: Node): string {
  const ownName = node.childForFieldName("name");
  if (ownName) return ownName.text;

  const declaratorName = resolveDeclaratorNestedName(node);
  if (declaratorName) return declaratorName;

  const NAME_BEARING_PARENTS = new Set<string>([
    AstNodeTypes.VARIABLE_DECLARATOR,
    AstNodeTypes.ASSIGNMENT_EXPRESSION,
    AstNodeTypes.PAIR,
    AstNodeTypes.PUBLIC_FIELD_DEFINITION,
  ]);
  let current = node.parent;
  while (current) {
    // An "arguments" ancestor means this callable is itself passed as a call argument
    // (e.g. arr.map(x => x + 1)) rather than being the direct value of a declarator/
    // assignment/property/field. Stop here — climbing further would misattribute the
    // name of the outer binding the call happens to live inside (e.g. `results` in
    // `const results = arr.map(x => x + 1)`) to this unrelated, unbound callback.
    if (current.type === AstNodeTypes.ARGUMENTS) break;
    if (NAME_BEARING_PARENTS.has(current.type)) {
      const nameNode =
        current.childForFieldName("name") ||
        current.childForFieldName("key") ||
        current.childForFieldName("left");
      if (nameNode) return nameNode.text;
    }
    current = current.parent;
  }
  return AstMessages.ANONYMOUS_NAME;
}

/**
 * Extracts just the callee (target function/method name) from a call node.
 * The field holding the callee expression is named differently across
 * grammars ("function" for TS/JS/Python/Rust/Go/C/C++, "name" for Java/PHP,
 * "method" for Ruby) — try the common ones, falling back to the whole
 * node's text if none match.
 */
function getCallTargetText(node: Node): string {
  const callee =
    node.childForFieldName("function") ||
    node.childForFieldName("name") ||
    node.childForFieldName("method");
  return callee?.text ?? node.text;
}

/** Resolves a call-site's *seed position* for Tier B forward resolution (issue #11 plan A,
 *  Finding C): for a bare identifier call (`foo()`), `node` already *is* the identifier and its
 *  own `startPosition` is correct. But for a compound callee -- JS/TS `member_expression`
 *  (`service.doSomething()`), Go `selector_expression`, C++/Rust `field_expression` -- the
 *  `calls` tree-sitter query (see `lib/ast-core/src/languages/*.ts`) captures the *whole*
 *  expression, whose own `startPosition` sits on the receiver (`service`), not the callee
 *  (`doSomething`). `textDocument/definition` must be issued at the callee's own position, or it
 *  resolves the receiver's declaration instead -- an invented edge (IMPT-002). Verified against
 *  real tree-sitter-typescript output (`property` is the correct field name for
 *  `member_expression`, confirmed via a real parse, not assumed) -- see this plan's own
 *  instruction not to copy field names blind.
 *
 *  No-op (falls through to `node.startPosition`, i.e. itself) for languages whose query already
 *  captures the callee identifier directly (Java `name:`, PHP `name:`, Ruby `method:`) or for a
 *  bare identifier call. */
function getCallSitePosition(node: Node): { row: number; column: number } {
  const calleeIdentifier =
    node.childForFieldName("property") || // JS/TS member_expression
    node.childForFieldName("field") || // Go selector_expression / C++/Rust field_expression
    node.childForFieldName("attribute") || // Python attribute
    node.childForFieldName("name") || // defensive; Java/PHP already capture this directly
    node.childForFieldName("method"); // defensive; Ruby already captures this directly
  return (calleeIdentifier ?? node).startPosition;
}

/** Walks up from `node` to find the nearest ancestor present in `containerIds` (function/class nodes already extracted for this file), returning its name, or "anonymous" for top-level (file-scoped) call/implements/extends sites. */
function findEnclosingContainerName(
  node: Node,
  containerIds: Set<number>,
): string {
  let current = node.parent;
  while (current) {
    if (containerIds.has(current.id)) {
      return getNodeName(current);
    }
    current = current.parent;
  }
  return AstMessages.ANONYMOUS_NAME;
}

/** Resolves the base type name whether `node` is itself a `type_identifier` or wraps one one level
 *  deep -- Rust generic impls (`impl<T> Wrapper<T>` -- field is `generic_type`) and Go pointer
 *  receivers (`*Receiver` -- field is `pointer_type`) both need the unwrap; a plain `type_identifier`
 *  field (the common case) is returned as-is. */
function firstTypeIdentifierText(node: Node): string | undefined {
  return node.type === AstNodeTypes.TYPE_IDENTIFIER
    ? node.text
    : node.descendantsOfType(AstNodeTypes.TYPE_IDENTIFIER)[0]?.text;
}

/** GRPH-006 follow-up (Rust): a method's lexical parent is `impl_item`, which `rustConfig.classes`
 *  deliberately excludes (so `findEnclosingContainerName` over `classIds` always returns
 *  "anonymous" for a Rust method) -- the target struct/enum's name lives on the impl block's own
 *  `type` field instead (the Self type, not `trait` -- `impl Trait for Type` still qualifies by
 *  `Type`, the concrete struct, not whichever trait it happens to implement). */
function resolveRustImplContainerName(node: Node): string | undefined {
  let current = node.parent;
  while (current) {
    if (current.type === AstNodeTypes.IMPL_ITEM) {
      const typeField = current.childForFieldName("type");
      return typeField ? firstTypeIdentifierText(typeField) : undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/** GRPH-006 follow-up (Go): a method's receiver type is referenced through its own `receiver:`
 *  field, never as an AST ancestor (`type_declaration` never encloses a `method_declaration`), so
 *  `findEnclosingContainerName` over `classIds` always returns "anonymous" here too -- resolve the
 *  receiver parameter's type directly instead. */
function resolveGoReceiverContainerName(node: Node): string | undefined {
  const receiver = node.childForFieldName("receiver");
  const paramType = receiver?.namedChild(0)?.childForFieldName("type");
  return paramType ? firstTypeIdentifierText(paramType) : undefined;
}

/** GRPH-006 follow-up (C++): an out-of-line `Ret Class::method(){}` definition is never lexically
 *  nested inside its class (inline methods already resolve via the generic ancestor walk once
 *  they're extracted at all -- see `cpp.ts`'s functions-query fix), so its declarator is a
 *  `qualified_identifier` carrying the class name in its own `scope` field instead. Recurses one
 *  level for a nested qualifier (`A::B::method`), taking the innermost (`B`) as the immediate
 *  container -- this scheme only ever tracks one level of containment, matching every other
 *  language here. */
function resolveCppQualifiedContainerName(node: Node): string | undefined {
  const declarator = node.childForFieldName("declarator");
  const inner = declarator?.childForFieldName("declarator");
  if (inner?.type !== AstNodeTypes.QUALIFIED_IDENTIFIER) return undefined;
  const scope = inner.childForFieldName("scope");
  if (!scope) return undefined;
  return scope.type === AstNodeTypes.QUALIFIED_IDENTIFIER
    ? scope.childForFieldName("name")?.text
    : scope.text;
}

/** GRPH-006 follow-up: for a function whose enclosing container the generic ancestor walk
 *  couldn't find (Rust/Go/C++'s deferred gaps -- see the ADR), try each language-specific
 *  resolver in turn. Mutually exclusive by construction (each checks for a node shape only its own
 *  grammar produces -- e.g. only Rust ever has an `impl_item` ancestor), so no explicit language
 *  tag is needed; a language not covered here (or a function with no enclosing container at all)
 *  falls through to `undefined`, unchanged from before this follow-up. */
function resolveDeferredLanguageContainerName(node: Node): string | undefined {
  return (
    resolveRustImplContainerName(node) ??
    resolveGoReceiverContainerName(node) ??
    resolveCppQualifiedContainerName(node)
  );
}

/** Shape of a fully-populated `AstParseResponse["data"]` (i.e. the non-optional variant produced once parsing has actually run). */
type AstExtractionResult = NonNullable<AstParseResponse["data"]>;

/** Extracts class declaration nodes via the provider and appends their summaries to `classes`. Returns the raw nodes so callers can derive id sets for edge extraction. */
function collectClassNodes(
  tree: Tree,
  provider: LanguageProvider,
  classes: AstExtractionResult["classes"],
): Node[] {
  const classNodes = provider.extractClasses(tree.rootNode);
  for (const node of classNodes) {
    classes.push({
      name: getNodeName(node),
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      methods: [],
      contentHash: symbolContentHash(node),
    });
  }
  return classNodes;
}

/** Extracts function/method declaration nodes via the provider and appends their summaries to `functions`. Returns the raw nodes so callers can derive id sets for edge extraction.
 *
 *  `classNodes` (GRPH-006) lets each function's enclosing class/struct be resolved via the same
 *  `findEnclosingContainerName` ancestor walk `collectCallEdges`/`collectImplementsEdges`/
 *  `collectExtendsEdges` already use -- `containerName` is what qualifies this symbol's `node_key`
 *  down the line (`persist-ast-graph.ts`'s `buildQualifiedBaseKey`). `findEnclosingContainerName`'s
 *  "nothing found" sentinel is the literal string `AstMessages.ANONYMOUS_NAME` ("anonymous") --
 *  that means "top-level, outside any class" here, a different meaning than its existing use in
 *  `collectCallEdges` ("outside any function"), so it must be converted to `undefined` rather than
 *  stored as-is (storing it as-is would qualify every top-level function as `file#anonymous.name`).
 *
 *  When the ancestor walk finds nothing, `resolveDeferredLanguageContainerName` (GRPH-006
 *  follow-up) tries Rust/Go/C++'s own non-lexical containment shapes before giving up to
 *  `undefined` -- see that function's own doc comment for why each needs a different mechanism. */
export function collectFunctionNodes(
  tree: Tree,
  provider: LanguageProvider,
  functions: AstExtractionResult["functions"],
  classNodes: Node[],
): Node[] {
  const classIds = new Set(classNodes.map((n) => n.id));
  const functionNodes = provider.extractFunctions(tree.rootNode);
  for (const node of functionNodes) {
    const container = findEnclosingContainerName(node, classIds);
    const containerName =
      container === AstMessages.ANONYMOUS_NAME
        ? resolveDeferredLanguageContainerName(node)
        : container;
    functions.push({
      name: resolveCallableName(node),
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      contentHash: symbolContentHash(node),
      containerName,
    });
  }
  return functionNodes;
}

/** Extracts call-site edges via the provider, attributing each call to its enclosing function (or "anonymous"), up to the 1000-call circuit breaker. */
function collectCallEdges(
  tree: Tree,
  provider: LanguageProvider,
  functionNodes: Node[],
  calls: AstExtractionResult["calls"],
): void {
  const functionIds = new Set(functionNodes.map((n) => n.id));
  const callNodes = provider.extractCalls(tree.rootNode);
  for (const node of callNodes) {
    if (calls.length >= 1000) break; // Circuit breaker limit
    const position = getCallSitePosition(node);
    calls.push({
      sourceFunction: findEnclosingContainerName(node, functionIds),
      targetFunction: getCallTargetText(node),
      startLine: position.row,
      startColumn: position.column,
    });
  }
}

/** Extracts `implements` edges via the provider, if it supports them, attributing each to its enclosing class. */
function collectImplementsEdges(
  tree: Tree,
  provider: LanguageProvider,
  classNodes: Node[],
  implementsList: NonNullable<AstExtractionResult["implements"]>,
): void {
  if (!provider.extractImplements) return;
  const classIds = new Set(classNodes.map((n) => n.id));
  for (const node of provider.extractImplements(tree.rootNode)) {
    implementsList.push({
      sourceClass: findEnclosingContainerName(node, classIds),
      targetInterface: node.text,
    });
  }
}

/** Extracts `extends` edges via the provider, if it supports them, attributing each to its enclosing class. */
function collectExtendsEdges(
  tree: Tree,
  provider: LanguageProvider,
  classNodes: Node[],
  extendsList: NonNullable<AstExtractionResult["extends"]>,
): void {
  if (!provider.extractExtends) return;
  const classIds = new Set(classNodes.map((n) => n.id));
  for (const node of provider.extractExtends(tree.rootNode)) {
    extendsList.push({
      sourceClass: findEnclosingContainerName(node, classIds),
      targetClass: node.text,
    });
  }
}

/** Languages `collectWorkerSpawns` runs against — the reported gap (a `new Worker(...)` spawn
 *  invisible to the static imports/calls pipeline) is TS/JS-specific: `new_expression` is also a
 *  real C++ grammar node (the `new` operator), so gating by language avoids misinterpreting an
 *  unrelated `new Worker(...)` construction in another language as a worker_threads spawn. */
const WORKER_SPAWN_LANGUAGES: ReadonlySet<SupportedLanguage> = new Set([
  SUPPORTED_LANGUAGES.TYPESCRIPT,
  SUPPORTED_LANGUAGES.JAVASCRIPT,
]);

const WORKER_CONSTRUCTOR_NAME = "Worker";
const PATH_MODULE_OBJECT_NAME = "path";
const PATH_RESOLVE_METHOD_NAME = "resolve";
const PATH_JOIN_METHOD_NAME = "join";
const DIRNAME_IDENTIFIER_NAME = "__dirname";

/** True when `node` is a `path.resolve(...)`/`path.join(...)` call expression — the exact idiom
 *  `ast-worker-pool.ts` uses to build a worker script's path from `__dirname`. */
function isPathJoinOrResolveCall(node: Node): boolean {
  if (node.type !== "call_expression") return false;
  const fn = node.childForFieldName("function");
  if (!fn || fn.type !== "member_expression") return false;
  const object = fn.childForFieldName("object")?.text;
  const property = fn.childForFieldName("property")?.text;
  return (
    object === PATH_MODULE_OBJECT_NAME &&
    (property === PATH_RESOLVE_METHOD_NAME ||
      property === PATH_JOIN_METHOD_NAME)
  );
}

/** Extracts the string-literal path segment from a `path.resolve(__dirname, "<literal>")` /
 *  `path.join(__dirname, "<literal>")` call, or undefined if it doesn't reference `__dirname` or
 *  carries no string-literal argument. */
function extractDirnameJoinedLiteral(callNode: Node): string | undefined {
  const args = callNode.childForFieldName("arguments");
  if (!args) return undefined;
  const hasDirname = args.namedChildren.some(
    (n) => n?.type === "identifier" && n.text === DIRNAME_IDENTIFIER_NAME,
  );
  if (!hasDirname) return undefined;
  const literal = args.descendantsOfType("string")[0];
  return literal?.text.replace(/['"]/g, "");
}

/** Bounded same-file scan for `<argText> = path.resolve/join(__dirname, "<literal>")` — the
 *  exact idiom `ast-worker-pool.ts` uses for `this.wPath = path.resolve(__dirname, "./ast-worker.js")`,
 *  needed because the `new Worker(...)` call site references the field/variable, not the literal,
 *  directly. Matches by comparing the assignment's own left-hand-side text against `argText`
 *  verbatim (e.g. both "this.wPath"), so it works uniformly whether the argument is a bare
 *  identifier or a member expression. */
function findDirnameJoinedAssignment(
  tree: Tree,
  argText: string,
): string | undefined {
  for (const assignment of tree.rootNode.descendantsOfType(
    AstNodeTypes.ASSIGNMENT_EXPRESSION,
  )) {
    if (!assignment) continue;
    const left = assignment.childForFieldName("left");
    const right = assignment.childForFieldName("right");
    if (left?.text !== argText || !right || !isPathJoinOrResolveCall(right)) {
      continue;
    }
    const literal = extractDirnameJoinedLiteral(right);
    if (literal) return literal;
  }
  return undefined;
}

/** Resolves `new Worker(<arg>)`'s first argument to a literal relative path: a direct string
 *  literal, or a same-file `path.resolve/join(__dirname, "<literal>")`-assigned field/variable
 *  (the `ast-worker-pool.ts` idiom, via `findDirnameJoinedAssignment`). Returns undefined —
 *  skip silently, no guessing — when neither shape matches. */
function resolveWorkerArgumentPath(
  tree: Tree,
  argNode: Node,
): string | undefined {
  if (argNode.type === "string") {
    return argNode.text.replace(/['"]/g, "");
  }
  if (argNode.type === "identifier" || argNode.type === "member_expression") {
    return findDirnameJoinedAssignment(tree, argNode.text);
  }
  return undefined;
}

/** Extracts `new Worker(<arg>)` spawn sites (TS/JS only, see `WORKER_SPAWN_LANGUAGES`) and
 *  appends a `{sourceFunction, targetPath}` descriptor for each one whose argument resolves to a
 *  literal relative path (`resolveWorkerArgumentPath`), attributing it to its enclosing function
 *  like `collectCallEdges` does. `persist-ast-graph.ts` resolves `targetPath` to a real file and
 *  inserts the corresponding `DEPENDS_ON` edge. */
export function collectWorkerSpawns(
  tree: Tree,
  language: SupportedLanguage,
  functionNodes: Node[],
  workerSpawns: NonNullable<AstExtractionResult["workerSpawns"]>,
): void {
  if (!WORKER_SPAWN_LANGUAGES.has(language)) return;
  const functionIds = new Set(functionNodes.map((n) => n.id));
  for (const node of tree.rootNode.descendantsOfType("new_expression")) {
    if (!node) continue;
    const ctor = node.childForFieldName("constructor");
    if (ctor?.text !== WORKER_CONSTRUCTOR_NAME) continue;
    const args = node.childForFieldName("arguments");
    const firstArg = args?.namedChildren.find((n): n is Node => n !== null);
    if (!firstArg) continue;
    const targetPath = resolveWorkerArgumentPath(tree, firstArg);
    if (!targetPath) continue;
    workerSpawns.push({
      sourceFunction: findEnclosingContainerName(node, functionIds),
      targetPath,
    });
  }
}

/**
 * Runs every provider-driven extraction against a parsed tree (or returns empty results plus a
 * decision note if parsing produced no tree). A single try/catch wraps the whole pass, matching
 * the original inline behavior of recording a `providerQueryFailed` decision instead of throwing
 * when any one extractor misbehaves.
 */
function extractAstData(
  tree: Tree | null,
  provider: LanguageProvider,
  language: SupportedLanguage,
): AstExtractionResult {
  const decisions: string[] = [];
  const imports: ImportDescriptor[] = [];
  const exports: AstExtractionResult["exports"] = [];
  const functions: AstExtractionResult["functions"] = [];
  const classes: AstExtractionResult["classes"] = [];
  const calls: AstExtractionResult["calls"] = [];
  const implementsList: NonNullable<AstExtractionResult["implements"]> = [];
  const extendsList: NonNullable<AstExtractionResult["extends"]> = [];
  const workerSpawns: NonNullable<AstExtractionResult["workerSpawns"]> = [];

  if (tree) {
    decisions.push(AstMessages.parsedViaTreeSitter(tree.rootNode.childCount));

    try {
      const classNodes = collectClassNodes(tree, provider, classes);
      const functionNodes = collectFunctionNodes(
        tree,
        provider,
        functions,
        classNodes,
      );

      const importNodes = provider.extractImports(tree.rootNode);
      imports.push(...parseImportDescriptors(importNodes));

      collectCallEdges(tree, provider, functionNodes, calls);
      collectImplementsEdges(tree, provider, classNodes, implementsList);
      collectExtendsEdges(tree, provider, classNodes, extendsList);
      collectWorkerSpawns(tree, language, functionNodes, workerSpawns);

      decisions.push(AstMessages.QUERIED_VIA_LANGUAGE_PROVIDER);
    } catch (e) {
      decisions.push(
        AstMessages.providerQueryFailed(
          e instanceof Error ? e.message : String(e),
        ),
      );
    }
  }

  return {
    imports,
    exports,
    functions,
    classes,
    calls,
    implements: implementsList,
    extends: extendsList,
    workerSpawns,
    decisions,
  };
}

/** Parses `request.code` with the resolved provider/grammar and runs the full AST extraction pass, releasing the tree-sitter tree/parser handles once done. */
function parseAndExtract(
  code: string,
  provider: LanguageProvider,
  langInstance: Language,
  language: SupportedLanguage,
): AstExtractionResult {
  const parser = new Parser();
  parser.setLanguage(langInstance);

  // initQueries() is idempotent (DefaultProvider caches compiledQueries after the first call)
  // and the provider instance is reused for every file of this language for the worker's whole
  // lifetime (see getRegistry() above), so this only actually compiles once. A field whose
  // pattern fails to compile against the installed grammar degrades to that field's
  // descendantsOfType fallback (DefaultProvider.compileQuery) rather than throwing.
  provider.initQueries?.(langInstance);

  const tree = parser.parse(code);
  const data = extractAstData(tree, provider, language);

  if (tree) tree.delete();
  parser.delete();

  return data;
}

/**
 * Resolves a language provider for `request.filePath` and produces the full parse response,
 * short-circuiting with an empty-but-successful result (plus an explanatory decision note) when
 * no provider is registered for the extension or its wasm grammar can't be located on disk.
 */
export async function buildParseResponse(
  request: AstParseRequest,
): Promise<AstParseResponse> {
  if (!parserInitialized) {
    await Parser.init();
    parserInitialized = true;
  }

  const registry = await getRegistry();
  const ext = path.extname(request.filePath);
  const provider: LanguageProvider | undefined =
    registry.getProviderForExtension(ext);

  if (!provider) {
    return {
      taskId: request.taskId,
      success: true,
      data: {
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        calls: [],
        decisions: [AstMessages.noLanguageProviderForExtension(ext)],
      },
    };
  }

  const { wasmPath, attemptedPaths } = resolveWasmPath(provider.wasm_file);

  if (!fs.existsSync(wasmPath)) {
    return {
      taskId: request.taskId,
      success: true,
      data: {
        imports: extractFallbackImports(request.code),
        exports: [],
        functions: [],
        classes: [],
        calls: [],
        decisions: [
          AstMessages.wasmNotFound(request.language, attemptedPaths.join(", ")),
        ],
      },
    };
  }

  const langInstance = await getLanguage(wasmPath);
  const data = parseAndExtract(
    request.code,
    provider,
    langInstance,
    request.language,
  );

  return {
    taskId: request.taskId,
    success: true,
    data,
  };
}

parentPort?.on("message", async (request: AstParseRequest) => {
  try {
    const response = await buildParseResponse(request);
    parentPort?.postMessage(response);
  } catch (err: any) {
    parentPort?.postMessage({
      taskId: request.taskId,
      success: false,
      error: err.stack || String(err),
    });
  }
});
