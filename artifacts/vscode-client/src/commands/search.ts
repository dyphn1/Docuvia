import * as vscode from "vscode";
import { SearchResultsPanel } from "../search-results-panel.js";

async function executeSearch(context: vscode.ExtensionContext, query: string) {
  try {
    const config = vscode.workspace.getConfiguration("docuvia");
    const viewPref = config.get<string>("search.defaultView", "chat");

    if (viewPref === "chat") {
      await vscode.commands.executeCommand("workbench.action.chat.open", {
        query: `@docuvia /query ${query}`,
      });
    } else {
      vscode.window.showInformationMessage(
        "Cross-project search via UI is temporarily unavailable. Use chat: /query <term> instead."
      );
    }
  } catch (err) {
    void vscode.window.showErrorMessage(`Docuvia: Search failed — ${String(err)}`);
  }
}

export async function openSearchCommand(context: vscode.ExtensionContext) {
  const query = await vscode.window.showInputBox({
    prompt: "Search cross-project knowledge",
    placeHolder: "e.g. how do other projects handle auth",
  });
  if (!query || query.trim().length === 0) return;
  await executeSearch(context, query.trim());
}

export async function searchFromSelectionCommand(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("Docuvia: Select code or text to search.");
    return;
  }
  const MAX_QUERY_LENGTH = 2000;
  const rawText = editor.document.getText(editor.selection).trim();
  const selectedText =
    rawText.length > MAX_QUERY_LENGTH ? rawText.slice(0, MAX_QUERY_LENGTH) : rawText;
  if (rawText.length > MAX_QUERY_LENGTH) {
    void vscode.window.showWarningMessage(
      `Docuvia: Selection was too long (${rawText.length} chars) and was truncated to ${MAX_QUERY_LENGTH} chars for search.`
    );
  }
  await executeSearch(context, selectedText);
}
