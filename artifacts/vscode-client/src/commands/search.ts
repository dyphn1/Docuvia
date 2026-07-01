import * as vscode from "vscode";
import { CentralServerAuthError, CentralServerClient } from "../central-server-client.js";
import { SearchResultsPanel } from "../search-results-panel.js";

async function executeSearch(
  context: vscode.ExtensionContext,
  centralClient: CentralServerClient,
  query: string
) {
  try {
    const config = vscode.workspace.getConfiguration("docuvia");
    const viewPref = config.get<string>("search.defaultView", "chat");

    if (viewPref === "chat") {
      await vscode.commands.executeCommand("workbench.action.chat.open", {
        query: `@docuvia /query ${query}`,
      });
    } else {
      const results = await centralClient.query(query, 20);
      SearchResultsPanel.createOrShow(context, query, results);
    }
  } catch (err) {
    if (err instanceof CentralServerAuthError) {
      void vscode.window.showErrorMessage(
        "Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."
      );
    } else {
      void vscode.window.showErrorMessage(`Docuvia: Search failed — ${String(err)}`);
    }
  }
}

export async function openSearchCommand(
  context: vscode.ExtensionContext,
  centralClient: CentralServerClient
) {
  const query = await vscode.window.showInputBox({
    prompt: "Search cross-project knowledge",
    placeHolder: "e.g. how do other projects handle auth",
  });
  if (!query || query.trim().length === 0) return;
  await executeSearch(context, centralClient, query.trim());
}

export async function searchFromSelectionCommand(
  context: vscode.ExtensionContext,
  centralClient: CentralServerClient
) {
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
  await executeSearch(context, centralClient, selectedText);
}
