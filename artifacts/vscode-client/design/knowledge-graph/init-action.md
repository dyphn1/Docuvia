# Knowledge Graph View: Inline Init Action

## Feature Description

An inline action displayed on uninitialized Project nodes within the Knowledge Graph TreeView. This provides a quick, context-aware mechanism to bootstrap Docuvia for a specific workspace folder in a multi-root setup.

## UI Integration

- **View Location**: `docuvia.knowledgeGraph` (Tree View)
- **Menu Registration**: `view/item/context`
- **Condition**: `view == docuvia.knowledgeGraph && viewItem == project-uninitialized`
- **Group**: `inline`
- **Command Dispatched**: `docuvia.initProject`

## Workflow

1. User hovers over an uninitialized workspace folder in the Knowledge Graph tree.
2. The `Init` icon/button appears on the right side of the item.
3. User clicks the `Init` button.
4. VS Code passes the `KGNode` context to the `docuvia.initProject` command handler.
5. The `initProject` function reads `node.workspaceRoot` and bypasses the workspace selection prompt, executing initialization directly on that target folder.

## Fallback

If the view is empty because no workspaces are loaded, a `viewsWelcome` block is shown with an "Initialize Project" button, which calls the same `docuvia.initProject` command but without a specific node context (falling back to prompting if there are multiple workspaces).
