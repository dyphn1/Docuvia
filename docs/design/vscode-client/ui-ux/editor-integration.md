# UI/UX: Editor Integration

## CodeLens (`DocuviaCodeLensProvider`)

- **Purpose**: Provide actionable inline commands directly above relevant code blocks (e.g., extracting decisions from a specific function).
- **UX Guidelines**:
  - Keep titles short and action-oriented (e.g., `$(zap) Extract Decision`).
  - Use VS Code codicons (`$(icon-name)`) to provide visual cues.
  - Only show CodeLens where contextually appropriate (e.g., function, class, or interface definitions) to avoid cluttering the user's editor. Too many CodeLenses cause visual fatigue.

### CodeLens Click Behaviour (`docuvia.showDecisionsForLens`)

When the user clicks a Docuvia CodeLens, the `docuvia.showDecisionsForLens` command is invoked with a `CodeLensDecisionData` argument containing the matched module name and a list of decision IDs associated with that module.

The command presents a `vscode.window.showQuickPick` with the following items:

1. **Up to 2 decision items**: Each shows the decision's `title` as the label and `status` as the description. Selecting one fetches the content via [Database-as-IPC](../../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md) and displays it in a virtual text document or webview panel, replacing the legacy `.md` file approach governed by our [Local-First Architecture](../../../adrs/ADR-002-local-first-architecture.md).
2. **"View all in Chat" option** (only when more than 2 decisions exist): Selecting this opens GitHub Copilot Chat pre-populated with `@docuvia /query <moduleName>`, delegating the full search to the chat participant.

The QuickPick placeholder reads: `"Decisions for module: <moduleName>"`.

## Hover (`DocuviaHoverProvider`)

- **Purpose**: Show knowledge graph context when hovering over known symbols, tags, or references in the code.
- **UX Guidelines**:
  - Use Markdown to format the hover text nicely (e.g., `vscode.MarkdownString`).
  - Include relevant L3 decision titles or brief summaries.
  - Keep it concise. Avoid dumping massive walls of text.
  - Provide actionable links (`[Open Decision](command:docuvia.openDecision?args)`) for deeper reading instead of showing everything inline.

### Hover Trigger Mechanism

The hover provider is migrating from a legacy **UUID regex** approach to using the [WASM / Microkernel AST](../../../adrs/ADR-020-unified-isomorphic-ast-microkernel.md). It now activates whenever the cursor lands on a semantically recognized token to fetch its corresponding graph entity.

### Registered File Scopes

The provider is registered for **source files** (e.g., `typescript`, `javascript`, `typescriptreact`, `javascriptreact`, `python`).

_Note: The legacy behavior of registering `yaml` and `markdown` under `.docuvia/` is obsolete. Under the [Local-First Architecture](../../../adrs/ADR-002-local-first-architecture.md) and [Orphan Branch / Maintenance](../../../adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md) patterns, data is stored locally in SQLite and synchronized via the `docuvia-knowledge` orphan branch, not as local workspace YAML/MD files._

### Three-Priority Lookup

When a mapped entity is found, the provider queries the SQLite database via [Database-as-IPC](../../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md) following the [Three-tier knowledge graph](../../../adrs/ADR-005-knowledge-abstraction-strategy.md) abstraction in this priority order:

1. **L3 Decision** — shows title, status badge, and a 200-character body preview.
2. **L2 Module** — shows module name, description, and source paths.
3. **L1 Tag** — shows tag name and description.

If none match, the hover returns `undefined` (no tooltip shown).

> ⚠️ **CONFLICT — `isTrusted = false` Prevents Command Links**: All `MarkdownString` objects in `DocuviaHoverProvider` set `md.isTrusted = false`. VS Code strips `command:` URI links from untrusted markdown strings for security reasons, so the `[Open Decision](command:docuvia.openDecision?args)` links described above **do not render** in the current implementation. To enable them, `isTrusted` must be changed to `{ enabledCommands: ['docuvia.openDecision'] }` and the `docuvia.openDecision` command must be registered. Both changes are scheduled for Round 2.
