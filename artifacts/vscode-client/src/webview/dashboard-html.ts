import { randomBytes } from "crypto";
import {
  HTML_HEAD_TITLE_DASHBOARD,
  WEBVIEW_NO_DECISIONS,
  WEBVIEW_NO_MODULES,
  DASHBOARD_SECTION_QUICK_START,
  DASHBOARD_SECTION_QUICK_START_DESC,
  DASHBOARD_SECTION_RECENT,
  DASHBOARD_SECTION_TOP_MODULES,
  DASHBOARD_SECTION_REPO_OVERVIEW,
  DASHBOARD_SECTION_REPO_OVERVIEW_DESC,
  DASHBOARD_SECTION_COVERAGE,
  DASHBOARD_SECTION_COVERAGE_TAGS,
  DASHBOARD_SECTION_COVERAGE_MODULES,
  DASHBOARD_SECTION_COVERAGE_DECISIONS,
  DASHBOARD_SECTION_QUEUE,
  DASHBOARD_SECTION_QUEUE_PENDING,
  DASHBOARD_SECTION_QUEUE_IN_PROGRESS,
  DASHBOARD_SECTION_LAST_LOADED,
  DASHBOARD_SECTION_ASK_BUTTON,
  DASHBOARD_OPEN_CHAT_TITLE,
} from "../constants/index.js";

export function getDashboardHtml(cspSource: string): string {
  const nonce = randomBytes(16).toString("hex");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${HTML_HEAD_TITLE_DASHBOARD}</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      padding: 10px 16px;
      background: var(--vscode-sideBarSectionHeader-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 1.1em;
      font-weight: bold;
      flex-shrink: 0;
    }
    .main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .left-pane {
      flex: 65;
      padding: 12px;
      overflow-y: auto;
      border-right: 1px solid var(--vscode-panel-border);
    }
    .right-pane {
      flex: 35;
      padding: 12px;
      overflow-y: auto;
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 10px;
      background: var(--vscode-editorWidget-background);
    }
    .card h3 {
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .stat-row { display: flex; gap: 16px; }
    .stat { font-size: 1.4em; font-weight: bold; }
    .stat-label { font-size: 0.75em; color: var(--vscode-descriptionForeground); }
    ul { list-style: none; }
    li { padding: 3px 0; cursor: pointer; }
    li:hover { color: var(--vscode-textLink-activeForeground); }
    .decision-status {
      font-size: 0.75em;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-left: 6px;
    }
    .bottom-bar {
      padding: 8px 12px;
      background: var(--vscode-editorWidget-background);
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .search-placeholder {
      flex: 1;
      padding: 6px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-placeholderForeground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      font-size: 0.9em;
      cursor: pointer;
      text-align: left;
    }
    .search-placeholder:hover {
      border-color: var(--vscode-focusBorder);
    }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.85em; }
  </style>
</head>
<body>
  <header>
    ${HTML_HEAD_TITLE_DASHBOARD}
    <span id="workspace-name" style="font-weight:normal;color:var(--vscode-descriptionForeground);margin-left:10px;font-size:0.85em;"></span>
  </header>
  <div class="main">
    <div class="left-pane">
      <div class="card">
        <h3>${DASHBOARD_SECTION_QUICK_START}</h3>
        <p style="font-size:0.85em;color:var(--vscode-descriptionForeground);">
          ${DASHBOARD_SECTION_QUICK_START_DESC}
        </p>
      </div>
      <div class="card">
        <h3>${DASHBOARD_SECTION_RECENT}</h3>
        <ul id="recent-decisions"><li class="empty">${WEBVIEW_NO_DECISIONS}</li></ul>
      </div>
      <div class="card">
        <h3>${DASHBOARD_SECTION_TOP_MODULES}</h3>
        <ul id="top-modules"><li class="empty">${WEBVIEW_NO_MODULES}</li></ul>
      </div>
      <div class="card">
        <h3>${DASHBOARD_SECTION_REPO_OVERVIEW}</h3>
        <p style="font-size:0.85em;color:var(--vscode-descriptionForeground);">
          ${DASHBOARD_SECTION_REPO_OVERVIEW_DESC}
        </p>
      </div>
    </div>
    <div class="right-pane">
      <div class="card">
        <h3>${DASHBOARD_SECTION_COVERAGE}</h3>
        <div class="stat-row">
          <div>
            <div class="stat" id="stat-tags">0</div>
            <div class="stat-label">${DASHBOARD_SECTION_COVERAGE_TAGS}</div>
          </div>
          <div>
            <div class="stat" id="stat-modules">0</div>
            <div class="stat-label">${DASHBOARD_SECTION_COVERAGE_MODULES}</div>
          </div>
          <div>
            <div class="stat" id="stat-decisions">0</div>
            <div class="stat-label">${DASHBOARD_SECTION_COVERAGE_DECISIONS}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>${DASHBOARD_SECTION_QUEUE}</h3>
        <div class="stat-row">
          <div>
            <div class="stat" id="stat-pending">0</div>
            <div class="stat-label">${DASHBOARD_SECTION_QUEUE_PENDING}</div>
          </div>
          <div>
            <div class="stat" id="stat-in-progress">0</div>
            <div class="stat-label">${DASHBOARD_SECTION_QUEUE_IN_PROGRESS}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>${DASHBOARD_SECTION_LAST_LOADED}</h3>
        <div id="stat-loaded-at" style="font-size:0.85em;color:var(--vscode-descriptionForeground);">—</div>
      </div>
    </div>
  </div>
  <div class="bottom-bar">
    <button id="open-chat-btn" class="search-placeholder" title="${DASHBOARD_OPEN_CHAT_TITLE}">${DASHBOARD_SECTION_ASK_BUTTON}</button>
    <span>🔍</span>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (msg.type === 'update') {
        renderDashboard(msg.data);
      }
    });

    document.getElementById('open-chat-btn').addEventListener('click', function() {
      vscode.postMessage({ type: 'openChat' });
    });

    function renderDashboard(data) {
      document.getElementById('stat-tags').textContent = String(data.tagCount);
      document.getElementById('stat-modules').textContent = String(data.moduleCount);
      document.getElementById('stat-decisions').textContent = String(data.decisionCount);
      document.getElementById('stat-pending').textContent = String(data.pendingTaskCount);
      document.getElementById('stat-in-progress').textContent = String(data.inProgressTaskCount);
      document.getElementById('stat-loaded-at').textContent =
        data.loadedAt ? new Date(data.loadedAt).toLocaleString() : '—';
      if (data.workspaceName) {
        document.getElementById('workspace-name').textContent = data.workspaceName;
      }

      const decisionsList = document.getElementById('recent-decisions');
      if (data.recentDecisions.length === 0) {
        decisionsList.innerHTML = '<li class="empty">${WEBVIEW_NO_DECISIONS}</li>';
      } else {
        decisionsList.innerHTML = data.recentDecisions.map(function(d) {
          return '<li data-filepath="' + escapeAttr(d.filePath) + '" onclick="openDecision(this.dataset.filepath)">' +
            escapeHtml(d.title) +
            '<span class="decision-status">' + escapeHtml(d.status) + '</span>' +
            '</li>';
        }).join('');
      }

      const modulesList = document.getElementById('top-modules');
      if (data.topModules.length === 0) {
        modulesList.innerHTML = '<li class="empty">${WEBVIEW_NO_MODULES}</li>';
      } else {
        modulesList.innerHTML = data.topModules.map(function(m) {
          return '<li>' + escapeHtml(m.name) +
            ' <span style="color:var(--vscode-descriptionForeground);font-size:0.8em;">(' + m.decisionCount + ' decisions)</span></li>';
        }).join('');
      }
    }

    function openDecision(filePath) {
      vscode.postMessage({ type: 'openDecision', filePath: filePath });
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
      return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  </script>
</body>
</html>`;
}
