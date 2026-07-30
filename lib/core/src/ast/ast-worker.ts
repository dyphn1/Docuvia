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
import { parseImportDescriptors } from "@workspace/ast-core";
import { loadDefaultRegistry } from "@workspace/plugins-ast";
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
    calls: Array<{ sourceFunction: string; targetFunction: string }>;
    implements?: Array<{ sourceClass: string; targetInterface: string }>;
    extends?: Array<{ sourceClass: string; targetClass: string }>;
    decisions?: string[];
  };
}

let parserInitialized = false;
let registryPromise: Promise<LanguageRegistry> | null = null;

function getRegistry(): Promise<LanguageRegistry> {
  registryPromise ??= loadDefaultRegistry();
  return registryPromise;
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
 */
export function resolveCallableName(node: Node): string {
  const ownName = node.childForFieldName("name");
  if (ownName) return ownName.text;

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
 *  stored as-is (storing it as-is would qualify every top-level function as `file#anonymous.name`). */
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
    functions.push({
      name: resolveCallableName(node),
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      contentHash: symbolContentHash(node),
      containerName:
        container === AstMessages.ANONYMOUS_NAME ? undefined : container,
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
    calls.push({
      sourceFunction: findEnclosingContainerName(node, functionIds),
      targetFunction: getCallTargetText(node),
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

/**
 * Runs every provider-driven extraction against a parsed tree (or returns empty results plus a
 * decision note if parsing produced no tree). A single try/catch wraps the whole pass, matching
 * the original inline behavior of recording a `providerQueryFailed` decision instead of throwing
 * when any one extractor misbehaves.
 */
function extractAstData(
  tree: Tree | null,
  provider: LanguageProvider,
): AstExtractionResult {
  const decisions: string[] = [];
  const imports: ImportDescriptor[] = [];
  const exports: AstExtractionResult["exports"] = [];
  const functions: AstExtractionResult["functions"] = [];
  const classes: AstExtractionResult["classes"] = [];
  const calls: AstExtractionResult["calls"] = [];
  const implementsList: NonNullable<AstExtractionResult["implements"]> = [];
  const extendsList: NonNullable<AstExtractionResult["extends"]> = [];

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
    decisions,
  };
}

/** Parses `request.code` with the resolved provider/grammar and runs the full AST extraction pass, releasing the tree-sitter tree/parser handles once done. */
function parseAndExtract(
  code: string,
  provider: LanguageProvider,
  langInstance: Language,
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
  const data = extractAstData(tree, provider);

  if (tree) tree.delete();
  parser.delete();

  return data;
}

/**
 * Resolves a language provider for `request.filePath` and produces the full parse response,
 * short-circuiting with an empty-but-successful result (plus an explanatory decision note) when
 * no provider is registered for the extension or its wasm grammar can't be located on disk.
 */
async function buildParseResponse(
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

  const langInstance = await Language.load(wasmPath);
  const data = parseAndExtract(request.code, provider, langInstance);

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
