import { DocuviaCommandInvoker } from "../constants/index.js";
import * as vscode from "vscode";
import { WebviewMessage } from "./dashboard-types.js";

export function handleDashboardMessage(msg: WebviewMessage, targetRoot: string): void {
  if (msg.type === "openDecision" && typeof msg.filePath === "string" && msg.filePath.length > 0) {
    const workspaceRoot = targetRoot;
    if (!msg.filePath.startsWith(workspaceRoot)) {
      return; // Reject paths outside workspace
    }
    void vscode.workspace.openTextDocument(vscode.Uri.file(msg.filePath)).then(
      (doc) => vscode.window.showTextDocument(doc),
      (err) => {
        console.warn(`[DashboardMessages] Failed to open decision document: ${err.message || err}`);
        vscode.window.showErrorMessage(`Docuvia: Could not open document. ${err.message || err}`);
      }
    );
  }
  if (msg.type === "openChat") {
    void DocuviaCommandInvoker.executeChatOpen("@docuvia");
  }
}
