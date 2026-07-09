import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { InitService, DOCUVIA_DIR_NAME, WorkspaceGitService } from "@workspace/core";
import {
  MSG_INIT_NO_WORKSPACE,
  MSG_INIT_ALL_INITIALIZED,
  MSG_INIT_SELECT_FOLDER,
  MSG_INIT_DIRTY_TREE,
  MSG_INIT_CONSENT,
  MSG_INIT_GIT_ERROR,
  MSG_INIT_SUCCESS,
  MSG_INIT_ERROR,
  BTN_YES,
  BTN_NO,
  DocuviaCommandInvoker,
} from "../constants/index.js";

export async function initProjectCommand(
  _context: vscode.ExtensionContext,
  node?: { workspaceRoot?: string }
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage(MSG_INIT_NO_WORKSPACE);
    return;
  }

  let targetRoot: string | undefined;

  if (node && node.workspaceRoot) {
    targetRoot = node.workspaceRoot;
  } else if (folders.length === 1) {
    targetRoot = folders[0].uri.fsPath;
  } else {
    const uninitialized = folders.filter(
      (f) => !fs.existsSync(path.join(f.uri.fsPath, DOCUVIA_DIR_NAME))
    );
    if (uninitialized.length === 0) {
      void vscode.window.showInformationMessage(MSG_INIT_ALL_INITIALIZED);
      return;
    }
    const picks = uninitialized.map((f) => ({
      label: f.name,
      description: f.uri.fsPath,
      root: f.uri.fsPath,
    }));
    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: MSG_INIT_SELECT_FOLDER,
    });
    if (!selected) return;
    targetRoot = selected.root;
  }

  if (targetRoot) {
    try {
      const gitService = new WorkspaceGitService();
      const hasChanges = await gitService.hasUncommittedChanges(targetRoot);
      if (hasChanges) {
        void vscode.window.showErrorMessage(MSG_INIT_DIRTY_TREE);
        return;
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`${MSG_INIT_GIT_ERROR}${errorMsg}`);
      return;
    }

    const consent = await vscode.window.showWarningMessage(MSG_INIT_CONSENT, BTN_YES, BTN_NO);
    if (consent !== BTN_YES) return;

    try {
      const initService = new InitService(targetRoot);
      const result = await initService.init();

      await DocuviaCommandInvoker.executeRefreshKnowledgeGraph();
      void vscode.window.showInformationMessage(MSG_INIT_SUCCESS.replace("{0}", result.message));
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(MSG_INIT_ERROR.replace("{0}", errorMsg));
    }
  }
}
