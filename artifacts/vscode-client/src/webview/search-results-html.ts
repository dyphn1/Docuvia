import { randomBytes } from "crypto";
import { CentralSearchResult } from "../search-results-panel.js";
import {
  HTML_HEAD_TITLE_SEARCH,
  SEARCH_RESULTS_FOR,
  SEARCH_RESULTS_EMPTY,
} from "../constants/index.js";

export function getSearchResultsHtml(
  cspSource: string,
  query: string,
  results: CentralSearchResult[]
): string {
  const nonce = randomBytes(16).toString("hex");

  const escapeHtml = (str: string): string =>
    str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const highlightKeywords = (text: string, q: string): string => {
    const escaped = escapeHtml(text);
    if (!q.trim()) return escaped;
    const terms = q
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(${terms.join("|")})`, "gi");
    return escaped.replace(pattern, "<mark>$1</mark>");
  };

  // Group results by projectName
  const groups = new Map<string, CentralSearchResult[]>();
  for (const r of results) {
    const arr = groups.get(r.projectName) ?? [];
    arr.push(r);
    groups.set(r.projectName, arr);
  }

  let resultsHtml: string;
  if (results.length === 0) {
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
  <div class="result-snippet">${highlightKeywords(r.snippet, query)}</div>
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
  <title>${HTML_HEAD_TITLE_SEARCH}</title>
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
  <header>${HTML_HEAD_TITLE_SEARCH}</header>
  <div class="query-label">${SEARCH_RESULTS_FOR}<em>${escapeHtml(query)}</em></div>
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
