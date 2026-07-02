import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { AstProcessingService, GraphDatabaseRepository } from "@workspace/core";

export class AstWatcher {
  private _astProcessor = new AstProcessingService();
  private _graphDbRepo = new GraphDatabaseRepository();
  private _disposables: vscode.Disposable[] = [];

  constructor(private outputChannel: vscode.OutputChannel) {
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.onDidSaveTextDocument(doc))
    );
    this.outputChannel.appendLine("[Docuvia] AST Sub-second Watcher initialized.");
  }

  private async onDidSaveTextDocument(document: vscode.TextDocument) {
    const uri = document.uri;
    if (uri.scheme !== "file") return;

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) return;

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const fsPath = uri.fsPath;

    // Filter out irrelevant directories
    if (fsPath.includes("node_modules") || fsPath.includes(".docuvia") || fsPath.includes(".git")) {
      return;
    }

    // Filter supported extensions
    const extRegex = /\.(ts|js|jsx|tsx|py|go|rs|cpp|c|h|hpp|java|php|rb)$/;
    if (!extRegex.test(fsPath)) {
      return;
    }

    const relativePath = path.relative(workspaceRoot, fsPath).replace(/\\/g, "/");
    const code = document.getText();
    const hash = crypto.createHash("sha256").update(code).digest("hex");

    this.outputChannel.appendLine(`[Docuvia] Fast-path AST extraction for: ${relativePath}`);

    try {
      const parsedResults = await this._astProcessor.processFiles(workspaceRoot, [
        { file: relativePath, hash, code },
      ]);

      if (parsedResults.length > 0) {
        // Assume empty tags array is fine for incremental single-file updates
        // The persist method should handle merging/updating the specific file's graph correctly
        const result = await this._graphDbRepo.persistAstGraph(workspaceRoot, parsedResults, []);
        this.outputChannel.appendLine(
          `[Docuvia] Fast-path AST completed: ${result.updatedCount} nodes updated.`
        );
      }
    } catch (err) {
      this.outputChannel.appendLine(`[Docuvia] Fast-path AST extraction failed: ${err}`);
    }
  }

  public dispose() {
    this._disposables.forEach((d) => d.dispose());
  }
}
