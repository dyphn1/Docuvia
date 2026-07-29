/**
 * `node_key` disambiguation, shared between Tier A's AST persister (`persist-ast-graph.ts`,
 * `insertFunctionNodes`/`insertClassNodes`) and Tier B's LSP edge providers
 * (`lsp-edge-provider-base.ts`) -- previously duplicated (Tier A had the real, tested
 * implementation; Tier B built raw `${file}#${name}` keys with no disambiguation at all, so two
 * same-named symbols in one file could get an LSP edge attached to the wrong target or silently
 * dropped as a false "duplicate" -- 2026-07 CLI benchmark finding). Extracted so both call sites
 * can no longer drift apart on the collision rule itself.
 *
 * The base key is `${file}#${name}` and `UNIQUE(project_id, node_key)`, so a second insert under
 * an already-used key would violate that constraint. Disambiguate only on an actual collision
 * (two symbols in the same file sharing a name -- overloaded functions, same-named methods on
 * different classes, multiple anonymous callbacks, ...), preferring the symbol's start line
 * (readable, usually enough) and falling back to a counter for the rare case where even that
 * repeats (e.g. `x.map(() => {}).filter(() => {})` on one line) -- guaranteed unique, so the
 * common non-colliding case keeps its plain `file#name` key.
 *
 * `startLine` must be the same 0-based line number Tier A itself uses (raw tree-sitter
 * `Node.startPosition.row`, per `ast-worker.ts`'s `collectFunctionNodes`/`collectClassNodes` --
 * confirmed 0-based, not 1-based, by reading that code directly rather than assuming) -- LSP's own
 * `Position.line` (`textDocument/documentSymbol`'s `selectionRange.start.line`) is 0-based too, so
 * a Tier B caller can pass it straight through with no conversion.
 *
 * This whole collision-then-disambiguate scheme is order-dependent by construction -- tolerable
 * with one key-assigning path, a recurring source of drift now that a second (Tier B's LSP path)
 * has to predict the same key without seeing Tier A's own insertion order (see
 * `lsp-edge-provider-base.ts`'s `resolveNodeKeyForFile` for how far line/kind-sorting closes that
 * gap, and where it still can't). [GRPH-006](../../../../docs/gitbook/adr/graph/GRPH-006-qualified-symbol-table-node-key.md)
 * proposes replacing this with structurally-qualified keys that remove the order-dependency
 * entirely -- not yet implemented; a materially larger change (AST-plugin containment tracking +
 * a persisted-graph migration + every other `node_key` consumer), not folded into this fix.
 */
export function buildUniqueNodeKey(
  usedNodeKeys: Set<string>,
  baseKey: string,
  startLine: number,
): string {
  if (!usedNodeKeys.has(baseKey)) return baseKey;
  const lineKey = `${baseKey}@L${startLine}`;
  if (!usedNodeKeys.has(lineKey)) return lineKey;
  let n = 2;
  while (usedNodeKeys.has(`${lineKey}#${n}`)) n++;
  return `${lineKey}#${n}`;
}
