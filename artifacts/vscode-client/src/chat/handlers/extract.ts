import * as vscode from "vscode";
import * as path from "path";
import { randomUUID } from "crypto";
import { ExtractService } from "@workspace/core";
import {
  openWorkspaceLocalDatabase,
  resolveL2NodeIdForFile,
  saveExtractedDecisions,
} from "../../db-helper.js";
import { TaskQueueTreeProvider } from "../../task-queue-tree-provider.js";
import {
  MSG_EXTRACT_USAGE,
  MSG_EXTRACT_PATH_NOT_FOUND,
  MSG_EXTRACT_NO_WORKSPACE,
  MSG_EXTRACT_DIR_UNSUPPORTED,
  MSG_EXTRACT_EXTRACTING_FROM,
  MSG_EXTRACT_SUCCESS,
  MSG_EXTRACT_NO_DECISIONS,
  MSG_EXTRACT_FAILED,
  DocuviaCommandInvoker,
} from "../../constants/index.js";

export async function handleExtract(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  tqProvider?: TaskQueueTreeProvider
): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  let targetPath = request.prompt.trim() || activeEditor?.document.uri.fsPath;

  if (!targetPath) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length === 1) {
      targetPath = workspaceFolders[0].uri.fsPath;
    } else {
      stream.markdown(MSG_EXTRACT_USAGE);
      return;
    }
  }

  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
  } catch {
    stream.markdown(`${MSG_EXTRACT_PATH_NOT_FOUND}\`${targetPath}\``);
    return;
  }

  const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetPath))?.uri
    .fsPath;
  if (!workspaceRoot) {
    stream.markdown(MSG_EXTRACT_NO_WORKSPACE);
    return;
  }

  if (stat.type !== vscode.FileType.File) {
    stream.markdown(MSG_EXTRACT_DIR_UNSUPPORTED);
    return;
  }

  stream.progress(`${MSG_EXTRACT_EXTRACTING_FROM}${path.basename(targetPath)}...`);

  const taskId = randomUUID();
  tqProvider?.addTask({
    id: taskId,
    label: path.basename(targetPath),
    type: "l3_extraction",
    status: "in_progress",
    createdAt: new Date(),
  });

  try {
    const extractService = new ExtractService(workspaceRoot);
    const relativePath = path.relative(workspaceRoot, targetPath).replace(/\\/g, "/");

    const result = await extractService.extractDecisions(relativePath);
    if (result.decisions && result.decisions.length > 0) {
      const db = openWorkspaceLocalDatabase(workspaceRoot);
      const l2NodeId = resolveL2NodeIdForFile(db, relativePath);

      saveExtractedDecisions(db, l2NodeId, path.basename(targetPath), result.decisions);

      db.close();

      stream.markdown(
        MSG_EXTRACT_SUCCESS.replace("{0}", String(result.decisions.length)).replace(
          "{1}",
          path.basename(targetPath)
        )
      );
      await DocuviaCommandInvoker.executeRefreshKnowledgeGraph();
    } else {
      stream.markdown(`${MSG_EXTRACT_NO_DECISIONS}\`${path.basename(targetPath)}\`.`);
    }
    tqProvider?.updateTaskStatus(taskId, "done", `${result.decisions?.length ?? 0} decisions`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    stream.markdown(`${MSG_EXTRACT_FAILED}${errorMsg}`);
    tqProvider?.updateTaskStatus(taskId, "failed", errorMsg);
  }
}
