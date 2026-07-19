import { ANONYMOUS_SYMBOL_NAME } from "../constants/symbols.js";

/** `Error.name` for `AstWorkerCrashError` — see `docuvia-error.ts`'s `DOCUVIA_ERROR_NAME` for the same convention. */
export const AST_WORKER_CRASH_ERROR_NAME = "AstWorkerCrashError" as const;

/** Tree-sitter node `.type` discriminants `ast-worker.ts`'s `resolveCallableName()` checks against — grammar-level values, not ours to rename. */
export const AstNodeTypes = {
  ARGUMENTS: "arguments",
  VARIABLE_DECLARATOR: "variable_declarator", // const foo = () => {}
  ASSIGNMENT_EXPRESSION: "assignment_expression", // foo = () => {}
  PAIR: "pair", // { foo: () => {} }  (object literal property)
  PUBLIC_FIELD_DEFINITION: "public_field_definition", // class { foo = () => {} }
} as const;

/** Log/error messages and shared literals for the AST parsing pipeline (worker pool + worker + processing service). */
export const AstMessages = {
  PARSE_FAILURE_NO_DETAIL: "parse returned success=false with no error detail",
  PARSE_FAILURE_RESULT: "AST parse returned failure result",
  PARSE_THREW: "AST parse threw (worker crash or rejection)",
  WORKER_UNCAUGHT_EXCEPTION: "AST worker uncaughtException",
  WORKER_UNHANDLED_REJECTION: "AST worker unhandledRejection",
  WORKER_EXITED_DURING_SHUTDOWN:
    "AST worker exited during pool shutdown (expected)",
  WORKER_CRASHED_EXITED: "AST worker crashed/exited",
  WORKER_EXITED_UNEXPECTEDLY: "Worker exited unexpectedly",
  UNKNOWN_FILE: "(unknown file)",
  PARSE_CACHE_HIT: "AST parse cache hit",
  CACHE_METRICS_AND_QUEUE_PERFORMANCE:
    "AST cache metrics and queue performance",
  TASK_TIMED_OUT_TERMINATING:
    "AST worker task timed out — terminating stuck worker",
  QUERIED_VIA_LANGUAGE_PROVIDER:
    "Queried nodes using @workspace/ast-core LanguageProvider",
  ANONYMOUS_NAME: ANONYMOUS_SYMBOL_NAME,
  workerCrashWhileParsing: (filePath: string) =>
    `AST worker crashed while parsing ${filePath}: `,
  taskTimedOutAfterMs: (taskId: string, ms: number) =>
    `AST worker task ${taskId} timed out after ${ms}ms`,
  workerExitedWithCode: (code: number) => `Worker exited with code ${code}`,
  noLanguageProviderForExtension: (ext: string) =>
    `No language provider registered for extension ${ext}`,
  wasmNotFound: (language: string, triedPaths: string) =>
    `WASM not found for ${language}, AST parsing skipped (Regex fallback used). ` +
    `Tried paths: ${triedPaths}`,
  parsedViaTreeSitter: (nodeCount: number) =>
    `Parsed via web-tree-sitter (nodes: ${nodeCount})`,
  providerQueryFailed: (errMessage: string) =>
    `ast-core provider query failed: ${errMessage}`,
} as const;
