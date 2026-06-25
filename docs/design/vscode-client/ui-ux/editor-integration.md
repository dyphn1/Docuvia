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

1. **Up to 2 decision items**: Each shows the decision's `title` as the label and `status` as the description. Selecting one opens the corresponding `.md` file in the editor via `vscode.workspace.openTextDocument` + `showTextDocument`.
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

The hover provider uses a **UUID regex** (`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i`) rather than word boundaries or symbol names. It activates whenever the cursor lands on a token matching this pattern in a registered file.

### Registered File Scopes

The provider is registered for **two distinct scope groups**:

1. **Source files**: `typescript`, `javascript`, `typescriptreact`, `javascriptreact`, `python`
2. **Docuvia data files**: `yaml` (pattern: `**/.docuvia/*.yaml`) and `markdown` (pattern: `**/.docuvia/l3_decisions/*.md`)

This allows users to hover over UUIDs directly inside `.docuvia/l2_modules.yaml` or an L3 decision file to inspect what the referenced entity is.

### Three-Priority Lookup

When a UUID is found, the provider checks the knowledge store in this priority order:

1. **L3 Decision** (`snapshot.decisions.get(id)`) — shows title, status badge, and a 200-character body preview.
2. **L2 Module** (`snapshot.modules.find(m => m.id === id)`) — shows module name, description, and source paths.
3. **L1 Tag** (`snapshot.tags.find(t => t.id === id)`) — shows tag name and description.

If none match, the hover returns `undefined` (no tooltip shown).

> ⚠️ **CONFLICT — `isTrusted = false` Prevents Command Links**: All `MarkdownString` objects in `DocuviaHoverProvider` set `md.isTrusted = false`. VS Code strips `command:` URI links from untrusted markdown strings for security reasons, so the `[Open Decision](command:docuvia.openDecision?args)` links described above **do not render** in the current implementation. To enable them, `isTrusted` must be changed to `{ enabledCommands: ['docuvia.openDecision'] }` and the `docuvia.openDecision` command must be registered. Both changes are scheduled for Round 2.
