import * as vscode from "vscode";
import { LocalSnapshotService, SnapshotData } from "@workspace/core";
import { TaskQueueTreeProvider } from "./task-queue-tree-provider.js";
import { getDashboardHtml } from "./webview/dashboard-html.js";
import { handleDashboardMessage } from "./webview/dashboard-messages.js";
import { DashboardPayload, WebviewMessage } from "./webview/dashboard-types.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";

// Re-export for compatibility if needed elsewhere
export type { DashboardPayload };

// ─── Pure helper ─────────────────────────────────────────────────────────────

function buildDashboardPayload(
  snapshot: SnapshotData | null,
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
    loadedAt: new Date().toISOString(),
    workspaceName,
  };
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export class DashboardPanel extends BaseWebviewPanel {
  static readonly viewType = "docuvia.dashboard";
  private static _panels = new Map<string, DashboardPanel>();

  static createOrShow(
    context: vscode.ExtensionContext,
    targetRoot: string,
    tqProvider?: TaskQueueTreeProvider
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    const currentPanel = DashboardPanel._panels.get(targetRoot);
    if (currentPanel) {
      currentPanel._panel.reveal(column);
      const snapshot = new LocalSnapshotService(targetRoot).getSnapshot();
      currentPanel._pushData(snapshot);
      return;
    }

    const panel = BaseWebviewPanel.createPanel(
      context,
      DashboardPanel.viewType,
      `Docuvia Dashboard (${vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === targetRoot)?.name || "Workspace"})`,
      column
    );

    const newDashboard = new DashboardPanel(panel, context, targetRoot, tqProvider);
    DashboardPanel._panels.set(targetRoot, newDashboard);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly _targetRoot: string,
    private readonly _tqProvider?: TaskQueueTreeProvider
  ) {
    super(panel, context);
    this._panel.webview.html = this._buildHtml();

    const snapshotService = new LocalSnapshotService(this._targetRoot);
    this._pushData(snapshotService.getSnapshot());
  }

  private _pushData(snapshot: SnapshotData | null): void {
    void this._panel.webview.postMessage({
      type: "update",
      data: buildDashboardPayload(snapshot, this._targetRoot, this._tqProvider),
    });
  }

  protected _handleMessage(msg: WebviewMessage): void {
    handleDashboardMessage(msg, this._targetRoot);
  }

  protected _onDispose(): void {
    DashboardPanel._panels.delete(this._targetRoot);
  }

  private _buildHtml(): string {
    return getDashboardHtml(this._panel.webview.cspSource);
  }
}
