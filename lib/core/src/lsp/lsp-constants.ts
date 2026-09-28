/** Wire-level constants for `LspJsonRpcClient` — the `Content-Length` framing every LSP transport
 *  over stdio uses (Language Server Protocol base spec), plus this provider's binary-resolution
 *  and method-name constants. Kept in one file (not scattered magic strings) per project convention. */
export const LspWireConstants = {
  CONTENT_LENGTH_HEADER_PREFIX: "Content-Length: ",
  HEADER_BODY_SEPARATOR: "\r\n\r\n",
  JSON_RPC_VERSION: "2.0",
} as const;

/** LSP-defined transient request failures. A server may return either code while its document or
 * index is changing; the client can safely send the request again. */
export const LspErrorCodes = {
  CONTENT_MODIFIED: -32801,
  SERVER_CANCELLED: -32802,
} as const;

/** Bounded retry policy for transient LSP request failures. The attempt count includes the first
 * request, and the backoff is deliberately short because the caller's timeout remains the overall
 * request budget. */
export const LspRequestRetryConstants = {
  MAX_ATTEMPTS: 3,
  BACKOFF_MS: 25,
} as const;

export const LspMethods = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  SHUTDOWN: "shutdown",
  EXIT: "exit",
  DID_OPEN: "textDocument/didOpen",
  DID_CLOSE: "textDocument/didClose",
  DOCUMENT_SYMBOL: "textDocument/documentSymbol",
  REFERENCES: "textDocument/references",
  DEFINITION: "textDocument/definition",
} as const;

/** LSP `SymbolKind` values this provider cares about (function/method/class/constructor) — the
 *  LSP spec's numeric enum, not something docuvia controls, hence not `as const`-typed like our
 *  own vocabularies; kept here so the containment/dispatch code never repeats the raw numbers. */
export const LspSymbolKinds = {
  NAMESPACE: 3,
  CLASS: 5,
  METHOD: 6,
  CONSTRUCTOR: 9,
  FUNCTION: 12,
  OBJECT: 19,
} as const;

export const LSP_MESSAGES = {
  clientNotRunning: (method: string) =>
    `LSP request "${method}" attempted after the client stopped running`,
  clientStoppedBeforeResponse:
    "LSP client stopped before the server responded to the request",
  requestTimedOut: (method: string, timeoutMs: number) =>
    `LSP request "${method}" timed out after ${timeoutMs}ms`,
  serverExited: (code: number | null, stderrTail?: string) =>
    `LSP server process exited (code=${String(code)}) before responding` +
    (stderrTail ? ` -- stderr: ${stderrTail}` : ""),
  spawnFailed: (command: string, message: string) =>
    `Failed to spawn LSP server "${command}": ${message}`,
  initializeFailed: (message: string) =>
    `LSP server exited before completing its initialize handshake: ${message}`,
  batchTimedOut: (timeoutMs: number) =>
    `Tier B LSP batch exceeded its ${timeoutMs}ms timeout and was aborted`,
  resolutionFailedForFile: (file: string) =>
    `Tier B LSP resolution failed for ${file}`,
  skippedMultiLocationDefinition: (file: string) =>
    `Tier B forward resolution: first definition result for ${file} resolved outside the workspace; falling through to the next in-workspace result`,
  concurrencyClamped: (requested: number, effective: number) =>
    `Tier B LSP batch: maxConcurrentFiles=${requested} clamped to ${effective} (bounded by file count and maxOpenFiles)`,
  processShardsClamped: (requested: number, effective: number) =>
    `Tier B LSP batch: maxProcesses=${requested} clamped to ${effective} (bounded by file count)`,
  processShardsMemoryClamped: (
    requested: number,
    effective: number,
    budgetMb: number,
    estimateMb: number,
  ) =>
    `Tier B LSP batch: maxProcesses=${requested} clamped to ${effective} by memory (${budgetMb}MiB budget / ${estimateMb}MiB per shard)`,
} as const;
