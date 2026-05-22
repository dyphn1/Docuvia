# VS Code Extension — Phase 2: UI/UX Shell & TreeViews

**Feature**: VS Code Extension Phase 2 — Activity Bar TreeViews + Webview Dashboard  
**Roadmap Reference**: `docs/vscode-extension-roadmap.md` § "Phase 2: UI/UX Shell & TreeViews"  
**Author**: Requirement Analyzer  
**Date**: 2026-05-22

---

## 1. Implementation Goals

| # | Goal | Verifiable Success Criterion |
|---|------|------------------------------|
| G1 | Activity Bar icon already verified | `artifacts/vscode-client/resources/icon.svg` exists — confirmed |
| G2 | Knowledge Graph TreeView renders L1→L2→L3 | Opening the Docuvia sidebar with a workspace containing `.docuvia/` shows collapsible L1 tag nodes; expanding one shows L2 modules; expanding a module shows L3 decision entries; clicking a leaf opens the markdown file in the editor |
| G3 | TreeView refreshes on file change | After editing and saving any file under `.docuvia/`, the tree view updates within 1 second without a manual reload |
| G4 | Task Queue TreeView renders grouped task statuses | The "Task Queue" view shows status-grouped sections ("Pending", "In Progress", "Done", "Failed") with zero items when no tasks exist; the tree is non-empty when tasks are injected via `TaskQueueTreeProvider.addTask()` |
| G5 | Dashboard webview opens via command | Running `Docuvia: Open Dashboard` from the command palette opens a Webview panel with the two-pane + bottom-bar layout; the panel title reads "Docuvia Dashboard"; CSP is nonce-secured and the panel is reused (not duplicated) if already open |
| G6 | Dashboard receives live data from extension host | When the extension calls `DashboardPanel.postData(snapshot)`, the webview renders tag/module/decision counts and the extraction queue summary without a reload |
| G7 | All new TypeScript compiles cleanly | `pnpm --filter @workspace/vscode-client run typecheck` exits with code 0 |

---

## 2. Affected Packages

| Package | Role |
|---------|------|
| `artifacts/vscode-client/` | All changes — new source files + modifications to `extension.ts`, `KnowledgeStore.ts`, `package.json` |

No other workspace packages are touched.

---

## 3. Pre-Implementation Audit

### 3.1 What Phase 1 Already Provides

| Artifact | Status |
|----------|--------|
| `resources/icon.svg` | ✅ Exists |
| `package.json` — `viewsContainers.activitybar` entry `"docuvia"` | ✅ Registered |
| `package.json` — `views.docuvia` entries `docuvia.knowledgeGraph`, `docuvia.taskQueue` | ✅ Registered |
| `KnowledgeStore.snapshot` — `tags`, `modules`, `routerIndex`, `decisions` Map | ✅ Available |
| `KnowledgeStore.getModulesByTagId(tagId)` | ✅ Available |
| `KnowledgeStore.getRouterEntriesByModuleId(moduleId)` | ✅ Available |
| `KnowledgeStore.startWatcher()` — internal reload on `.docuvia/**` changes | ✅ Available |

### 3.2 Gap: No Change Notification from KnowledgeStore

The FileSystemWatcher in `KnowledgeStore.startWatcher()` calls `this.load()` internally but does not emit any event that outside consumers (TreeProviders, Webview) can subscribe to. **Phase 2 must add `onDidLoad` to `KnowledgeStore`.**

### 3.3 Gap: `docuvia.openDashboard` Command Not Registered

Neither `extension.ts` nor `package.json` define this command yet. Both must be updated.

---

## 4. Detailed Implementation Steps

### Step 1 — Extend `KnowledgeStore` with `onDidLoad` event

**File**: `artifacts/vscode-client/src/KnowledgeStore.ts`

Add a private `vscode.EventEmitter<void>` and expose it as a public `vscode.Event<void>` property. Fire it at the end of a successful `load()` call.

```typescript
// Add to class fields:
private readonly _onDidLoad = new vscode.EventEmitter<void>();
readonly onDidLoad: vscode.Event<void> = this._onDidLoad.event;

// At the bottom of the successful load() path, before `return true`:
this._onDidLoad.fire();

// In dispose():
this._onDidLoad.dispose();
```

**Success criterion**: After the change, `store.onDidLoad(() => ...)` compiles and TypeScript confirms the type is `vscode.Event<void>`.

---

### Step 2 — Create `KnowledgeGraphTreeProvider.ts`

**File**: `artifacts/vscode-client/src/KnowledgeGraphTreeProvider.ts` _(new file)_

#### 2a. Node type union

```typescript
export type KGNodeKind = 'l1tag' | 'l2module' | 'l3entry' | 'placeholder';

export interface KGNode {
  kind: KGNodeKind;
  id: string;          // entity ID (or a synthetic key for placeholders)
  label: string;
  /** Only present on l3entry nodes */
  filePath?: string;
}
```

#### 2b. `KnowledgeGraphTreeProvider` class

```typescript
export class KnowledgeGraphTreeProvider
  implements vscode.TreeDataProvider<KGNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<KGNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: KnowledgeStore) {
    store.onDidLoad(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: KGNode): vscode.TreeItem {
    // Map each KGNodeKind to a vscode.TreeItem with the correct
    // collapsibleState, iconPath, contextValue, and command
  }

  getChildren(node?: KGNode): KGNode[] {
    // node === undefined → return L1 tags (or single placeholder)
    // node.kind === 'l1tag' → return L2 modules for this tag
    // node.kind === 'l2module' → return L3 router entries for this module
    // node.kind === 'l3entry' → return [] (leaf)
  }
}
```

#### 2c. Tree item appearance rules

| Node Kind | `collapsibleState` | Icon (ThemeIcon) | Command on click |
|-----------|-------------------|------------------|-----------------|
| `placeholder` | `None` | `info` | — |
| `l1tag` | `Collapsed` | `tag` | — |
| `l2module` | `Collapsed` | `package` | — |
| `l3entry` | `None` | `note` | `vscode.open` with the `.md` `vscode.Uri` |

- If the snapshot is `null` or `tags` is empty, `getChildren(undefined)` returns a single placeholder node with label `"No .docuvia/ folder found — run Init Project"`.
- If a tag has no modules, its `collapsibleState` is `None` (leaf).
- If a module has no router entries, its `collapsibleState` is `None`.

---

### Step 3 — Create `TaskQueueTreeProvider.ts`

**File**: `artifacts/vscode-client/src/TaskQueueTreeProvider.ts` _(new file)_

#### 3a. Domain types

```typescript
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed';
export type TaskType = 'l1_extraction' | 'l2_extraction' | 'l3_extraction' | 'generic';

export interface ExtractionTask {
  id: string;          // UUID
  label: string;       // Human-readable description
  type: TaskType;
  status: TaskStatus;
  createdAt: Date;
  detail?: string;     // Optional progress detail or error message
}

export type TQNodeKind = 'group' | 'task';

export interface TQNode {
  kind: TQNodeKind;
  id: string;
  label: string;
  status?: TaskStatus;   // Only on 'task' nodes
  detail?: string;
}
```

#### 3b. `TaskQueueTreeProvider` class

```typescript
export class TaskQueueTreeProvider implements vscode.TreeDataProvider<TQNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TQNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _tasks: ExtractionTask[] = [];

  getTreeItem(node: TQNode): vscode.TreeItem { ... }

  getChildren(node?: TQNode): TQNode[] {
    // node === undefined → return group nodes for each status
    //   that has at least one task (or always show all 4 groups)
    // node.kind === 'group' → return task nodes for that status
    // node.kind === 'task' → return []
  }

  addTask(task: ExtractionTask): void {
    this._tasks.push(task);
    this._onDidChangeTreeData.fire();
  }

  updateTaskStatus(id: string, status: TaskStatus, detail?: string): void {
    const t = this._tasks.find(t => t.id === id);
    if (t) {
      t.status = status;
      if (detail !== undefined) t.detail = detail;
      this._onDidChangeTreeData.fire();
    }
  }

  clearCompleted(): void {
    this._tasks = this._tasks.filter(t => t.status !== 'done');
    this._onDidChangeTreeData.fire();
  }
}
```

#### 3c. Group node appearance

| Group Label | Icon (ThemeIcon) | `collapsibleState` |
|-------------|-----------------|-------------------|
| `Pending` | `clock` | `Collapsed` |
| `In Progress` | `sync~spin` | `Expanded` |
| `Done` | `pass-filled` | `Collapsed` |
| `Failed` | `error` | `Collapsed` |

Task nodes display `label` as the primary text and `detail` as the description. Status-appropriate icons: `pending→circle-outline`, `in_progress→loading~spin`, `done→check`, `failed→warning`.

---

### Step 4 — Create `DashboardPanel.ts`

**File**: `artifacts/vscode-client/src/DashboardPanel.ts` _(new file)_

#### 4a. Panel lifecycle (static factory pattern)

```typescript
export class DashboardPanel {
  static readonly viewType = 'docuvia.dashboard';
  private static _current: DashboardPanel | undefined;

  static createOrShow(context: vscode.ExtensionContext, store: KnowledgeStore): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (DashboardPanel._current) {
      DashboardPanel._current._panel.reveal(column);
      DashboardPanel._current._pushData(store.snapshot);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Docuvia Dashboard',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
        retainContextWhenHidden: true,
      }
    );

    DashboardPanel._current = new DashboardPanel(panel, context, store);
  }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _context: vscode.ExtensionContext,
    store: KnowledgeStore
  ) {
    this._panel.webview.html = this._buildHtml();

    // Push initial data
    this._pushData(store.snapshot);

    // Re-push on every knowledge reload
    store.onDidLoad(() => this._pushData(store.snapshot), null, this._context.subscriptions);

    // Handle messages FROM the webview
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this._handleMessage(msg),
      null,
      this._context.subscriptions
    );

    // Clean up when closed
    this._panel.onDidDispose(() => {
      DashboardPanel._current = undefined;
    }, null, this._context.subscriptions);
  }

  private _pushData(snapshot: KnowledgeGraphSnapshot | null): void {
    void this._panel.webview.postMessage({ type: 'update', data: buildDashboardPayload(snapshot) });
  }

  private _handleMessage(msg: WebviewMessage): void {
    if (msg.type === 'openDecision' && msg.filePath) {
      void vscode.workspace.openTextDocument(vscode.Uri.file(msg.filePath))
        .then(doc => vscode.window.showTextDocument(doc));
    }
  }
}
```

#### 4b. Nonce-secured HTML generation

The `_buildHtml()` method generates a random 32-char hex nonce per call and injects it into:
- `Content-Security-Policy` meta tag
- Every `<style nonce="...">` block
- Every `<script nonce="...">` block

**CSP policy string** (all other sources are `'none'`):
```
default-src 'none';
style-src ${webview.cspSource} 'nonce-${nonce}';
script-src 'nonce-${nonce}';
```

#### 4c. Webview HTML layout

```
┌────────────────────────────────────────────────────────────────────┐
│  <header>  Docuvia Dashboard  [workspace name]                     │
├─────────────────────────────────┬──────────────────────────────────┤
│  LEFT PANE (65%)                │  RIGHT PANE (35%)                │
│  ┌─ Quick Start ──────────────┐ │  ┌─ Coverage Stats ───────────┐ │
│  │  [Init Project] [Add Decis]│ │  │  Tags: N  Modules: N       │ │
│  └────────────────────────────┘ │  │  Decisions: N              │ │
│  ┌─ Recent Decisions ─────────┐ │  └────────────────────────────┘ │
│  │  (list, newest 5)          │ │  ┌─ Extraction Queue ─────────┐ │
│  └────────────────────────────┘ │  │  Pending: N  In Progress: N│ │
│  ┌─ Top Modules ──────────────┐ │  └────────────────────────────┘ │
│  │  (most decisions)          │ │  ┌─ Recent Changes ───────────┐ │
│  └────────────────────────────┘ │  │  (last 3 loadedAt stamps)  │ │
│  ┌─ Repo Overview ────────────┐ │  └────────────────────────────┘ │
│  │  "What is this repo?"      │ │                                  │
│  └────────────────────────────┘ │                                  │
├─────────────────────────────────┴──────────────────────────────────┤
│  BOTTOM BAR                                                        │
│  [ Ask Docuvia... (Phase 3 chat placeholder)            🔍 ]      │
└────────────────────────────────────────────────────────────────────┘
```

The HTML uses VS Code's CSS variables (`--vscode-*`) for theming so it respects light/dark/high-contrast themes automatically.

#### 4d. Message types (extension ↔ webview)

```typescript
// Extension → Webview
interface UpdateMessage {
  type: 'update';
  data: DashboardPayload;
}

// Webview → Extension
interface OpenDecisionMessage {
  type: 'openDecision';
  filePath: string;
}

type WebviewMessage = UpdateMessage | OpenDecisionMessage;

interface DashboardPayload {
  tagCount: number;
  moduleCount: number;
  decisionCount: number;
  recentDecisions: Array<{ title: string; status: string; filePath: string }>;
  topModules: Array<{ name: string; decisionCount: number }>;
  pendingTaskCount: number;
  inProgressTaskCount: number;
  loadedAt: string | null;   // ISO string
}
```

`buildDashboardPayload(snapshot)` is a pure helper function defined in `DashboardPanel.ts` that derives `DashboardPayload` from a `KnowledgeGraphSnapshot | null`.

---

### Step 5 — Update `extension.ts`

**File**: `artifacts/vscode-client/src/extension.ts` _(modify)_

Changes required:

1. **Import** `KnowledgeGraphTreeProvider` from `'./KnowledgeGraphTreeProvider'`
2. **Import** `TaskQueueTreeProvider` from `'./TaskQueueTreeProvider'`
3. **Import** `DashboardPanel` from `'./DashboardPanel'`
4. **After** `store.startWatcher(context)`, instantiate and register both tree providers:
   ```typescript
   const kgProvider = new KnowledgeGraphTreeProvider(store);
   context.subscriptions.push(
     vscode.window.registerTreeDataProvider('docuvia.knowledgeGraph', kgProvider)
   );

   const tqProvider = new TaskQueueTreeProvider();
   context.subscriptions.push(
     vscode.window.registerTreeDataProvider('docuvia.taskQueue', tqProvider)
   );
   ```
5. **Add** `docuvia.openDashboard` command registration:
   ```typescript
   context.subscriptions.push(
     vscode.commands.registerCommand('docuvia.openDashboard', () => {
       DashboardPanel.createOrShow(context, store);
     })
   );
   ```
6. **Expose** `tqProvider` via return or module-level variable if needed for Phase 3 task injection (optional — can be passed to future chat participant in Phase 3).

---

### Step 6 — Update `package.json`

**File**: `artifacts/vscode-client/package.json` _(modify)_

#### 6a. Add `docuvia.openDashboard` command to the commands array:

```json
{
  "command": "docuvia.openDashboard",
  "title": "Docuvia: Open Dashboard",
  "icon": "$(home)"
}
```

#### 6b. Add view title actions (toolbar buttons in the sidebar view header):

```json
"menus": {
  "view/title": [
    {
      "command": "docuvia.refreshKnowledgeGraph",
      "when": "view == docuvia.knowledgeGraph",
      "group": "navigation"
    },
    {
      "command": "docuvia.openDashboard",
      "when": "view == docuvia.knowledgeGraph",
      "group": "navigation"
    }
  ]
}
```

This places a refresh button and a dashboard button in the Knowledge Graph view's title bar.

---

## 5. File Map

| File | Action | Purpose |
|------|--------|---------|
| `artifacts/vscode-client/src/KnowledgeGraphTreeProvider.ts` | **Create** | L1→L2→L3 TreeDataProvider |
| `artifacts/vscode-client/src/TaskQueueTreeProvider.ts` | **Create** | Extraction task queue TreeDataProvider |
| `artifacts/vscode-client/src/DashboardPanel.ts` | **Create** | Webview panel (static factory, CSP, messaging) |
| `artifacts/vscode-client/src/KnowledgeStore.ts` | **Modify** | Add `onDidLoad: vscode.Event<void>` + fire after load |
| `artifacts/vscode-client/src/extension.ts` | **Modify** | Register tree providers + `docuvia.openDashboard` command |
| `artifacts/vscode-client/package.json` | **Modify** | Add `docuvia.openDashboard` command + `menus.view/title` entries |

**No new npm dependencies are required.** The webview uses inline styles/scripts (no external CSS frameworks), and all VS Code API types are already in `@types/vscode`.

---

## 6. Security Notes

- **Nonce**: A fresh crypto-random 32-char hex nonce must be generated on every call to `_buildHtml()` (not reused). Use `crypto.randomBytes(16).toString('hex')` (Node.js built-in, no import needed in ESM: `import { randomBytes } from 'crypto'`).
- **CSP**: `default-src 'none'` is the baseline. Only loosen with `webview.cspSource` for local extension resources and `'nonce-${nonce}'` for inline scripts/styles.
- **postMessage input validation**: The `_handleMessage` handler must validate `msg.filePath` is a string before passing it to `vscode.Uri.file`. Do not use `eval` or `innerHTML` with untrusted data inside the webview.
- **No remote URIs**: The webview must not load any external scripts or stylesheets.

---

## 7. Key Assumptions & Decisions

| Decision | Rationale |
|----------|-----------|
| `KnowledgeGraphTreeProvider` subscribes to `store.onDidLoad` (not a polling loop) | Event-driven; zero overhead when store is idle |
| `TaskQueueTreeProvider` is in-memory only for Phase 2 | Task persistence and execution engine are Phase 3 scope |
| `DashboardPanel` uses `retainContextWhenHidden: true` | Prevents full re-render on panel hide/show; trade-off is memory (acceptable for a single panel) |
| Dashboard HTML is inline (no separate file) | VS Code webview HTML is built at runtime with the nonce injected; a static file would require a nonce placeholder substitution step. Inline is simpler and equally secure. |
| No shadcn/ui or React in the webview | The webview is a simple HTML panel, not a full React app. Using the `kg-engine` React app as the webview would require bundler integration not yet wired for the extension. Phase 3+ can revisit. |
| `menus.view/title` additions are optional but included | Provides discoverability for the refresh and dashboard commands directly in the sidebar |

---

## 8. Out of Scope for Phase 2

- `@docuvia` Chat Participant (Phase 3)
- CodeLens / Hover Provider (Phase 4)
- Central Server breadth search (Phase 5)
- Actual task execution logic (Phase 3 — only the queue UI is Phase 2)
- Populating `recentDecisions` with real Git blame timestamps (Phase 3+)
