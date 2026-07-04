import * as vscode from "vscode";
import * as path from "path";
import {
  ExtractService,
  openWorkspaceLocalDatabase,
  resolveL2NodeIdForFile,
} from "@workspace/core";

export async function handleExtract(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  let targetPath = request.prompt.trim() || activeEditor?.document.uri.fsPath;

  if (!targetPath) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length === 1) {
      targetPath = workspaceFolders[0].uri.fsPath;
    } else {
      stream.markdown(
        "Usage: `/extract [file-or-folder-path]` — extract L3 decisions from a file."
      );
      return;
    }
  }

  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
  } catch {
    stream.markdown(`Could not find path: \`${targetPath}\``);
    return;
  }

  const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetPath))?.uri
    .fsPath;
  if (!workspaceRoot) {
    stream.markdown("No workspace folder open.");
    return;
  }

  if (stat.type !== vscode.FileType.File) {
    stream.markdown("Directory extraction is simplified in this version. Please provide a file.");
    return;
  }

  stream.progress(`Extracting from ${path.basename(targetPath)}...`);

  try {
    const extractService = new ExtractService(workspaceRoot);
    const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");

    const result = await extractService.extractDecisions(relativePath);
    if (result.decisions && result.decisions.length > 0) {
      const db = openWorkspaceLocalDatabase(workspaceRoot);
      const l2NodeId = resolveL2NodeIdForFile(db, relativePath);
      const insert = db.prepare(
        "INSERT INTO l3_nodes (l2_node_id, title, slug, status, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      );

      db.transaction(() => {
        for (const d of result.decisions) {
          const title = `Extracted from ${path.basename(targetPath)}`;
          const slug = `extracted-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          insert.run(l2NodeId, title, slug, "proposed", d, new Date().toISOString());
        }
      })();
      db.close();

      stream.markdown(
        `Successfully extracted and saved **${result.decisions.length}** decisions from \`${path.basename(targetPath)}\`.`
      );
      vscode.commands.executeCommand("docuvia.knowledgeGraph.refresh");
    } else {
      stream.markdown(`No decisions extracted from \`${path.basename(targetPath)}\`.`);
    }
  } catch (err: any) {
    stream.markdown(`Extraction failed: ${err.message}`);
  }
}
