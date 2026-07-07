import * as vscode from "vscode";
import * as os from "os";
import { parseGlobalConfig } from "./parser.js";

export function registerVfsWatcher(context: vscode.ExtensionContext) {
  let debounceTimer: NodeJS.Timeout | null = null;

  vscode.workspace.onDidChangeTextDocument(
    (e) => {
      if (e.document.uri.scheme !== "file") return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(e.document.uri);
          if (!workspaceFolder) return;

          const globalConfigPath = vscode.Uri.joinPath(
            vscode.Uri.file(os.homedir()),
            ".docuvia",
            "config.yaml"
          );
          let globalConfigContent = "";
          try {
            const bytes = await vscode.workspace.fs.readFile(globalConfigPath);
            globalConfigContent = Buffer.from(bytes).toString("utf-8");
          } catch (e) {
            // ignore
          }
          const globalConfig = parseGlobalConfig(globalConfigContent, globalConfigPath.fsPath);
          const serverUrl = globalConfig?.server_url || "http://localhost:3000";

          const response = await fetch(`${serverUrl}/api/v1/vfs/update`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              workspaceRoot: workspaceFolder.uri.fsPath,
              uri: e.document.uri.fsPath,
              content: e.document.getText(),
            }),
          });

          if (response.ok) {
            const result = (await response.json()) as any;
            if (result.dirtyFiles && result.dirtyFiles.length > 0) {
              // UI hook listener - render blast radius or update UI
              vscode.commands.executeCommand("setContext", "docuvia.hasDirtyFiles", true);
              vscode.window.setStatusBarMessage(
                `$(circle-filled) Docuvia: ${result.dirtyFiles.length} unsaved changes`,
                3000
              );
            } else {
              vscode.commands.executeCommand("setContext", "docuvia.hasDirtyFiles", false);
            }
          }
        } catch (err) {
          console.error("VFS update failed", err);
        }
      }, 300);
    },
    null,
    context.subscriptions
  );
}
