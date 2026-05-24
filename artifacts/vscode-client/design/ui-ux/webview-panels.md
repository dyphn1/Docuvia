# UI/UX: Webview Panels

Docuvia uses Webviews for complex data visualization that cannot be represented in a standard TreeView or text editor.

## Search Results Panel (`SearchResultsPanel`)
- **Activation**: Triggered when `docuvia.search.defaultView` is set to `webview`.
- **UX Goal**: Provide a clear, scannable list of cross-project search results.
- **Theming & Visuals**: 
  - Must strictly use VS Code's native Webview CSS variables (`var(--vscode-editor-foreground)`, `var(--vscode-button-background)`, etc.) to ensure the panel matches the user's active theme (Light/Dark/High Contrast).
  - Avoid hardcoding colors.
- **Interaction**:
  - Results should clearly group by Project, L1 Tags, and L2 Modules.
  - Snippets should highlight the matching keywords.
  - Clicking a result should ideally navigate to the file or open a detailed view.

## Dashboard Panel (`DashboardPanel`)
- **UX Goal**: Give an overview of Knowledge Graph health, extraction queues, and unassigned decisions.
- **Theming**: Must seamlessly integrate with the VS Code theme ecosystem, utilizing standard padding and typography variables.
- **Responsiveness**: The layout should adapt gracefully to panel resizing or splitting editors.