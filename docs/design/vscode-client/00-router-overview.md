# VS Code Client Design Router

This directory contains the structural and functional design documentation for the Docuvia VS Code Client (`@workspace/vscode-client`).

AI Agents and developers should consult these files to understand the architecture, command flows, and component responsibilities before making changes to the extension.

## Extension Component Architecture

```mermaid
graph TD
    VSC[VS Code Extension Activation] -->|Registers| CP[Command Palette Commands]
    VSC -->|Registers| Chat[Chat Participant]
    VSC -->|Registers| Tree[Tree View Providers]
    VSC -->|Registers| Edit[CodeLens & Hover Providers]

    CP -->|Uses| Store[KnowledgeStore]
    Chat -->|Uses| Client[CentralServerClient]
    Tree -->|Reads| Store
    Edit -->|Reads| Store

    Store -->|FileSystemWatcher| WS[.docuvia/ local YAML files]
    Client -->|REST API| Server[Docuvia API Server]
```

## Documentation Index

### 1. Knowledge Graph View (`design/knowledge-graph/`)

- [Tree Nodes & Multi-root Structure](knowledge-graph/nodes.md) – Explains `KGNode` hierarchy (`project` -> `l1tag` -> `l2module` -> `l3entry`) and workspace scoping. Implemented in [`KnowledgeGraphTreeProvider.ts`](../src/KnowledgeGraphTreeProvider.ts).
- [Inline Init Action](knowledge-graph/init-action.md) – Describes the contextual `Init` button for uninitialized workspace folders. Registered in [`extension.ts`](../src/extension.ts).
- [Knowledge Store Singleton](knowledge-graph/store.md) – Details the `KnowledgeStore` architecture, snapshot management, and `FileSystemWatcher` integration. Implemented in [`KnowledgeStore.ts`](../src/KnowledgeStore.ts).

### 2. Command Palette Flows (`design/command-palette/`)

- [Init Project](command-palette/init-project.md) – Workflow for `docuvia.initProject` (scaffolding `.docuvia/` files). Implemented in [`extension.ts`](../src/extension.ts).
- [Add Decision](command-palette/add-decision.md) – Workflow for `docuvia.addDecision` and `addDecisionFromSelection`, including L2 module assignment. Implemented in [`extension.ts`](../src/extension.ts).
- [Run Extraction](command-palette/run-extraction.md) – Workflow for `docuvia.runExtraction`, including glob pattern filtering and size limits. Orchestrated by [`TaskRunner.ts`](../src/TaskRunner.ts).
- [Cross-Project Search](command-palette/search.md) – Workflow for `docuvia.openSearch`, mapping results to Webview or Copilot Chat. Implemented in [`SearchResultsPanel.ts`](../src/SearchResultsPanel.ts).

### 3. Settings & Configuration (`design/configuration/`)

- [Settings Overview](configuration/settings.md) – List of user-configurable options defined in [`package.json`](../package.json).

### 4. Copilot Chat Integration (`design/chat-participant/`)

- [Slash Commands](chat-participant/slash-commands.md) – Registration and routing logic for `@docuvia` chat commands (`/explore`, `/query`, `/extract`, `/help`). Implemented in [`ChatParticipant.ts`](../src/ChatParticipant.ts).

### 5. UI/UX Guidelines (`design/ui-ux/`)

- [User Journeys & Scenarios](ui-ux/user-journeys.md) – The 5 core user journeys and how features connect together.
- [Notifications & Prompts](ui-ux/notifications-and-prompts.md) – Standards for toasts, quick picks, and destructive actions.
- [Webview Panels](ui-ux/webview-panels.md) – Design goals and theming for custom views (Search Results, Dashboard). Implemented in [`SearchResultsPanel.ts`](../src/SearchResultsPanel.ts) and [`DashboardPanel.ts`](../src/DashboardPanel.ts).
- [Editor Integration](ui-ux/editor-integration.md) – Guidelines for CodeLens and Hover providers to ensure unobtrusive assistance. Implemented in [`DocuviaCodeLensProvider.ts`](../src/DocuviaCodeLensProvider.ts) and [`DocuviaHoverProvider.ts`](../src/DocuviaHoverProvider.ts).

---

**Note to AI Agents:** When asked to implement or modify a feature in `vscode-client`, always read the corresponding design document here first to ensure you adhere to the established architecture and UX patterns.
