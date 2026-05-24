# UI/UX: Editor Integration

## CodeLens (`DocuviaCodeLensProvider`)
- **Purpose**: Provide actionable inline commands directly above relevant code blocks (e.g., extracting decisions from a specific function).
- **UX Guidelines**:
  - Keep titles short and action-oriented (e.g., `$(zap) Extract Decision`).
  - Use VS Code codicons (`$(icon-name)`) to provide visual cues.
  - Only show CodeLens where contextually appropriate (e.g., function, class, or interface definitions) to avoid cluttering the user's editor. Too many CodeLenses cause visual fatigue.

## Hover (`DocuviaHoverProvider`)
- **Purpose**: Show knowledge graph context when hovering over known symbols, tags, or references in the code.
- **UX Guidelines**:
  - Use Markdown to format the hover text nicely (e.g., `vscode.MarkdownString`).
  - Include relevant L3 decision titles or brief summaries.
  - Keep it concise. Avoid dumping massive walls of text.
  - Provide actionable links (`[Open Decision](command:docuvia.openDecision?args)`) for deeper reading instead of showing everything inline.