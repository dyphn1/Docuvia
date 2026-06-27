# 10. VS Code Webview Topology

**Severity:** 🟡 MEDIUM
**Domain:** IDE UI
**Target:** `@workspace/vscode-client`

## Deficit Description

The current VS Code extension relies on a textual TreeView to display the Knowledge Graph. While functional, it fails to convey the topological relationships (callers/callees) between modules. Text representations fall short of the mental map developers need when assessing blast radius.

## Acceptance Criteria

1. Implement a custom Webview Panel in `@workspace/vscode-client`.
2. Reuse the D3.js/Mermaid logic from the `visualize` CLI command (Issue #09) to render an interactive map inside VS Code.
3. Wire the Webview to listen for SQLite DB update events so the graph updates in real-time as the developer codes.
