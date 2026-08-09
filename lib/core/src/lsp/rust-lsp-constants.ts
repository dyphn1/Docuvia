/** Rust's Tier B LSP provider --
 *  `rust-analyzer`, resolved via the PATH-native strategy
 *  (`resolvePathNativeBinary`, `lsp-binary-resolver-strategies.ts`).
 */
export const RustLspConstants = {
  BINARY_NAME: "rust-analyzer",
  DEFAULT_ARGS: [] as string[],
} as const;

export const RUST_LSP_MESSAGES = {
  binaryUnresolvable:
    "rust-analyzer is not resolvable (not found on PATH, $CARGO_HOME/bin, or ~/.cargo/bin) -- install rust-analyzer to enable LSP-precision cross-file edges for Rust",
  markerFileMissing: "no Cargo.toml found at the workspace root",
} as const;
