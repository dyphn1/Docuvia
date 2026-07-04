> **DEPRECATION NOTICE**: This document describes legacy client-side implementations (`KnowledgeStore`, `TaskRunner`, `CentralServerClient`). Per [ADR-021](../../adrs/ADR-021-shared-core-api-and-presentation-layers.md), these responsibilities have moved to the Shared Core API (`@workspace/core`). This document is pending a rewrite.

> **DEPRECATION NOTICE**: This document describes legacy client-side implementations (`KnowledgeStore`, `TaskRunner`, `CentralServerClient`). Per [ADR-021](../../adrs/ADR-021-shared-core-api-and-presentation-layers.md), these responsibilities have moved to the Shared Core API (`@workspace/core`). This document is pending a rewrite.

# UI/UX: Webview Panels

Docuvia uses Webviews for complex data visualization that cannot be represented in a standard TreeView or text editor.

## Search Results Panel (`SearchResultsPanel`)

- **Activation**: Triggered when `docuvia.search.defaultView` is set to `webview`.
- **UX Goal**: Provide a clear, scannable list of cross-project search results.
- **Theming & Visuals**:
  - Must strictly use VS Code's native Webview CSS variables (`var(--vscode-editor-foreground)`, `var(--vscode-button-background)`, etc.) to ensure the panel matches the user's active theme (Light/Dark/High Contrast).
  - Avoid hardcoding colors.
- **Interaction**:
  - Results should clearly group by [Project, L1 Tags, and L2 Modules](../../adrs/ADR-005-knowledge-abstraction-strategy.md).
  - Snippets should highlight the matching keywords.
  - Clicking a result should ideally navigate to the file or open a detailed view.

> ⚠️ **CONFLICT — Flat List, No Interaction, No Highlighting**: The current `SearchResultsPanel` implementation (`search-results-panel.ts`) diverges from the above spec in three significant ways:
>
> 1. **No grouping**: Results are rendered as a flat list of `<div class="result-card">` elements. There is no grouping by Project, L1 Tag, or L2 Module.
> 2. **No keyword highlighting**: The query term is displayed in the panel header but is not highlighted within result snippets.
> 3. **No click-to-navigate**: The webview is created with `enableScripts: false`, which prevents any JavaScript from running inside the panel. This makes it impossible for the webview to call `acquireVsCodeApi().postMessage(...)` to relay click events back to the extension host. Result cards are therefore purely static and non-interactive.
>
> All three gaps are scheduled for Round 2: enable scripts (with a nonce-based CSP), add grouping logic, add `<mark>` highlighting, and add click-to-chat message handlers.

## Dashboard Panel (`DashboardPanel`)

- **UX Goal**: Give an overview of [Knowledge Graph health](../../adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md), [extraction queues](../../adrs/ADR-008-asynchronous-metabolism.md) (driven by the [AST Microkernel](../../adrs/ADR-020-unified-isomorphic-ast-microkernel.md)), and unassigned decisions.
- **Theming**: Must seamlessly integrate with the VS Code theme ecosystem, utilizing standard padding and typography variables.
- **Responsiveness**: The layout should adapt gracefully to panel resizing or splitting editors.

### Webview Message Protocol

The Dashboard Panel uses a typed message protocol for bidirectional communication between the webview and the extension host.

**Extension → Webview (push)**

| Message type | Payload            | When sent                                                                                                                           |
| ------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `update`     | `DashboardPayload` | On panel open and on every database update event via [Database-as-IPC](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md) |

**Webview → Extension (receive)**

| Message type   | Payload              | Effect                                                                                                                               |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `openDecision` | `{ nodeId: string }` | Opens the specified L3 Decision from the [local SQLite database](../../adrs/ADR-002-local-first-architecture.md) in a virtual editor |
| `openChat`     | _(none)_             | Opens GitHub Copilot Chat pre-populated with `@docuvia`                                                                              |

### `DashboardPayload` Shape

```typescript
interface DashboardPayload {
  tagCount: number;
  moduleCount: number;
  decisionCount: number;
  recentDecisions: Array<{ title: string; status: string; nodeId: string }>;
  topModules: Array<{ name: string; decisionCount: number }>;
  pendingTaskCount: number; // from TaskQueueTreeProvider.getPendingCount()
  inProgressTaskCount: number; // from TaskQueueTreeProvider.getInProgressCount()
  loadedAt: string | null; // ISO timestamp
  workspaceName: string;
}
```

### Path Security Validation (Deprecated by Database-as-IPC)

Previously, before opening a file via an `openDecision` message, the extension host validated that `msg.filePath` started with the workspace root. With the migration to [Database-as-IPC](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md) and [Local-First SQLite](../../adrs/ADR-002-local-first-architecture.md), decisions are no longer stored as `.md` files in the workspace. `openDecision` now takes a `nodeId` instead of a `filePath` to query the SQLite DB directly, rendering file path traversal vulnerabilities moot.

### Real-Time Update Wiring

`DashboardPanel` subscribes to database changes via [Database-as-IPC](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md) instead of an in-memory `store`:

```typescript
const onDidLoadDisposable = dbIPC.onDatabaseUpdate(() => this._pushData(dbIPC.snapshot));
```

The subscription is disposed when the panel is closed (`onDidDispose`), preventing memory leaks.
