import * as vscode from "vscode";
import { AnalyzeService } from "@workspace/core";
import {
  MSG_EXPLORE_NO_WORKSPACE,
  MSG_EXPLORE_ANALYSIS_FAILED,
  MSG_EXPLORE_PROJECT_ANALYSIS,
} from "../constants/index.js";

export async function startExploreCommand() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage(MSG_EXPLORE_NO_WORKSPACE);
    return;
  }
  const targetRoot = folders[0].uri.fsPath;
  try {
    const analyzeService = new AnalyzeService(targetRoot);
    const result = await analyzeService.analyzeProject();
    void vscode.window.showInformationMessage(
      MSG_EXPLORE_PROJECT_ANALYSIS.replace("{0}", String(result.projectType)).replace(
        "{1}",
        result.suggestedTags.join(", ")
      )
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`${MSG_EXPLORE_ANALYSIS_FAILED}${errorMsg}`);
  }
}
