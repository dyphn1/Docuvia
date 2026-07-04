import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { InitService } from "@workspace/core";

export async function initProjectCommand(
  _context: vscode.ExtensionContext,
  node?: any
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("Docuvia: No workspace folder is open.");
    return;
  }

  let targetRoot: string | undefined;

  if (node && node.workspaceRoot) {
    targetRoot = node.workspaceRoot;
  } else if (folders.length === 1) {
    targetRoot = folders[0].uri.fsPath;
  } else {
    const uninitialized = folders.filter(
      (f) => !fs.existsSync(path.join(f.uri.fsPath, ".docuvia"))
    );
    if (uninitialized.length === 0) {
      void vscode.window.showInformationMessage(
        "Docuvia: All workspace folders are already initialized."
      );
      return;
    }
    const picks = uninitialized.map((f) => ({
      label: f.name,
      description: f.uri.fsPath,
      root: f.uri.fsPath,
    }));
    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: "Select workspace folder to initialize",
    });
    if (!selected) return;
    targetRoot = selected.root;
  }

  if (targetRoot) {
    const cp = require("child_process");
    const util = require("util");
    const exec = util.promisify(cp.exec);

    try {
      const { stdout } = await exec("git status --porcelain", { cwd: targetRoot });
      if (stdout.trim().length > 0) {
        void vscode.window.showErrorMessage(
          "Please commit or stash your changes before initializing Docuvia. Creating an orphan branch requires a clean working tree."
        );
        return;
      }
    } catch (err: any) {
      void vscode.window.showErrorMessage(`Git error: ${err.message}`);
      return;
    }

    const consent = await vscode.window.showWarningMessage(
      "This will create a .docuvia/ folder for settings and a hidden docuvia-knowledge orphan branch for your graph. No source code will be modified. Proceed?",
      "Yes",
      "No"
    );
    if (consent !== "Yes") return;

    try {
      const initService = new InitService(targetRoot);
      const result = await initService.init();

      vscode.commands.executeCommand("docuvia.refreshKnowledgeGraph");
      void vscode.window.showInformationMessage(`Docuvia: ${result.message}`);
    } catch (err: any) {
      void vscode.window.showErrorMessage(`Docuvia: ${err.message}`);
    }
  }
}
