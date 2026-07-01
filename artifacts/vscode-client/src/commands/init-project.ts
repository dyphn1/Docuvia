import * as vscode from "vscode";
import * as path from "path";
import { InitService } from "@workspace/core";
import { CentralServerClient } from "../central-server-client.js";
import { KnowledgeStore } from "../knowledge-store.js";

export async function initProjectCommand(
  _context: vscode.ExtensionContext,
  store: KnowledgeStore,
  centralClient: CentralServerClient,
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
    const uninitialized = folders.filter((f) => !store.snapshots.has(f.uri.fsPath));
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
    // Security: Validate targetRoot against path traversal
    const relativeToWorkspace = path.relative(
      folders.map((f) => f.uri.fsPath).join(","),
      targetRoot
    );
    if (relativeToWorkspace.startsWith("..")) {
      void vscode.window.showErrorMessage(
        "Docuvia: Invalid project root (path traversal attempt)."
      );
      return;
    }

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

    const NEW_GRAPH = "✨ Initialize Knowledge Graph here (New)";
    const CONNECT_GRAPH = "🔗 Connect to Remote Graph (Existing)";
    const DEMO_GRAPH = "📚 Clone & Explore Demo Sandbox (Demo)";

    const action = await vscode.window.showQuickPick([NEW_GRAPH, CONNECT_GRAPH, DEMO_GRAPH], {
      placeHolder: "Select Initialization Option",
    });

    if (!action) return;

    if (action === DEMO_GRAPH) {
      void vscode.window.showErrorMessage("Demo cloning is not yet implemented.");
      return;
    }

    if (action === CONNECT_GRAPH) {
      if (!centralClient || !centralClient.isServerConfigured()) {
        void vscode.window.showWarningMessage(
          "Cannot connect to remote graph. Server is offline or unreachable."
        );
        return;
      }
      try {
        const serverUrl = store.globalConfig?.server_url;
        await fetch(`${serverUrl}/health`);
        void vscode.window.showInformationMessage("Connected to remote graph successfully.");
      } catch {
        void vscode.window.showWarningMessage(
          "Cannot connect to remote graph. Server is offline or unreachable."
        );
      }
      return;
    }

    if (action === NEW_GRAPH) {
      const consent = await vscode.window.showWarningMessage(
        "This will create a .docuvia/ folder for settings and a hidden docuvia-knowledge orphan branch for your graph. No source code will be modified. Proceed?",
        "Yes",
        "No"
      );
      if (consent !== "Yes") return;

      try {
        const initService = new InitService(targetRoot);
        const result = await initService.init();

        await store.load();
        vscode.commands.executeCommand("docuvia.refreshKnowledgeGraph");
        void vscode.window.showInformationMessage(`Docuvia: ${result.message}`);
      } catch (err: any) {
        void vscode.window.showErrorMessage(`Docuvia: ${err.message}`);
      }
    }
  }
}
