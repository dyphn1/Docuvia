/** Go's Tier B LSP provider --
 *  `gopls`, resolved via the PATH-native strategy
 *  (`resolvePathNativeBinary`, `lsp-binary-resolver-strategies.ts`).
 */
export const GoLspConstants = {
  BINARY_NAME: "gopls",
  DEFAULT_ARGS: [] as string[],
} as const;

/** GRPH-006 Go follow-up: gopls names a receiver method's `documentSymbol` entry
 *  `(Receiver).Method` (see `golang-tools/gopls/internal/golang/symbols.go`, where the
 *  `funcSymbol` name is prefixed with the receiver type) and reports it flat at file scope,
 *  with no `children` and the receiver struct reported as kind `Struct` (23), never `Class`.
 *  Tier A keys that same method as `file#containerName.name` (`buildQualifiedBaseKey`), so Tier B
 *  must recover `containerName` from the name itself to emit a key `findNodeIdByNodeKey` matches.
 *  Handles both value (`(A).Handle`) and pointer (`(*B).Visit` → `B.Visit`) receivers, unwrapping
 *  the `*` exactly as Tier A's `resolveGoReceiverContainerName`/`firstTypeIdentifierText` do
 *  (pointer uses the pointee type's identifier). */
export function normalizeGoSymbolName(name: string): string {
  const receiverMatch = /^\((\*?)([^(]*)\)\.(.+)$/.exec(name);
  if (!receiverMatch) return name;
  // `(A).Handle` and `(*B).Visit` both key as container method: `A.Handle` / `B.Visit`
  // — the leading `*` is stripped for pointer receivers, matching how Tier A's
  // `resolveGoReceiverContainerName`/`firstTypeIdentifierText` unwrap `pointer_type`.
  const [, , receiverType, methodName] = receiverMatch;
  return `${receiverType}.${methodName}`;
}

export const GO_LSP_MESSAGES = {
  binaryUnresolvable:
    "gopls is not resolvable (not found on PATH, $GOBIN, $GOPATH/bin, or ~/go/bin) -- install gopls to enable LSP-precision cross-file edges for Go",
  markerFileMissing: "no go.mod found at the workspace root",
} as const;
