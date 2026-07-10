import * as vscode from "vscode";
import * as path from "path";
import { randomUUID } from "crypto";
import { minimatch } from "minimatch";
import { ExtractService } from "@workspace/core";
import {
  openWorkspaceLocalDatabase,
  resolveL2NodeIdForFile,
  saveExtractedDecisions,
} from "../db-helper.js";
import { addDecisionCommand } from "./decision.js";
import { TaskQueueTreeProvider } from "../task-queue-tree-provider.js";
import {
  MSG_OPEN_FILE_EXTRACT_WARNING,
  BTN_YES,
  BTN_NO,
  BTN_SAVE_DECISION_RECORD,
  MSG_DECISIONS_SAVED,
  MSG_EXTRACTION_NOT_IN_INCLUDE_LIST,
  MSG_EXTRACTION_RESULTS,
  MSG_EXTRACTION_NO_DECISIONS,
  MSG_EXTRACTION_FAILED,
  DocuviaCommandInvoker,
} from "../constants/index.js";

export async function runExtractionCommand(tqProvider?: TaskQueueTreeProvider) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(MSG_OPEN_FILE_EXTRACT_WARNING);
    return;
  }
  const filePath = editor.document.uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) {
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");

  const config = vscode.workspace.getConfiguration("docuvia");
  const includePatterns = config.get<string[]>("extraction.includePatterns", []);

  if (includePatterns.length > 0) {
    const isIncluded = includePatterns.some((pattern) => minimatch(relativePath, pattern));
    if (!isIncluded) {
      const proceed = await vscode.window.showWarningMessage(
        MSG_EXTRACTION_NOT_IN_INCLUDE_LIST.replace("{0}", path.basename(filePath)),
        BTN_YES,
        BTN_NO
      );
      if (proceed !== BTN_YES) return;
    }
  }

  const taskId = randomUUID();
  tqProvider?.addTask({
    id: taskId,
    label: path.basename(filePath),
    type: "l3_extraction",
    status: "in_progress",
    createdAt: new Date(),
  });

  void vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Extracting decisions from ${path.basename(filePath)}`,
      cancellable: false,
    },
    async (progress) => {
      try {
        const extractService = new ExtractService(workspaceRoot);
        const result = await extractService.extractDecisions(relativePath);

        if (result.decisions && result.decisions.length > 0) {
          const decisionsMsg = result.decisions
            .map((d) => `- [${d.nodeType}] ${d.title}`)
            .join("\n");
          const action = await vscode.window.showInformationMessage(
            MSG_EXTRACTION_RESULTS.replace("{0}", String(result.decisions.length)).replace(
              "{1}",
              decisionsMsg
            ),
            { modal: true },
            BTN_SAVE_DECISION_RECORD
          );

          if (action === BTN_SAVE_DECISION_RECORD) {
            const db = openWorkspaceLocalDatabase(workspaceRoot);
            const l2NodeId = resolveL2NodeIdForFile(db, relativePath);

            saveExtractedDecisions(db, l2NodeId, path.basename(filePath), result.decisions);

            db.close();

            vscode.window.showInformationMessage(MSG_DECISIONS_SAVED);
            await DocuviaCommandInvoker.executeRefreshKnowledgeGraph();
          }
        } else {
          vscode.window.showInformationMessage(
            MSG_EXTRACTION_NO_DECISIONS.replace("{0}", path.basename(filePath))
          );
        }
        tqProvider?.updateTaskStatus(taskId, "done", `${result.decisions?.length ?? 0} decisions`);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`${MSG_EXTRACTION_FAILED}${errorMsg}`);
        tqProvider?.updateTaskStatus(taskId, "failed", errorMsg);
      }
    }
  );
}
