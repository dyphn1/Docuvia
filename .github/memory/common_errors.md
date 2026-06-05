# Common Errors & Traps

## VS Code Extension Development
- **Multi-root Workspace Trap**: NEVER rely on `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` for file operations. In multi-root workspaces, this resolves to the wrong directory for files in subsequent roots. Always resolve the workspace root dynamically based on the target file's URI: `vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath`.

## Parsing & Data Transformation
- **LLM Output / YAML Nesting Trap**: When parsing structured lists from LLM outputs, do not assume a flat array. LLMs frequently wrap arrays in parent objects (e.g., `{ project_name: "Name", tags: [...] }`). Always defensively check the input type (`Array.isArray()`) and handle nested properties before calling array methods to avoid `.map is not a function` runtime errors.
