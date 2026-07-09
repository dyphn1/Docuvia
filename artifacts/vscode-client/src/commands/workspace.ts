import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import {
  CleanService,
  StatusService,
  ChangeDetectionService,
  SyncService,
  DOCUVIA_DIR_NAME,
  FILE_GLOBAL_CONFIG_YAML,
  FILE_LOCAL_CONFIG_JSON,
  DEFAULT_SERVER_URL,
  DEFAULT_PROJECT_ID,
  ENCODING_UTF_8,
} from "@workspace/core";
import { CredentialManager } from "../credential-manager.js";
import { parseGlobalConfig } from "../parser.js";
import {
  MSG_CLEAN_SUCCESS,
  MSG_CLEAN_FAILED,
  MSG_STATUS_CHECKED,
  MSG_STATUS_FAILED,
  MSG_DETECT_CHANGES_FAILED,
  MSG_SYNC_NO_TOKEN,
  MSG_SYNC_SUCCESS,
  MSG_SYNC_FAILED,
  MSG_WORKSPACE_CHANGES,
  MSG_WORKSPACE_STATUS,
  MSG_WORKSPACE_CHANGES_RAW,
  MSG_WORKSPACE_SYNC_LOG,
  MSG_WORKSPACE_SYNC_WARNING_CONFIG,
} from "../constants/index.js";

export async function cleanCommand() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  try {
    const cleanService = new CleanService(folders[0].uri.fsPath);
    await cleanService.clean();
    void vscode.window.showInformationMessage(MSG_CLEAN_SUCCESS);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`${MSG_CLEAN_FAILED}${errorMsg}`);
  }
}

export async function statusCommand(outputChannel: vscode.OutputChannel) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  try {
    const statusService = new StatusService(folders[0].uri.fsPath);
    const status = await statusService.getStatus();
    outputChannel.appendLine(MSG_WORKSPACE_STATUS.replace("{0}", JSON.stringify(status, null, 2)));
    void vscode.window.showInformationMessage(MSG_STATUS_CHECKED);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`${MSG_STATUS_FAILED}${errorMsg}`);
  }
}

export async function detectChangesCommand(outputChannel: vscode.OutputChannel) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  try {
    const changeService = new ChangeDetectionService(folders[0].uri.fsPath);
    const changes = await changeService.detectChanges();
    outputChannel.appendLine(
      MSG_WORKSPACE_CHANGES_RAW.replace("{0}", JSON.stringify(changes, null, 2))
    );
    void vscode.window.showInformationMessage(
      MSG_WORKSPACE_CHANGES.replace("{0}", changes.analysis)
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`${MSG_DETECT_CHANGES_FAILED}${errorMsg}`);
  }
}

export async function syncCommand(
  outputChannel: vscode.OutputChannel,
  credentialManager: CredentialManager
) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return;
  try {
    const token = await credentialManager.getToken();
    if (!token) {
      void vscode.window.showErrorMessage(MSG_SYNC_NO_TOKEN);
      return;
    }

    const globalConfigPath = path.join(os.homedir(), DOCUVIA_DIR_NAME, FILE_GLOBAL_CONFIG_YAML);
    let globalConfigContent = "";
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(globalConfigPath));
      globalConfigContent = Buffer.from(bytes).toString(ENCODING_UTF_8);
    } catch {
      // ignore
    }
    const globalConfig = parseGlobalConfig(globalConfigContent, globalConfigPath);

    const syncService = new SyncService(
      folders[0].uri.fsPath,
      globalConfig?.server_url || DEFAULT_SERVER_URL,
      token,
      (msg: string) => outputChannel.appendLine(MSG_WORKSPACE_SYNC_LOG.replace("{0}", msg))
    );
    let projectId = DEFAULT_PROJECT_ID;
    try {
      const configPath = path.join(folders[0].uri.fsPath, DOCUVIA_DIR_NAME, FILE_LOCAL_CONFIG_JSON);
      const configData = await vscode.workspace.fs.readFile(vscode.Uri.file(configPath));
      const configJson = JSON.parse(Buffer.from(configData).toString(ENCODING_UTF_8)) as Record<
        string,
        unknown
      >;
      if (configJson.projectId) {
        projectId = String(configJson.projectId);
      }
    } catch (err) {
      outputChannel.appendLine(
        MSG_WORKSPACE_SYNC_WARNING_CONFIG.replace("{0}", DOCUVIA_DIR_NAME)
          .replace("{1}", FILE_LOCAL_CONFIG_JSON)
          .replace("{2}", DEFAULT_PROJECT_ID)
      );
    }
    await syncService.sync(projectId);
    void vscode.window.showInformationMessage(MSG_SYNC_SUCCESS);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`${MSG_SYNC_FAILED}${errorMsg}`);
  }
}
