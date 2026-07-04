# UI/UX: Webview Panels

Docuvia uses Webviews for complex data visualization that cannot be represented in a standard TreeView or text editor.

## Search Results Panel (`SearchResultsPanel`)

- **Intended activation**: when `docuvia.search.defaultView` is set to `webview` — but nothing in `commands/search.ts` currently constructs or shows this panel (see [Search](../command-palette/search.md)). The panel class itself is fully built and can be used once that wiring exists.
- **Theming**: uses VS Code's native Webview CSS variables (`var(--vscode-editor-foreground)`, etc.).
- **Current implementation** (`search-results-panel.ts`):
  - `enableScripts: true` — scripts run in the panel (an earlier draft of this doc incorrectly stated `false`).
  - **Grouping**: results ARE grouped by `projectName` (`_buildHtml()` builds a `Map<string, CentralSearchResult[]>` keyed by project and renders one `<section class="project-group">` per group).
  - **Keyword highlighting**: implemented in `_buildHtml()`.

## Dashboard Panel (`DashboardPanel`)

- **Goal**: overview of knowledge graph health — tag/module/decision counts, recent decisions, top modules.
- **Theming**: standard VS Code webview padding/typography variables.
- **Source**: `artifacts/vscode-client/src/dashboard-panel.ts`, `artifacts/vscode-client/src/webview/dashboard-messages.ts`, `artifacts/vscode-client/src/webview/dashboard-types.ts`.

### Webview Message Protocol

**Extension → Webview (push)**

| Message type | Payload            | When sent                                                                                           |
| ------------ | ------------------ | --------------------------------------------------------------------------------------------------- |
| `update`     | `DashboardPayload` | Once, when the panel is constructed (`_pushData(snapshotService.getSnapshot())` in the constructor) |

> ⚠️ **No real-time updates**: unlike earlier drafts of this doc claimed, there is no subscription to database change events — the code comment in `dashboard-panel.ts` literally says _"We no longer have `store.onDidLoad`, but we can setup a watcher if desired. For now, it updates when focused or created."_ Counts are frozen after the panel opens; the user must close and reopen it (or trigger whatever creates a new panel instance) to see fresh data.

**Webview → Extension (receive)**

| Message type   | Payload                | Effect                                                                                 |
| -------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `openDecision` | `{ filePath: string }` | Validates `filePath` starts with the workspace root, then opens it as a text document. |
| `openChat`     | _(none)_               | Opens GitHub Copilot Chat pre-populated with `@docuvia`.                               |

### `DashboardPayload` Shape

```typescript
interface DashboardPayload {
  tagCount: number;
  moduleCount: number;
  decisionCount: number;
  recentDecisions: Array<{ title: string; status: string; filePath: string }>;
  topModules: Array<{ name: string; decisionCount: number }>;
  pendingTaskCount: number;
  inProgressTaskCount: number;
  loadedAt: string | null;
  workspaceName: string;
}
```

### Path handling for `openDecision`

`recentDecisions` carries a `filePath`, not a `nodeId` — and `dashboard-messages.ts` still validates that the received `filePath` starts with the workspace root before opening it (`msg.filePath.startsWith(workspaceRoot)`). An earlier draft of this doc claimed this validation was "deprecated by Database-as-IPC" and replaced with a `nodeId`-based lookup — that migration has not happened; the original file-path + prefix-check approach is still what's implemented.
