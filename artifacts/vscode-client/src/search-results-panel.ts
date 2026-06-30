import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { CentralSearchResult } from "./central-server-client.js";

export class SearchResultsPanel {
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

    const panel = vscode.window.createWebviewPanel(
      SearchResultsPanel.viewType,
      "Docuvia: Search Results",
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
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

    this._panel.webview.onDidReceiveMessage(
      (message: { type: string; title?: string }) => this._handleMessage(message),
      null,
      this._context.subscriptions
    );

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

  private _handleMessage(message: { type: string; title?: string }): void {
    if (message.type === "openResult" && message.title) {
      void vscode.commands.executeCommand("workbench.action.chat.open", {
        query: `@docuvia /query ${message.title}`,
      });
    }
  }

  private _buildHtml(): string {
    const nonce = randomBytes(16).toString("hex");
    const cspSource = this._panel.webview.cspSource;

    const escapeHtml = (str: string): string =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const highlightKeywords = (text: string, query: string): string => {
      const escaped = escapeHtml(text);
      if (!query.trim()) return escaped;
      const terms = query
        .trim()
        .split(/\s+/)
        .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const pattern = new RegExp(`(${terms.join("|")})`, "gi");
      return escaped.replace(pattern, "<mark>$1</mark>");
    };

    // Group results by projectName
    const groups = new Map<string, CentralSearchResult[]>();
    for (const r of this._results) {
      const arr = groups.get(r.projectName) ?? [];
      arr.push(r);
      groups.set(r.projectName, arr);
    }

    let resultsHtml: string;
    if (this._results.length === 0) {
      resultsHtml = '<p class="empty">No cross-project results found.</p>';
    } else {
      resultsHtml = [...groups.entries()]
        .map(([projectName, items]) => {
          const cards = items
            .map((r) => {
              const tags =
                r.l1Tags.length > 0
                  ? r.l1Tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ")
                  : "";
              const safeTitle = escapeHtml(r.title);
              return `<div class="result-card" role="button" tabindex="0"
  onclick="openResult(${JSON.stringify(r.title)})">
  <div class="result-title">${safeTitle}</div>
  <div class="result-meta">${tags || "&nbsp;"}</div>
  <div class="result-snippet">${highlightKeywords(r.snippet, this._query)}</div>
</div>`;
            })
            .join("\n");
          return `<section class="project-group">
  <h2 class="project-name">${escapeHtml(projectName)}</h2>
  ${cards}
</section>`;
        })
        .join("\n");
    }

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
    .project-group { margin-bottom: 20px; }
    .project-name {
      font-size: 0.95em;
      font-weight: 600;
      color: var(--vscode-textLink-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 4px;
      margin-bottom: 8px;
    }
    .result-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 8px;
      background: var(--vscode-editorWidget-background);
      cursor: pointer;
    }
    .result-card:hover { background: var(--vscode-list-hoverBackground); }
    .result-title { font-weight: bold; margin-bottom: 4px; }
    .result-meta {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
      min-height: 1em;
    }
    .result-snippet { font-size: 0.85em; line-height: 1.4; }
    .tag {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 0.75em;
      margin-left: 2px;
    }
    mark {
      background: var(--vscode-editor-findMatchHighlightBackground, #ffff0033);
      color: inherit;
      border-radius: 2px;
    }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  </style>
</head>
<body>
  <header>Docuvia: Search Results</header>
  <div class="query-label">Results for: <em>${escapeHtml(this._query)}</em></div>
  ${resultsHtml}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function openResult(title) {
      vscode.postMessage({ type: 'openResult', title });
    }
    document.querySelectorAll('.result-card').forEach(function(card) {
      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { card.click(); }
      });
    });
  </script>
</body>
</html>`;
  }
}
