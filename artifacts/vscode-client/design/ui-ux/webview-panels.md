# UI/UX: Webview Panels

Docuvia uses Webviews for complex data visualization that cannot be represented in a standard TreeView or text editor.

## Search Results Panel (`SearchResultsPanel`)
- **Activation**: Triggered when `docuvia.search.defaultView` is set to `webview`.
- **UX Goal**: Provide a clear, scannable list of cross-project search results.
- **Theming & Visuals**: 
  - Must strictly use VS Code's native Webview CSS variables (`var(--vscode-editor-foreground)`, `var(--vscode-button-background)`, etc.) to ensure the panel matches the user's active theme (Light/Dark/High Contrast).
  - Avoid hardcoding colors.
- **Interaction**:
  - Results should clearly group by Project, L1 Tags, and L2 Modules.
  - Snippets should highlight the matching keywords.
  - Clicking a result should ideally navigate to the file or open a detailed view.

> ⚠️ **CONFLICT — Flat List, No Interaction, No Highlighting**: The current `SearchResultsPanel` implementation (`SearchResultsPanel.ts`) diverges from the above spec in three significant ways:
> 1. **No grouping**: Results are rendered as a flat list of `<div class="result-card">` elements. There is no grouping by Project, L1 Tag, or L2 Module.
> 2. **No keyword highlighting**: The query term is displayed in the panel header but is not highlighted within result snippets.
> 3. **No click-to-navigate**: The webview is created with `enableScripts: false`, which prevents any JavaScript from running inside the panel. This makes it impossible for the webview to call `acquireVsCodeApi().postMessage(...)` to relay click events back to the extension host. Result cards are therefore purely static and non-interactive.
>
> All three gaps are scheduled for Round 2: enable scripts (with a nonce-based CSP), add grouping logic, add `<mark>` highlighting, and add click-to-chat message handlers.

## Dashboard Panel (`DashboardPanel`)
- **UX Goal**: Give an overview of Knowledge Graph health, extraction queues, and unassigned decisions.
- **Theming**: Must seamlessly integrate with the VS Code theme ecosystem, utilizing standard padding and typography variables.
- **Responsiveness**: The layout should adapt gracefully to panel resizing or splitting editors.

### Webview Message Protocol
The Dashboard Panel uses a typed message protocol for bidirectional communication between the webview and the extension host.

**Extension → Webview (push)**

| Message type | Payload | When sent |
|---|---|---|
| `update` | `DashboardPayload` | On panel open and on every `store.onDidLoad` event |

**Webview → Extension (receive)**

| Message type | Payload | Effect |
|---|---|---|
| `openDecision` | `{ filePath: string }` | Opens the specified `.md` file in the editor |
| `openChat` | *(none)* | Opens GitHub Copilot Chat pre-populated with `@docuvia` |

### `DashboardPayload` Shape

```typescript
interface DashboardPayload {
  tagCount: number;
  moduleCount: number;
  decisionCount: number;
  recentDecisions: Array<{ title: string; status: string; filePath: string }>;
  topModules: Array<{ name: string; decisionCount: number }>;
  pendingTaskCount: number;    // from TaskQueueTreeProvider.getPendingCount()
  inProgressTaskCount: number; // from TaskQueueTreeProvider.getInProgressCount()
  loadedAt: string | null;     // ISO timestamp
  workspaceName: string;
}
```

### Path Security Validation
Before opening a file via an `openDecision` message, the extension host validates that `msg.filePath` starts with the first workspace root path (`workspaceFolders[0].uri.fsPath`). Paths that fall outside the workspace are silently rejected. This prevents a malicious webview payload from opening arbitrary files on disk.

### Real-Time Update Wiring
`DashboardPanel` subscribes to `store.onDidLoad` in its constructor:
```typescript
const onDidLoadDisposable = store.onDidLoad(() => this._pushData(store.snapshot));
```
The subscription is disposed when the panel is closed (`onDidDispose`), preventing memory leaks.