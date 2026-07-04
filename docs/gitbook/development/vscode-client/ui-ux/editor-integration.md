# UI/UX: Editor Integration

## CodeLens (`DocuviaCodeLensProvider`)

- **Purpose**: Provide actionable inline commands directly above relevant code blocks.
- **Source**: `artifacts/vscode-client/src/docuvia-code-lens-provider.ts`

### Current behavior

CodeLenses are **module-scoped, not per-symbol**: on open/save, the provider queries `LocalSnapshotService(workspaceRoot).getSnapshot()`, matches the current file's relative path against each L2 module's `source_paths` glob patterns (via `minimatch`), and for every matching module renders **two lenses at the same anchor line**:

1. `◇ L2: <module name> (N L3 decisions)` (or `(Needs decisions)` if none) → command `docuvia.showDecisionsForLens`, passing `{ module, decisions }`.
2. A second lens at the same position, labeled **"Extrapolate Decisions"** → command `docuvia.autoCategorizeDecisions`. Note: this command's current handler (`autoCategorizeDecisionsCommand` in `decision.ts`) is a stub — it just shows an info message _"Auto-categorization is handled by the server ingestion pipeline"_ and does nothing else.

The anchor line is picked by matching the module name against document symbols (class/function/interface names, resolved via `vscode.executeDocumentSymbolProvider`) recomputed on every save/open — if no matching symbol is found, lenses stack at line 0 for each module in snapshot order.

> Note: the provider does **not** restrict itself to the visible viewport — it recomputes anchors and re-matches all modules for the whole file on every open/save. There's no debouncing beyond VS Code's own save/open event timing.

### CodeLens Click Behaviour (`docuvia.showDecisionsForLens`)

Clicking the first lens invokes `docuvia.showDecisionsForLens` with the module and its decisions; see [Add Decision → Related: opening and browsing decisions](../command-palette/add-decision.md#related-opening-and-browsing-decisions) for the exact QuickPick behavior (it opens `docuvia.openDecision` on selection).

## Hover (`DocuviaHoverProvider`)

- **Purpose**: Show knowledge graph context when hovering over a symbol.
- **Source**: `artifacts/vscode-client/src/docuvia-hover-provider.ts`

### Current behavior — Blast Radius & Context, not L1/L2/L3 lookup

The hover provider does **not** look up L3 decisions, L2 modules, or L1 tags by name. Instead, for the word under the cursor, it calls `QueryService(workspaceRoot)` (`@workspace/core`) for two things in parallel:

- **`getImpact(symbol)`** → renders _"Docuvia Blast Radius for `symbol`"_ with up to 5 impacted nodes (`name (type)`), plus a "...and N more" line if truncated.
- **`getContext(symbol)`** → renders _"Docuvia Context for `symbol`"_ with up to 5 **incoming** edges and up to 5 **outgoing** edges (`source_name (source_type)` / `target_name (target_type)`).

If neither call returns data (including on error — failures are silently swallowed), the hover returns `undefined` and no tooltip is shown. There are no `command:` links in the current hover content at all — it's plain rendered text, no "Open Decision" action.

### Registered File Scopes

Registered for source files (`typescript`, `javascript`, `typescriptreact`, `javascriptreact`, `python`, etc.) — not for `.docuvia/` YAML or Markdown, consistent with [Local-First Architecture](../../../adr/ADR-002-local-first-architecture.md) storing everything in SQLite.

## 🚧 Planned (Not Yet Implemented)

The original design specified a different hover experience than what exists today:

- **L3/L2/L1 lookup on hover**: showing decision titles, status, and a content preview for a recognized symbol/tag/module reference (today's hover shows call-graph impact/context instead — a different, already-implemented feature, not a strict subset).
- **Clickable "Open Decision" links inside hover text** (`[Open Decision](command:docuvia.openDecision?args)`) — would require passing `{ enabledCommands: ['docuvia.openDecision'] }` to `MarkdownString.isTrusted` (currently unset, so untrusted/no links are rendered at all).
