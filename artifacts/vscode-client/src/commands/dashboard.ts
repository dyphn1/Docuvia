import * as vscode from "vscode";
import { DashboardPanel } from "../dashboard-panel.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";

export async function openDashboardCommand(
  context: vscode.ExtensionContext,
  tqProvider: TaskQueueTreeProvider,
  node?: { workspaceRoot?: string }
) {
  let targetRoot = node?.workspaceRoot;
  if (!targetRoot) {
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage("Docuvia: No workspace folder open.");
      return;
    } else if (folders.length === 1) {
      targetRoot = folders[0].uri.fsPath;
    } else {
      const picked = await vscode.window.showWorkspaceFolderPick({
        placeHolder: "Select a workspace for the dashboard",
      });
      if (!picked) return;
      targetRoot = picked.uri.fsPath;
    }
  }
  DashboardPanel.createOrShow(context, targetRoot, tqProvider);
}
