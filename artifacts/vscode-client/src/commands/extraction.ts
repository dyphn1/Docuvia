import * as vscode from "vscode";
import * as path from "path";
import { minimatch } from "minimatch";
import { TaskRunner } from "../task-runner.js";

export async function runExtractionCommand(taskRunner: TaskRunner) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Docuvia: Open a file to extract decisions from.");
    return;
  }
  const filePath = editor.document.uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, filePath).replace(/\\/g, "/")
    : path.basename(filePath);

  const config = vscode.workspace.getConfiguration("docuvia");
  const includePatterns = config.get<string[]>("extraction.includePatterns", []);
  const maxLines = config.get<number>("extraction.maxLinesWarning", 1000);

  // Check against include patterns (like .gitignore check)
  const isIncluded = includePatterns.some((pattern) => minimatch(relativePath, pattern));
  if (!isIncluded) {
    const proceed = await vscode.window.showWarningMessage(
      `Docuvia: This file type (${path.basename(filePath)}) is not in your include list. Analyze it anyway?`,
      "Yes",
      "No"
    );
    if (proceed !== "Yes") return;
  }

  // Check line count limit
  const lineCount = editor.document.lineCount;
  if (lineCount > maxLines) {
    const proceed = await vscode.window.showWarningMessage(
      `Docuvia: This file is very large (${lineCount} lines). Analyzing the entire file might be slow and consume many tokens. We recommend selecting a specific block and using right-click "Docuvia: Add Decision from Selection". Proceed anyway?`,
      "Proceed",
      "Cancel"
    );
    if (proceed !== "Proceed") return;
  }

  // Check KB size limit
  const maxKB = config.get<number>("extraction.maxFileSizeKBWarning", 50);
  const fileSizeKB = Buffer.byteLength(editor.document.getText(), "utf-8") / 1024;
  if (fileSizeKB > maxKB) {
    const proceed = await vscode.window.showWarningMessage(
      `Docuvia: This file is large (${fileSizeKB.toFixed(1)} KB). Extraction might be slow. Proceed anyway?`,
      "Proceed",
      "Cancel"
    );
    if (proceed !== "Proceed") return;
  }

  const content = editor.document.getText();
  const tokenSource = new vscode.CancellationTokenSource();
  const taskId = await taskRunner
    .queueExtraction({
      label: `L3 extract: ${path.basename(filePath)}`,
      content,
      sourceFilePath: filePath,
      token: tokenSource.token,
    })
    .finally(() => tokenSource.dispose());
  void vscode.window.showInformationMessage(
    `Docuvia: Extraction task ${taskId} queued. Check Task Queue panel.`
  );
}
