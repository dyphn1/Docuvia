import * as vscode from "vscode";
import { DashboardPanel } from "../dashboard-panel.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";
import { MSG_DASHBOARD_NO_WORKSPACE, MSG_DASHBOARD_SELECT_WORKSPACE } from "../constants/index.js";

export async function openDashboardCommand(
  context: vscode.ExtensionContext,
  tqProvider: TaskQueueTreeProvider,
  node?: { workspaceRoot?: string }
) {
  let targetRoot = node?.workspaceRoot;
  if (!targetRoot) {
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage(MSG_DASHBOARD_NO_WORKSPACE);
      return;
    } else if (folders.length === 1) {
      targetRoot = folders[0].uri.fsPath;
    } else {
      const picked = await vscode.window.showWorkspaceFolderPick({
        placeHolder: MSG_DASHBOARD_SELECT_WORKSPACE,
      });
      if (!picked) return;
      targetRoot = picked.uri.fsPath;
    }
  }
  DashboardPanel.createOrShow(context, targetRoot, tqProvider);
}
