# 11. Sub-second Save Updates

**Severity:** 🟡 MEDIUM
**Domain:** Realtime UX
**Target:** `@workspace/vscode-client`

## Deficit Description
The Git `post-commit` hook successfully captures knowledge at discrete milestones. However, in modern AI-assisted development (Cursor, Copilot), the AI needs context *before* the commit happens—often while the file is actively being edited. The local graph must be continuously fresh.

## Acceptance Criteria
1. Hook into `vscode.workspace.onDidSaveTextDocument` in the extension.
2. When a file is saved, silently trigger the local AST extraction pipeline for that single file.
3. Update the `.docuvia/local.db` instantly. This ensures the AI Agent Hook always retrieves sub-second accurate topological context without waiting for a git commit.
