import { parentPort } from "worker_threads";
import { Parser, Language, type Node, type Tree } from "web-tree-sitter";
import * as path from "path";
import * as fs from "fs";
import { resolveWasmPath } from "./resolve-wasm-path.js";
import type { LanguageProvider, LanguageRegistry } from "@workspace/ast-core";
import {
  parseImportDescriptors,
  loadDefaultRegistry,
} from "@workspace/ast-core";
import {
  IpcLoggerClient,
  SUPPORTED_LANGUAGES,
  type AstDeclaredTypeLanguage,
  type AstExportKind,
  type AstDeclaredTypeFacts,
  type SupportedLanguage,
} from "@workspace/contracts";
import { AstMessages, AstNodeTypes } from "./ast-constants.js";
import { extractDeclaredTypeFacts } from "./declared-type-facts.js";
import {
  collectClassNodes,
  collectFunctionNodes,
  collectVariableNodes,
  findEnclosingContainerName,
  resolveCallableName,
} from "./tier-a-declaration-index.js";
export {
  collectFunctionNodes,
  resolveCallableName,
} from "./tier-a-declaration-index.js";

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
    /** Exported variable declarators (`export const X = ...`) — TS/JS only today (issue #192
     *  gap 1). Function-valued initializers (arrow functions / function expressions) are
     *  excluded: they are already indexed as functions via `functions`. */
    variables?: Array<{
      name: string;
      startLine: number;
      endLine: number;
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
      /** Issue #192 decomposition of the callee expression -- see `getCalleeEvidence`. */
      calleeName?: string;
      receiverText?: string;
      calleeKind?: "bare" | "member" | "this" | "arg-chain" | "computed";
    }>;
    implements?: Array<{ sourceClass: string; targetInterface: string }>;
    extends?: Array<{ sourceClass: string; targetClass: string }>;
    /** Optional explicit TypeScript/JavaScript syntax facts; not a resolution or proof. */
    declaredTypeFacts?: AstDeclaredTypeFacts;
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

/**
 * Normalizes the many capture shapes the per-language `calls` queries produce into "the
 * callee expression":
 * - TS/JS/Go/Rust/C++/Python capture the callee expression *directly* (`@call` sits on the
 *   bracketed `[identifier | member_expression]` alternation inside `function:`), so the
 *   captured node IS the callee -- it carries none of the fields below and falls through to
 *   itself.
 * - Ruby (`method:`), Java (`name:`), PHP (`name:`) capture the bare callee identifier field.
 * - C# captures whole call nodes (`invocation_expression` / `object_creation_expression`),
 *   which need unwrapping to their `expression:` / `type:` child.
 */
function unwrapToCalleeExpression(node: Node): Node {
  return (
    node.childForFieldName("function") ||
    node.childForFieldName("expression") || // C# invocation_expression
    node.childForFieldName("type") || // C# object_creation_expression (`new Foo()` -> Foo)
    node.childForFieldName("name") ||
    node.childForFieldName("method") ||
    node
  );
}

/**
 * Issue #192 root-cause fix: decomposes a call site's callee into the evidence name-based
 * resolution actually needs, instead of persisting one opaque raw string. `target_function`
 * keeps carrying the (whitespace-normalized) full expression for Tier B seeding and #217's
 * impact fallback; the decomposition answers:
 *
 * - `calleeName` — terminal callee identifier (`doSomething` of `service.doSomething()`),
 *   what ScopeResolver's bare-name model matches against. Before this change the raw string
 *   including the receiver was persisted, making every OOP-style call structurally
 *   unmatchable -- the single largest cause of the ~12.8% distinct-target resolution rate.
 * - `receiverText` — receiver expression (`service`, `this.logger`), kept as evidence for
 *   import-binding receiver resolution (ScopeResolver.resolveMemberCall).
 * - `calleeKind` — shape classifier. `'arg-chain'` (receiver is itself an invocation result,
 *   e.g. `expect(x).toEqual`, `vi.fn().mockResolvedValue`) and `'computed'` (`obj[expr]()`)
 *   are structurally unresolvable by name matching; classifying them lets the health-rate
 *   denominators exclude them instead of counting them as failures (~51% of the unresolved
 *   distinct targets in this repo's own graph were arg-chain junk from mock chains).
 *
 * Language-generic by construction: for any `receiver.callee` shape the callee expression's
 * rightmost named child is the callee identifier and the second-to-last is the receiver
 * (TS/JS nested `member_expression`, Go `selector_expression`, Rust/C++ `field_expression`,
 * Python `attribute`). A bare identifier has no usable second child -> `'bare'`.
 */
export function getCalleeEvidence(node: Node): {
  targetFunction: string;
  calleeName?: string;
  receiverText?: string;
  calleeKind?: "bare" | "member" | "this" | "arg-chain" | "computed";
} {
  const callee = unwrapToCalleeExpression(node);

  const children = callee.namedChildren;
  const terminal = children[children.length - 1];
  const receiver =
    children.length >= 2 ? children[children.length - 2] : undefined;

  // Bare identifier call (`foo()`), or a grammar whose query already captured the callee
  // identifier directly (Java `name:`, PHP `name:`, Ruby `method:`).
  if (!terminal || !receiver) {
    return {
      targetFunction: normalizeCallText(callee.text),
      calleeName: callee.text,
      calleeKind: "bare",
    };
  }

  if (!CALLEE_IDENTIFIER_NODE_TYPES.has(terminal.type)) {
    // Computed access (`obj[expr]()`) -- no static callee name to match on.
    return {
      targetFunction: normalizeCallText(callee.text),
      calleeKind: "computed",
    };
  }

  const calleeName = terminal.text;
  const receiverText = receiver.text;

  // Invocation-result receivers (`expect(x).toEqual`, `vi.fn().mockResolvedValue`,
  // `new Date().toISOString`) -- the receiver's runtime type is the call's return value,
  // unknowable by name matching. A '(' anywhere in the receiver text catches both direct
  // call receivers and deeper chains (`vi.fn().mock.calls[0]`) in one conservative test.
  if (receiverText.includes("(")) {
    return {
      targetFunction: normalizeCallText(callee.text),
      calleeName,
      receiverText,
      calleeKind: "arg-chain",
    };
  }

  return {
    targetFunction: normalizeCallText(callee.text),
    calleeName,
    receiverText,
    calleeKind:
      receiverText === "this" || receiverText === "super" ? "this" : "member",
  };
}

/** Collapses insignificant whitespace so multi-line call expressions
 *  (`vi\n  .fn()`) persist as one comparable string instead of newline-laced junk
 *  that no exact-match consumer (#217's impact fallback) could ever hit. */
function normalizeCallText(text: string): string {
  return text.replace(/\s+/g, "");
}

const CALLEE_IDENTIFIER_NODE_TYPES = new Set([
  "identifier",
  "property_identifier",
  "field_identifier",
  "shorthand_property_identifier",
  "attribute",
]);

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

/** Shape of a fully-populated `AstParseResponse["data"]` (i.e. the non-optional variant produced once parsing has actually run). */
type AstExtractionResult = NonNullable<AstParseResponse["data"]>;

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
    const evidence = getCalleeEvidence(node);
    calls.push({
      sourceFunction: findEnclosingContainerName(node, functionIds),
      targetFunction: evidence.targetFunction,
      startLine: position.row,
      startColumn: position.column,
      calleeName: evidence.calleeName,
      receiverText: evidence.receiverText,
      calleeKind: evidence.calleeKind,
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
  const variables: NonNullable<AstExtractionResult["variables"]> = [];
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

      collectVariableNodes(tree, provider, variables);

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
    variables,
    calls,
    implements: implementsList,
    extends: extendsList,
    workerSpawns,
    decisions,
  };
}

/** Logs any query pattern that failed to compile, then clears them so a later file of the same
 *  language doesn't re-report the same failure. Drained rather than read because the provider is
 *  reused for the worker's whole lifetime.
 *
 *  Exported for the wiring test: the module-scoped `logger` posts to `parentPort`, which is
 *  null outside a real worker, so this path is otherwise unobservable (same reason
 *  `buildParseResponse` is exported). */
export function reportQueryCompileFailures(
  provider: LanguageProvider,
  language: SupportedLanguage,
): void {
  for (const failure of provider.drainQueryCompileFailures?.() ?? []) {
    logger.error(AstMessages.QUERY_COMPILE_FAILED, {
      language,
      kind: failure.kind,
      pattern: failure.pattern,
      message: failure.message,
    });
  }
}

/** Parses `request.code` with the resolved provider/grammar and runs the full AST extraction pass, releasing the tree-sitter tree/parser handles once done. */
function parseAndExtract(
  code: string,
  provider: LanguageProvider,
  langInstance: Language,
  language: SupportedLanguage,
  filePath: string,
): AstExtractionResult {
  const parser = new Parser();
  parser.setLanguage(langInstance);

  // initQueries() is idempotent (DefaultProvider caches compiledQueries after the first call)
  // and the provider instance is reused for every file of this language for the worker's whole
  // lifetime (see getRegistry() above), so this only actually compiles once. A field whose
  // pattern fails to compile against the installed grammar degrades to that field's
  // descendantsOfType fallback (DefaultProvider.compileQuery) rather than throwing.
  provider.initQueries?.(langInstance);
  reportQueryCompileFailures(provider, language);

  const tree = parser.parse(code);
  const data = extractAstData(tree, provider, language);
  const declaredTypeLanguage = getDeclaredTypeLanguage(language, filePath);
  const result =
    tree && declaredTypeLanguage
      ? {
          ...data,
          declaredTypeFacts: extractDeclaredTypeFacts(
            tree.rootNode,
            declaredTypeLanguage,
          ),
        }
      : data;

  if (tree) tree.delete();
  parser.delete();

  return result;
}

function getDeclaredTypeLanguage(
  language: SupportedLanguage,
  filePath: string,
): AstDeclaredTypeLanguage | undefined {
  if (language === SUPPORTED_LANGUAGES.TYPESCRIPT)
    return path.extname(filePath).toLowerCase() === ".tsx"
      ? "tsx"
      : "typescript";
  if (language === SUPPORTED_LANGUAGES.JAVASCRIPT) return "javascript";
  return undefined;
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
    request.filePath,
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
