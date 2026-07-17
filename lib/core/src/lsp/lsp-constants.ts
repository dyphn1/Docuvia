/** Wire-level constants for `LspJsonRpcClient` — the `Content-Length` framing every LSP transport
 *  over stdio uses (Language Server Protocol base spec), plus this provider's binary-resolution
 *  and method-name constants. Kept in one file (not scattered magic strings) per project convention. */
export const LspWireConstants = {
  CONTENT_LENGTH_HEADER_PREFIX: "Content-Length: ",
  HEADER_BODY_SEPARATOR: "\r\n\r\n",
  JSON_RPC_VERSION: "2.0",
  ENCODING: "utf8",
} as const;

export const LspMethods = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  SHUTDOWN: "shutdown",
  EXIT: "exit",
  DID_OPEN: "textDocument/didOpen",
  DOCUMENT_SYMBOL: "textDocument/documentSymbol",
  REFERENCES: "textDocument/references",
} as const;

/** `typescript-language-server` — the D1 Provider 1 binary (phase1-decision-integration.md §8b).
 *  Resolution order: an explicit override, then `<workspaceRoot>/node_modules/.bin`, then
 *  `npx --no-install` — never bundled with docuvia itself. */
export const TsLspConstants = {
  PACKAGE_NAME: "typescript-language-server",
  NPX_COMMAND: "npx",
  NPX_NO_INSTALL_FLAG: "--no-install",
  STDIO_ARG: "--stdio",
  VERSION_FLAG: "--version",
} as const;

/** LSP `SymbolKind` values this provider cares about (function/method/class/constructor) — the
 *  LSP spec's numeric enum, not something docuvia controls, hence not `as const`-typed like our
 *  own vocabularies; kept here so the containment/dispatch code never repeats the raw numbers. */
export const LspSymbolKinds = {
  CLASS: 5,
  METHOD: 6,
  CONSTRUCTOR: 9,
  FUNCTION: 12,
} as const;

export const LSP_MESSAGES = {
  clientNotRunning: (method: string) =>
    `LSP request "${method}" attempted after the client stopped running`,
  requestTimedOut: (method: string, timeoutMs: number) =>
    `LSP request "${method}" timed out after ${timeoutMs}ms`,
  serverExited: (code: number | null) =>
    `LSP server process exited (code=${String(code)}) before responding`,
  spawnFailed: (command: string, message: string) =>
    `Failed to spawn LSP server "${command}": ${message}`,
  binaryUnresolvable:
    "typescript-language-server is not resolvable (no local node_modules/.bin copy and `npx --no-install` cannot find it) -- install it as a project devDependency to enable LSP-precision cross-file edges",
  nodeModulesMissing:
    "node_modules is missing -- run the project's package manager install first",
  tsconfigMissing: "no tsconfig.json/jsconfig.json found at the workspace root",
  batchTimedOut: (timeoutMs: number) =>
    `Tier B LSP batch exceeded its ${timeoutMs}ms timeout and was aborted`,
} as const;
