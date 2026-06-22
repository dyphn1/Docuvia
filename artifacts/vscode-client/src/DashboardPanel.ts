import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { KnowledgeGraphSnapshot } from "./KnowledgeStore.js";
import { KnowledgeStore } from "./KnowledgeStore.js";
import { TaskQueueTreeProvider } from "./TaskQueueTreeProvider.js";

// ─── Message types ───────────────────────────────────────────────────────────

interface UpdateMessage {
  type: "update";
  data: DashboardPayload;
}

interface OpenDecisionMessage {
  type: "openDecision";
  filePath: string;
}

interface OpenChatMessage {
  type: "openChat";
}

type WebviewMessage = UpdateMessage | OpenDecisionMessage | OpenChatMessage;

export interface DashboardPayload {
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

// ─── Pure helper ─────────────────────────────────────────────────────────────

function buildDashboardPayload(
  snapshot: KnowledgeGraphSnapshot | null,
  workspaceRoot: string,
  tqProvider?: TaskQueueTreeProvider
): DashboardPayload {
  const workspaceName =
    snapshot?.projectName ||
    vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === workspaceRoot)?.name ||
    "Workspace";
  if (!snapshot) {
    return {
      tagCount: 0,
      moduleCount: 0,
      decisionCount: 0,
      recentDecisions: [],
      topModules: [],
      pendingTaskCount: 0,
      inProgressTaskCount: 0,
      loadedAt: null,
      workspaceName,
    };
  }

  const recentDecisions = [...snapshot.decisions.values()]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 5)
    .map((d) => ({ title: d.title, status: d.status, filePath: d.filePath }));

  // Count decisions per module via router index
  const countByModule = new Map<string, number>();
  for (const entry of snapshot.routerIndex) {
    countByModule.set(entry.l2_module_id, (countByModule.get(entry.l2_module_id) ?? 0) + 1);
  }

  const topModules = snapshot.modules
    .map((m) => ({ name: m.name, decisionCount: countByModule.get(m.id) ?? 0 }))
    .sort((a, b) => b.decisionCount - a.decisionCount)
    .slice(0, 5);

  return {
    tagCount: snapshot.tags.length,
    moduleCount: snapshot.modules.length,
    decisionCount: snapshot.decisions.size,
    recentDecisions,
    topModules,
    pendingTaskCount: tqProvider?.getPendingCount() ?? 0,
    inProgressTaskCount: tqProvider?.getInProgressCount() ?? 0,
    loadedAt: snapshot.loadedAt.toISOString(),
    workspaceName,
  };
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export class DashboardPanel {
  static readonly viewType = "docuvia.dashboard";
  private static _panels = new Map<string, DashboardPanel>();

  static createOrShow(
    context: vscode.ExtensionContext,
    store: KnowledgeStore,
    targetRoot: string,
    tqProvider?: TaskQueueTreeProvider
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    const currentPanel = DashboardPanel._panels.get(targetRoot);
    if (currentPanel) {
      currentPanel._panel.reveal(column);
      currentPanel._pushData(store.getSnapshotFor(targetRoot));
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      `Docuvia Dashboard (${vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === targetRoot)?.name || "Workspace"})`,
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
        retainContextWhenHidden: true,
      }
    );

    const newDashboard = new DashboardPanel(panel, context, store, targetRoot, tqProvider);
    DashboardPanel._panels.set(targetRoot, newDashboard);
  }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _context: vscode.ExtensionContext,
    store: KnowledgeStore,
    private readonly _targetRoot: string,
    private readonly _tqProvider?: TaskQueueTreeProvider
  ) {
    this._panel.webview.html = this._buildHtml();

    this._pushData(store.getSnapshotFor(this._targetRoot));

    const onDidLoadDisposable = store.onDidLoad(() =>
      this._pushData(store.getSnapshotFor(this._targetRoot))
    );

    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this._handleMessage(msg),
      null,
      this._context.subscriptions
    );

    this._panel.onDidDispose(
      () => {
        onDidLoadDisposable.dispose();
        DashboardPanel._panels.delete(this._targetRoot);
      },
      null,
      this._context.subscriptions
    );
  }

  private _pushData(snapshot: KnowledgeGraphSnapshot | undefined): void {
    void this._panel.webview.postMessage({
      type: "update",
      data: buildDashboardPayload(snapshot || null, this._targetRoot, this._tqProvider),
    });
  }

  private _handleMessage(msg: WebviewMessage): void {
    if (
      msg.type === "openDecision" &&
      typeof msg.filePath === "string" &&
      msg.filePath.length > 0
    ) {
      const workspaceRoot = this._targetRoot;
      if (!msg.filePath.startsWith(workspaceRoot)) {
        return; // Reject paths outside workspace
      }
      void vscode.workspace
        .openTextDocument(vscode.Uri.file(msg.filePath))
        .then((doc) => vscode.window.showTextDocument(doc));
    }
    if (msg.type === "openChat") {
      void vscode.commands.executeCommand("workbench.action.chat.open", { query: "@docuvia" });
    }
  }

  private _buildHtml(): string {
    const nonce = randomBytes(16).toString("hex");
    const cspSource = this._panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Docuvia Dashboard</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      padding: 10px 16px;
      background: var(--vscode-sideBarSectionHeader-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 1.1em;
      font-weight: bold;
      flex-shrink: 0;
    }
    .main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .left-pane {
      flex: 65;
      padding: 12px;
      overflow-y: auto;
      border-right: 1px solid var(--vscode-panel-border);
    }
    .right-pane {
      flex: 35;
      padding: 12px;
      overflow-y: auto;
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 10px;
      background: var(--vscode-editorWidget-background);
    }
    .card h3 {
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .stat-row { display: flex; gap: 16px; }
    .stat { font-size: 1.4em; font-weight: bold; }
    .stat-label { font-size: 0.75em; color: var(--vscode-descriptionForeground); }
    ul { list-style: none; }
    li { padding: 3px 0; cursor: pointer; }
    li:hover { color: var(--vscode-textLink-activeForeground); }
    .decision-status {
      font-size: 0.75em;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-left: 6px;
    }
    .bottom-bar {
      padding: 8px 12px;
      background: var(--vscode-editorWidget-background);
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .search-placeholder {
      flex: 1;
      padding: 6px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-placeholderForeground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      font-size: 0.9em;
      cursor: pointer;
      text-align: left;
    }
    .search-placeholder:hover {
      border-color: var(--vscode-focusBorder);
    }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.85em; }
  </style>
</head>
<body>
  <header>
    Docuvia Dashboard
    <span id="workspace-name" style="font-weight:normal;color:var(--vscode-descriptionForeground);margin-left:10px;font-size:0.85em;"></span>
  </header>
  <div class="main">
    <div class="left-pane">
      <div class="card">
        <h3>Quick Start</h3>
        <p style="font-size:0.85em;color:var(--vscode-descriptionForeground);">
          Use the <strong>Docuvia: Init Project</strong> or <strong>Docuvia: Add Decision</strong> commands to get started.
        </p>
      </div>
      <div class="card">
        <h3>Recent Decisions</h3>
        <ul id="recent-decisions"><li class="empty">No decisions yet.</li></ul>
      </div>
      <div class="card">
        <h3>Top Modules</h3>
        <ul id="top-modules"><li class="empty">No modules yet.</li></ul>
      </div>
      <div class="card">
        <h3>Repo Overview</h3>
        <p style="font-size:0.85em;color:var(--vscode-descriptionForeground);">
          The knowledge graph captures architectural decisions and design rationale for this codebase.
        </p>
      </div>
    </div>
    <div class="right-pane">
      <div class="card">
        <h3>Coverage Stats</h3>
        <div class="stat-row">
          <div>
            <div class="stat" id="stat-tags">0</div>
            <div class="stat-label">Tags</div>
          </div>
          <div>
            <div class="stat" id="stat-modules">0</div>
            <div class="stat-label">Modules</div>
          </div>
          <div>
            <div class="stat" id="stat-decisions">0</div>
            <div class="stat-label">Decisions</div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Extraction Queue</h3>
        <div class="stat-row">
          <div>
            <div class="stat" id="stat-pending">0</div>
            <div class="stat-label">Pending</div>
          </div>
          <div>
            <div class="stat" id="stat-in-progress">0</div>
            <div class="stat-label">In Progress</div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Last Loaded</h3>
        <div id="stat-loaded-at" style="font-size:0.85em;color:var(--vscode-descriptionForeground);">—</div>
      </div>
    </div>
  </div>
  <div class="bottom-bar">
    <button id="open-chat-btn" class="search-placeholder" title="Open Docuvia Chat">Ask Docuvia…</button>
    <span>🔍</span>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (msg.type === 'update') {
        renderDashboard(msg.data);
      }
    });

    document.getElementById('open-chat-btn').addEventListener('click', function() {
      vscode.postMessage({ type: 'openChat' });
    });

    function renderDashboard(data) {
      document.getElementById('stat-tags').textContent = String(data.tagCount);
      document.getElementById('stat-modules').textContent = String(data.moduleCount);
      document.getElementById('stat-decisions').textContent = String(data.decisionCount);
      document.getElementById('stat-pending').textContent = String(data.pendingTaskCount);
      document.getElementById('stat-in-progress').textContent = String(data.inProgressTaskCount);
      document.getElementById('stat-loaded-at').textContent =
        data.loadedAt ? new Date(data.loadedAt).toLocaleString() : '—';
      if (data.workspaceName) {
        document.getElementById('workspace-name').textContent = data.workspaceName;
      }

      const decisionsList = document.getElementById('recent-decisions');
      if (data.recentDecisions.length === 0) {
        decisionsList.innerHTML = '<li class="empty">No decisions yet.</li>';
      } else {
        decisionsList.innerHTML = data.recentDecisions.map(function(d) {
          return '<li data-filepath="' + escapeAttr(d.filePath) + '" onclick="openDecision(this.dataset.filepath)">' +
            escapeHtml(d.title) +
            '<span class="decision-status">' + escapeHtml(d.status) + '</span>' +
            '</li>';
        }).join('');
      }

      const modulesList = document.getElementById('top-modules');
      if (data.topModules.length === 0) {
        modulesList.innerHTML = '<li class="empty">No modules yet.</li>';
      } else {
        modulesList.innerHTML = data.topModules.map(function(m) {
          return '<li>' + escapeHtml(m.name) +
            ' <span style="color:var(--vscode-descriptionForeground);font-size:0.8em;">(' + m.decisionCount + ' decisions)</span></li>';
        }).join('');
      }
    }

    function openDecision(filePath) {
      vscode.postMessage({ type: 'openDecision', filePath: filePath });
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
      return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  </script>
</body>
</html>`;
  }
}
