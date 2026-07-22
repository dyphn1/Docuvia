/** Ruby's Tier B LSP provider --
 *  `ruby-lsp`, resolved via the PATH-native strategy
 *  (`resolvePathNativeBinary`, `lsp-binary-resolver-strategies.ts`).
 */
export const RubyLspConstants = {
  BINARY_NAME: "ruby-lsp",
  DEFAULT_ARGS: [] as string[],
  VERSION_FLAG: "--version",
} as const;

export const RUBY_LSP_MESSAGES = {
  binaryUnresolvable:
    "ruby-lsp is not resolvable (not found on PATH) -- install ruby-lsp to enable LSP-precision cross-file edges for Ruby",
  markerFileMissing:
    "no Gemfile or Gemfile.lock found at the workspace root",
} as const;
