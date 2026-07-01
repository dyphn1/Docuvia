import * as vscode from "vscode";
import * as path from "path";
import { CleanService, StatusService, ChangeDetectionService, SyncService } from "@workspace/core";
import { KnowledgeStore } from "../knowledge-store.js";
import { CredentialManager } from "../credential-manager.js";

export async function cleanCommand() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  try {
    const cleanService = new CleanService(folders[0].uri.fsPath);
    await cleanService.clean();
    void vscode.window.showInformationMessage("Docuvia: Clean successful.");
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Docuvia: Clean failed - ${err.message}`);
  }
}

export async function statusCommand(outputChannel: vscode.OutputChannel) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  try {
    const statusService = new StatusService(folders[0].uri.fsPath);
    const status = await statusService.getStatus();
    outputChannel.appendLine(`[Docuvia] Status: ${JSON.stringify(status, null, 2)}`);
    void vscode.window.showInformationMessage(
      `Docuvia Status: Checked. See Output channel for details.`
    );
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Docuvia: Status failed - ${err.message}`);
  }
}

export async function detectChangesCommand(outputChannel: vscode.OutputChannel) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  try {
    const changeService = new ChangeDetectionService(folders[0].uri.fsPath);
    const changes = await changeService.detectChanges();
    outputChannel.appendLine(`[Docuvia] Changes: ${JSON.stringify(changes, null, 2)}`);
    void vscode.window.showInformationMessage(`Docuvia Changes: ${changes.analysis}`);
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Docuvia: Detect changes failed - ${err.message}`);
  }
}

export async function syncCommand(
  outputChannel: vscode.OutputChannel,
  store: KnowledgeStore,
  credentialManager: CredentialManager
) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  try {
    const token = await credentialManager.getToken();
    if (!token) {
      void vscode.window.showErrorMessage("Docuvia: Cannot sync, no server token set.");
      return;
    }
    const syncService = new SyncService(
      folders[0].uri.fsPath,
      store.globalConfig?.server_url || "http://localhost:3000",
      token,
      (msg) => outputChannel.appendLine(`[Docuvia Sync] ${msg}`)
    );
    let projectId = "1";
    try {
      const configPath = path.join(folders[0].uri.fsPath, ".docuvia", "config.json");
      const configData = await vscode.workspace.fs.readFile(vscode.Uri.file(configPath));
      const configJson = JSON.parse(Buffer.from(configData).toString("utf-8"));
      if (configJson.projectId) {
        projectId = String(configJson.projectId);
      }
    } catch (err) {
      outputChannel.appendLine(
        `[Docuvia Sync] Warning: Could not read .docuvia/config.json, defaulting to projectId="1"`
      );
    }
    await syncService.sync(projectId);
    void vscode.window.showInformationMessage("Docuvia: Sync successful.");
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Docuvia: Sync failed - ${err.message}`);
  }
}
