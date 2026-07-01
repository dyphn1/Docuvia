import * as vscode from "vscode";
import * as path from "path";
import { minimatch } from "minimatch";
import { TaskRunner } from "../../task-runner.js";

export async function handleExtract(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  taskRunner: TaskRunner
): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  let targetPath = request.prompt.trim() || activeEditor?.document.uri.fsPath;

  if (!targetPath) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length === 1) {
      targetPath = workspaceFolders[0].uri.fsPath;
    } else if (workspaceFolders && workspaceFolders.length > 1) {
      stream.markdown(
        "Multiple workspace folders open. Please provide a path or open a file: `/extract [file-or-folder-path]`"
      );
      return;
    } else {
      stream.markdown(
        "Usage: `/extract [file-or-folder-path]` — queue L3 decision extraction for a file or folder. Open a file first or provide a path."
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
  const config = vscode.workspace.getConfiguration("docuvia");
  const includePatterns = config.get<string[]>("extraction.includePatterns", []);

  const filesToProcess: string[] = [];

  if (stat.type === vscode.FileType.File) {
    filesToProcess.push(targetPath);
  } else if (stat.type === vscode.FileType.Directory) {
    stream.progress(`Scanning directory ${path.basename(targetPath)}...`);

    async function gatherFiles(dirPath: string) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
        for (const [name, type] of entries) {
          if (name === "node_modules" || name === ".git" || name === ".docuvia") continue;
          const fullPath = path.join(dirPath, name);
          if (type === vscode.FileType.Directory) {
            await gatherFiles(fullPath);
          } else if (type === vscode.FileType.File) {
            const relativePath = workspaceRoot
              ? path.relative(workspaceRoot, fullPath).replace(/\\/g, "/")
              : path.basename(fullPath);

            const isIncluded = includePatterns.some((pattern) => minimatch(relativePath, pattern));
            if (isIncluded) {
              filesToProcess.push(fullPath);
            }
          }
        }
      } catch {
        // ignore errors reading subdirectories
      }
    }

    await gatherFiles(targetPath);
  }

  if (filesToProcess.length === 0) {
    stream.markdown(
      `No valid files found to extract in \`${targetPath}\` based on include patterns.`
    );
    return;
  }

  stream.progress(`Queuing extraction for ${filesToProcess.length} files...`);

  let queuedCount = 0;
  for (const filePath of filesToProcess) {
    if (token.isCancellationRequested) break;

    let content = "";
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      content = Buffer.from(bytes).toString("utf-8");
    } catch {
      continue;
    }

    await taskRunner.queueExtraction({
      label: `L3 extract: ${path.basename(filePath)}`,
      content,
      sourceFilePath: filePath,
      token,
    });
    queuedCount++;
  }

  stream.markdown(
    `Successfully queued **${queuedCount}** extraction tasks from \`${path.basename(targetPath)}\`.\n\n` +
      `Check the **Task Queue** panel in the Docuvia sidebar to monitor progress.`
  );
}
