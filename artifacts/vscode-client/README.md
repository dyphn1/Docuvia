# Docuvia VS Code Client

This is the VS Code Extension component for the Docuvia project. It provides in-editor integration with the Docuvia Knowledge Graph, allowing users to:

- Initialize new Docuvia projects (`.docuvia` scaffolding).
- Explore local architecture and decisions via the Knowledge Graph TreeView.
- Extract design decisions (L3) directly from code.
- Query cross-project knowledge using `@docuvia` in Copilot Chat or the dedicated webview.

## Architecture & Design Documentation

For a comprehensive guide on how features are structured and implemented within this extension, please refer to the **[Design Router](design/ROUTER.md)**.

The `design/` folder contains structural documentation broken down by feature areas:

- `knowledge-graph/`: TreeView nodes, multi-root workspace handling, and the singleton store.
- `command-palette/`: Workflows for initialization, decision extraction, and searching.
- `chat-participant/`: Registration and routing for the `@docuvia` Copilot Chat participant.
- `configuration/`: Standard extension settings.

**Note to Developers/Agents**: Always consult `design/ROUTER.md` before adding new commands or modifying UI states to ensure consistency with the established patterns.

## Development Commands

Run these from the repository root:

```bash
pnpm --filter @workspace/vscode-client run compile
pnpm --filter @workspace/vscode-client run watch
pnpm --filter @workspace/vscode-client run typecheck
```

See the root `AGENTS.md` for global repository rules.
