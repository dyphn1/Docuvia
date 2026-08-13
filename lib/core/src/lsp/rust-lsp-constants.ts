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
  binaryNotSpawnable:
    "rust-analyzer resolves on PATH but cannot be spawned -- usually a rustup proxy for a component that isn't installed; run `rustup component add rust-analyzer` (or install rust-analyzer) to enable LSP-precision cross-file edges for Rust",
  markerFileMissing: "no Cargo.toml found at the workspace root",
} as const;

/** GRPH-006 (Rust): rust-analyzer reports an impl block as a `documentSymbol` parent of kind
 *  `Object` (19) whose `name` carries the decoration `impl <Type>` (verified live against
 *  rust-analyzer 1.97.1 — the `impl ` prefix is part of the symbol name, not a separate field).
 *  Tier A keys that block's methods as `file#containerName.name` with `containerName` = the impl's
 *  target type (`<Type>`, per `ast-worker.ts`'s `resolveRustImplContainerName` reading the impl's
 *  own `type` field), so Tier B must strip the `impl ` decoration before the container name feeds
 *  a key `findNodeIdByNodeKey` matches. A symbol whose parent isn't an impl block (a top-level
 *  fn, a `impl Trait for Type` block's parent is still named `impl <Type>`-style in rust-analyzer)
 *  has no `impl ` prefix and passes through unchanged. */
export function normalizeRustSymbolName(name: string): string {
  return name.startsWith("impl ") ? name.slice("impl ".length) : name;
}
