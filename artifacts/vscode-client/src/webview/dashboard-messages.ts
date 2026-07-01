import * as vscode from "vscode";
import { WebviewMessage } from "./dashboard-types.js";

export function handleDashboardMessage(msg: WebviewMessage, targetRoot: string): void {
  if (msg.type === "openDecision" && typeof msg.filePath === "string" && msg.filePath.length > 0) {
    const workspaceRoot = targetRoot;
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
