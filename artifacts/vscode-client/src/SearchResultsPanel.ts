import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { CentralSearchResult } from './CentralServerClient.js';

export class SearchResultsPanel {
  static readonly viewType = 'docuvia.searchResults';
  private static _current: SearchResultsPanel | undefined;

  private _query: string;
  private _results: CentralSearchResult[];

  static createOrShow(
    context: vscode.ExtensionContext,
    query: string,
    results: CentralSearchResult[]
  ): void {
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SearchResultsPanel._current) {
      SearchResultsPanel._current._panel.reveal(column);
      SearchResultsPanel._current.pushResults(query, results);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SearchResultsPanel.viewType,
      'Docuvia: Search Results',
      column,
      {
        enableScripts: false,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
        retainContextWhenHidden: true,
      }
    );

    SearchResultsPanel._current = new SearchResultsPanel(panel, query, results, context);
  }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    query: string,
    results: CentralSearchResult[],
    private readonly _context: vscode.ExtensionContext
  ) {
    this._query = query;
    this._results = results;

    this._panel.webview.html = this._buildHtml();

    this._panel.onDidDispose(
      () => {
        SearchResultsPanel._current = undefined;
      },
      null,
      this._context.subscriptions
    );
  }

  pushResults(query: string, results: CentralSearchResult[]): void {
    this._query = query;
    this._results = results;
    this._panel.webview.html = this._buildHtml();
  }

  private _buildHtml(): string {
    const nonce = randomBytes(16).toString('hex');
    const cspSource = this._panel.webview.cspSource;

    const escapeHtml = (str: string): string =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const resultsHtml =
      this._results.length === 0
        ? '<p class="empty">No cross-project results found.</p>'
        : this._results
            .map((r) => {
              const tags =
                r.l1Tags.length > 0
                  ? r.l1Tags
                      .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
                      .join(' ')
                  : '';
              return `<div class="result-card">
  <div class="result-title">${escapeHtml(r.title)}</div>
  <div class="result-meta">${escapeHtml(r.projectName)}${tags ? ' &middot; ' + tags : ''}</div>
  <div class="result-snippet">${escapeHtml(r.snippet)}</div>
</div>`;
            })
            .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Docuvia: Search Results</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
    }
    header {
      font-size: 1.1em;
      font-weight: bold;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 12px;
    }
    .query-label {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin-bottom: 16px;
    }
    .result-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 10px;
      background: var(--vscode-editorWidget-background);
    }
    .result-title {
      font-weight: bold;
      margin-bottom: 4px;
    }
    .result-meta {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    .result-snippet {
      font-size: 0.85em;
      line-height: 1.4;
    }
    .tag {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 0.75em;
      margin-left: 2px;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <header>Docuvia: Search Results</header>
  <div class="query-label">Results for: <em>${escapeHtml(this._query)}</em></div>
  ${resultsHtml}
</body>
</html>`;
  }
}
