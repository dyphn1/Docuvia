/** Minimal structural types for the subset of the LSP wire protocol this provider speaks — not a
 *  full port of `vscode-languageserver-protocol` (deliberately not a dependency; see
 *  `lsp-json-rpc-client.ts`'s doc comment). */
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

/** Hierarchical `textDocument/documentSymbol` result shape (LSP 3.10+, what
 *  `typescript-language-server` returns). A flat `SymbolInformation[]` response (older/rarer) is
 *  normalized into this shape with `children: undefined` before use — see
 *  `normalizeDocumentSymbols` in `typescript-lsp-edge-provider.ts`. */
export interface LspDocumentSymbol {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

/** The (rarer) flat shape some servers return instead of `LspDocumentSymbol[]`. */
export interface LspSymbolInformation {
  name: string;
  kind: number;
  location: LspLocation;
}
