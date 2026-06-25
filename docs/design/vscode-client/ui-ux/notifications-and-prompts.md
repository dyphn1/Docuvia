# UI/UX: Notifications & Prompts

## Toast Notifications

We use VS Code's native `vscode.window.showInformationMessage`, `showWarningMessage`, and `showErrorMessage` to provide feedback.

**Guidelines:**

- **Prefixing**: All toast messages must start with `Docuvia: ` to clearly identify the source of the notification.
- **Errors**: Provide actionable advice when possible. Example: `"Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."`
- **Success/Info**: Keep it brief and non-intrusive. Example: `"Docuvia: Task delegated to background metabolism."` (see [ADR-008: Asynchronous Metabolism](../../adrs/ADR-008-asynchronous-metabolism.md))
- **Warnings**: Use for recoverable edge cases, such as file size warnings before AST parsing ([ADR-020: Unified Isomorphic AST Microkernel](../../adrs/ADR-020-unified-isomorphic-ast-microkernel.md)) or exceeding context limits ([ADR-009: Token Management](../../adrs/ADR-009-token-management.md)).

## QuickPicks & Input Boxes

Used for gathering user input without blocking the entire window.

**Guidelines:**

- **Placeholders**: Always provide a meaningful `placeHolder` to guide the user (e.g., `e.g. how do other projects handle auth`).
- **Input Validation**: Validate inputs where possible and use `validateInput` to show inline error messages before the user submits.
- **Unobtrusive**: Avoid prompting unnecessarily. If context can be derived automatically (e.g., active editor's workspace folder or selected text), use it instead of prompting.
- **Action Items**: When presenting a list of choices (e.g., [L2 Nodes](../../adrs/ADR-005-knowledge-abstraction-strategy.md)), always include a clear fallback or creation action (e.g., `$(add) Create new node later... (unassigned)`).

## Destructive Actions

- **Explicit Confirmation**: Use explicit warnings (e.g., via `showWarningMessage` with "Overwrite" / "Cancel" buttons) before performing destructive actions like overwriting local SQLite databases ([ADR-014: Database-as-IPC](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md)) or modifying the `docuvia-knowledge` orphan branch ([ADR-017: Orphan Branch Maintenance](../../adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md)). Never overwrite local graph data silently.
