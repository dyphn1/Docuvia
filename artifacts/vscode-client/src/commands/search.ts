import * as vscode from "vscode";
import { SearchResultsPanel } from "../search-results-panel.js";
import {
  MSG_SEARCH_CROSS_PROJECT_UNAVAILABLE,
  MSG_SEARCH_FAILED,
  MSG_SEARCH_PROMPT,
  MSG_SEARCH_PLACEHOLDER,
  MSG_SEARCH_SELECT_TEXT,
  MSG_SEARCH_SELECTION_TRUNCATED,
  DocuviaCommandInvoker,
} from "../constants/index.js";

async function executeSearch(context: vscode.ExtensionContext, query: string) {
  try {
    const config = vscode.workspace.getConfiguration("docuvia");
    const viewPref = config.get<string>("search.defaultView", "chat");

    if (viewPref === "chat") {
      await DocuviaCommandInvoker.executeChatOpen(`@docuvia /query ${query}`);
    } else {
      vscode.window.showInformationMessage(MSG_SEARCH_CROSS_PROJECT_UNAVAILABLE);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`${MSG_SEARCH_FAILED}${errorMsg}`);
  }
}

export async function openSearchCommand(context: vscode.ExtensionContext) {
  const query = await vscode.window.showInputBox({
    prompt: MSG_SEARCH_PROMPT,
    placeHolder: MSG_SEARCH_PLACEHOLDER,
  });
  if (!query || query.trim().length === 0) return;
  await executeSearch(context, query.trim());
}

export async function searchFromSelectionCommand(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage(MSG_SEARCH_SELECT_TEXT);
    return;
  }
  const MAX_QUERY_LENGTH = 2000;
  const rawText = editor.document.getText(editor.selection).trim();
  const selectedText =
    rawText.length > MAX_QUERY_LENGTH ? rawText.slice(0, MAX_QUERY_LENGTH) : rawText;
  if (rawText.length > MAX_QUERY_LENGTH) {
    void vscode.window.showWarningMessage(
      MSG_SEARCH_SELECTION_TRUNCATED.replace("{0}", String(rawText.length)).replace(
        "{1}",
        String(MAX_QUERY_LENGTH)
      )
    );
  }
  await executeSearch(context, selectedText);
}
