import * as vscode from "vscode";
import { BaseWebviewPanel } from "./webview/base-panel.js";
import { getSearchResultsHtml } from "./webview/search-results-html.js";

export interface CentralSearchResult {
  title: string;
  projectName: string;
  snippet: string;
  l1Tags: string[];
}

export class SearchResultsPanel extends BaseWebviewPanel {
  static readonly viewType = "docuvia.searchResults";
  private static _current: SearchResultsPanel | undefined;

  private _query: string;
  private _results: CentralSearchResult[];

  static createOrShow(
    context: vscode.ExtensionContext,
    query: string,
    results: CentralSearchResult[]
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SearchResultsPanel._current) {
      SearchResultsPanel._current._panel.reveal(column);
      SearchResultsPanel._current.pushResults(query, results);
      return;
    }

    const panel = BaseWebviewPanel.createPanel(
      context,
      SearchResultsPanel.viewType,
      "Docuvia: Search Results",
      column
    );

    SearchResultsPanel._current = new SearchResultsPanel(panel, context, query, results);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    query: string,
    results: CentralSearchResult[]
  ) {
    super(panel, context);
    this._query = query;
    this._results = results;
    this._panel.webview.html = this._buildHtml();
  }

  pushResults(query: string, results: CentralSearchResult[]): void {
    this._query = query;
    this._results = results;
    this._panel.webview.html = this._buildHtml();
  }

  protected _handleMessage(message: { type: string; title?: string }): void {
    if (message.type === "openResult" && message.title) {
      void vscode.commands.executeCommand("workbench.action.chat.open", {
        query: `@docuvia /query ${message.title}`,
      });
    }
  }

  protected _onDispose(): void {
    SearchResultsPanel._current = undefined;
  }

  private _buildHtml(): string {
    return getSearchResultsHtml(this._panel.webview.cspSource, this._query, this._results);
  }
}
