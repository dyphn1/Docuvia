import * as vscode from "vscode";
import { AnalyzeService } from "@workspace/core";

export async function startExploreCommand() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage("Docuvia: No workspace folder open.");
    return;
  }
  const targetRoot = folders[0].uri.fsPath;
  try {
    const analyzeService = new AnalyzeService(targetRoot);
    const result = await analyzeService.analyzeProject();
    void vscode.window.showInformationMessage(
      `Docuvia Analysis: Project Type = ${result.projectType}, Tags = ${result.suggestedTags.join(", ")}`
    );
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Docuvia: Analysis failed - ${err.message}`);
  }
}
