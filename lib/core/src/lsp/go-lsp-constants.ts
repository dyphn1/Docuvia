/** Go's Tier B LSP provider --
 *  `gopls`, resolved via the PATH-native strategy
 *  (`resolvePathNativeBinary`, `lsp-binary-resolver-strategies.ts`).
 */
export const GoLspConstants = {
  BINARY_NAME: "gopls",
  DEFAULT_ARGS: [] as string[],
  VERSION_FLAG: "version",
} as const;

export const GO_LSP_MESSAGES = {
  binaryUnresolvable:
    "gopls is not resolvable (not found on PATH) -- install gopls to enable LSP-precision cross-file edges for Go",
  markerFileMissing:
    "no go.mod found at the workspace root",
} as const;
