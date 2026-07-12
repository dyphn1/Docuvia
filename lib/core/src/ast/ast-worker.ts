import { parentPort } from "worker_threads";
import { Parser, Language, type Node } from "web-tree-sitter";
import * as path from "path";
import * as fs from "fs";
import { createHash } from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import type { SupportedLanguage, LanguageProvider, LanguageRegistry } from "@workspace/ast-core";
import { parseImportDescriptors } from "@workspace/ast-core";
import { loadDefaultRegistry } from "@workspace/plugins-ast";
import { IpcLoggerClient } from "@workspace/contracts";
import { ENCODING_HEX, HASH_ALGO_SHA256 } from "../constants/encoding.js";

/**
 * Symbol-level feature hash (STOR-005): a hash of the AST node's own exact source span
 * (`node.text`), independent of the containing file's blob hash. Lets a single-symbol edit
 * produce a one-line JSONL diff for that symbol without touching its untouched siblings' hashes.
 */
function symbolContentHash(node: Node): string {
  return createHash(HASH_ALGO_SHA256).update(node.text).digest(ENCODING_HEX);
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
const logger = new IpcLoggerClient((message) => parentPort?.postMessage(message));

process.on("uncaughtException", (err) => {
  logger.error("AST worker uncaughtException", { error: err instanceof Error ? err.message : String(err) });
});
process.on("unhandledRejection", (err) => {
  logger.error("AST worker unhandledRejection", { error: err instanceof Error ? err.message : String(err) });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

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
    exports: Array<{ name: string; type: "function" | "class" | "variable" }>;
    functions: Array<{ name: string; startLine: number; endLine: number; contentHash?: string }>;
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
 * Resolves the on-disk path of a tree-sitter grammar's .wasm file, trying
 * package.json resolution first (works whether tree-sitter-wasms is hoisted
 * or nested under .pnpm) and falling back to a handful of known workspace
 * layouts otherwise.
 */
export function resolveWasmPath(wasmFile: string): { wasmPath: string; attemptedPaths: string[] } {
  const docuviaRoot = path.resolve(__dirname, "../../../../");
  const attemptedPaths: string[] = [];

  try {
    const packagePath = require.resolve(`tree-sitter-wasms/package.json`, {
      paths: [__dirname, docuviaRoot],
    });
    const wasmPath = path.join(path.dirname(packagePath), "out", wasmFile);
    attemptedPaths.push(wasmPath);
    if (fs.existsSync(wasmPath)) return { wasmPath, attemptedPaths };
  } catch {
    // fall through to explicit path candidates below
  }

  const candidates = [
    path.resolve(docuviaRoot, `node_modules/tree-sitter-wasms/out/${wasmFile}`),
    path.resolve(__dirname, `../../../node_modules/tree-sitter-wasms/out/${wasmFile}`),
    path.resolve(
      docuviaRoot,
      `node_modules/.pnpm/tree-sitter-wasms@0.1.13/node_modules/tree-sitter-wasms/out/${wasmFile}`
    ),
    path.resolve(docuviaRoot, `artifacts/vscode-client/out/wasm/${wasmFile}`),
  ];

  for (const candidate of candidates) {
    attemptedPaths.push(candidate);
    if (fs.existsSync(candidate)) return { wasmPath: candidate, attemptedPaths };
  }

  return { wasmPath: candidates[candidates.length - 1], attemptedPaths };
}

/** Regex fallback for imports so graph edges still work when WASM fails to load (e.g. in tests). */
function extractFallbackImports(code: string): ImportDescriptor[] {
  const fallbackImports: ImportDescriptor[] = [];
  const importMatches = code.matchAll(/import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g);
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
    "anonymous"
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

  const NAME_BEARING_PARENTS = new Set([
    "variable_declarator", // const foo = () => {}
    "assignment_expression", // foo = () => {}
    "pair", // { foo: () => {} }  (object literal property)
    "public_field_definition", // class { foo = () => {} }
  ]);
  let current = node.parent;
  while (current) {
    // An "arguments" ancestor means this callable is itself passed as a call argument
    // (e.g. arr.map(x => x + 1)) rather than being the direct value of a declarator/
    // assignment/property/field. Stop here — climbing further would misattribute the
    // name of the outer binding the call happens to live inside (e.g. `results` in
    // `const results = arr.map(x => x + 1)`) to this unrelated, unbound callback.
    if (current.type === "arguments") break;
    if (NAME_BEARING_PARENTS.has(current.type)) {
      const nameNode =
        current.childForFieldName("name") ||
        current.childForFieldName("key") ||
        current.childForFieldName("left");
      if (nameNode) return nameNode.text;
    }
    current = current.parent;
  }
  return "anonymous";
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
function findEnclosingContainerName(node: Node, containerIds: Set<number>): string {
  let current = node.parent;
  while (current) {
    if (containerIds.has(current.id)) {
      return getNodeName(current);
    }
    current = current.parent;
  }
  return "anonymous";
}

parentPort?.on("message", async (request: AstParseRequest) => {
  try {
    if (!parserInitialized) {
      await Parser.init();
      parserInitialized = true;
    }

    const registry = await getRegistry();
    const ext = path.extname(request.filePath);
    const provider: LanguageProvider | undefined = registry.getProviderForExtension(ext);

    if (!provider) {
      parentPort?.postMessage({
        taskId: request.taskId,
        success: true,
        data: {
          imports: [],
          exports: [],
          functions: [],
          classes: [],
          calls: [],
          decisions: [`No language provider registered for extension ${ext}`],
        },
      });
      return;
    }

    const { wasmPath, attemptedPaths } = resolveWasmPath(provider.wasm_file);

    if (!fs.existsSync(wasmPath)) {
      parentPort?.postMessage({
        taskId: request.taskId,
        success: true,
        data: {
          imports: extractFallbackImports(request.code),
          exports: [],
          functions: [],
          classes: [],
          calls: [],
          decisions: [
            `WASM not found for ${request.language}, AST parsing skipped (Regex fallback used). ` +
              `Tried paths: ${attemptedPaths.join(", ")}`,
          ],
        },
      });
      return;
    }

    const langInstance = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(langInstance);

    // Note: intentionally not calling provider.initQueries() here — some compiled
    // query strings in @workspace/plugins-ast currently fail to parse against the
    // installed grammar (a pre-existing, separate issue). DefaultProvider falls
    // back to its per-language node-type lists (descendantsOfType) when queries
    // aren't compiled, which is what we rely on here.

    const tree = parser.parse(request.code);

    const decisions: string[] = [];
    const imports: ImportDescriptor[] = [];
    const exports: Array<{ name: string; type: "function" | "class" | "variable" }> = [];
    const functions: Array<{
      name: string;
      startLine: number;
      endLine: number;
      contentHash: string;
    }> = [];
    const classes: Array<{
      name: string;
      startLine: number;
      endLine: number;
      methods: string[];
      contentHash: string;
    }> = [];
    const calls: Array<{ sourceFunction: string; targetFunction: string }> = [];
    const implementsList: Array<{ sourceClass: string; targetInterface: string }> = [];
    const extendsList: Array<{ sourceClass: string; targetClass: string }> = [];

    if (tree) {
      decisions.push(`Parsed via web-tree-sitter (nodes: ${tree.rootNode.childCount})`);

      try {
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

        const functionNodes = provider.extractFunctions(tree.rootNode);
        for (const node of functionNodes) {
          functions.push({
            name: resolveCallableName(node),
            startLine: node.startPosition.row,
            endLine: node.endPosition.row,
            contentHash: symbolContentHash(node),
          });
        }

        const importNodes = provider.extractImports(tree.rootNode);
        imports.push(...parseImportDescriptors(importNodes));

        const functionIds = new Set(functionNodes.map((n) => n.id));
        const callNodes = provider.extractCalls(tree.rootNode);
        for (const node of callNodes) {
          if (calls.length >= 1000) break; // Circuit breaker limit
          calls.push({
            sourceFunction: findEnclosingContainerName(node, functionIds),
            targetFunction: getCallTargetText(node),
          });
        }

        const classIds = new Set(classNodes.map((n) => n.id));
        if (provider.extractImplements) {
          for (const node of provider.extractImplements(tree.rootNode)) {
            implementsList.push({
              sourceClass: findEnclosingContainerName(node, classIds),
              targetInterface: node.text,
            });
          }
        }
        if (provider.extractExtends) {
          for (const node of provider.extractExtends(tree.rootNode)) {
            extendsList.push({
              sourceClass: findEnclosingContainerName(node, classIds),
              targetClass: node.text,
            });
          }
        }

        decisions.push("Queried nodes using @workspace/ast-core LanguageProvider");
      } catch (e) {
        decisions.push(
          `ast-core provider query failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    const data = {
      imports,
      exports,
      functions,
      classes,
      calls,
      implements: implementsList,
      extends: extendsList,
      decisions,
    };

    if (tree) tree.delete();
    parser.delete();

    parentPort?.postMessage({
      taskId: request.taskId,
      success: true,
      data,
    });
  } catch (err: any) {
    parentPort?.postMessage({
      taskId: request.taskId,
      success: false,
      error: err.stack || String(err),
    });
  }
});
