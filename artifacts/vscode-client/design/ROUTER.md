# VS Code Client Design Router

This directory contains the structural and functional design documentation for the Docuvia VS Code Client (`@workspace/vscode-client`).

AI Agents and developers should consult these files to understand the architecture, command flows, and component responsibilities before making changes to the extension.

## Documentation Index

### 1. Knowledge Graph View (`design/knowledge-graph/`)
- [Tree Nodes & Multi-root Structure](knowledge-graph/nodes.md) - Explains `KGNode` hierarchy (`project` -> `l1tag` -> `l2module` -> `l3entry`) and workspace scoping.
- [Inline Init Action](knowledge-graph/init-action.md) - Describes the contextual `Init` button for uninitialized workspace folders.
- [Knowledge Store Singleton](knowledge-graph/store.md) - Details the `KnowledgeStore` architecture, snapshot management, and `FileSystemWatcher` integration.

### 2. Command Palette Flows (`design/command-palette/`)
- [Init Project](command-palette/init-project.md) - Workflow for `docuvia.initProject` (scaffolding `.docuvia/` files).
- [Add Decision](command-palette/add-decision.md) - Workflow for `docuvia.addDecision` and `addDecisionFromSelection`, including L2 module assignment.
- [Run Extraction](command-palette/run-extraction.md) - Workflow for `docuvia.runExtraction`, including glob pattern filtering and size limits.
- [Cross-Project Search](command-palette/search.md) - Workflow for `docuvia.openSearch`, mapping results to Webview or Copilot Chat.

### 3. Settings & Configuration (`design/configuration/`)
- [Settings Overview](configuration/settings.md) - List of user-configurable options defined in `package.json` (e.g., search view routing, extraction glob patterns).

### 4. Copilot Chat Integration (`design/chat-participant/`)
- [Slash Commands](chat-participant/slash-commands.md) - Registration and routing logic for `@docuvia` chat commands (`/explore`, `/query`, `/extract`, `/help`).

### 5. UI/UX Guidelines (`design/ui-ux/`)
- [Notifications & Prompts](ui-ux/notifications-and-prompts.md) - Standards for toasts, quick picks, and destructive actions.
- [Webview Panels](ui-ux/webview-panels.md) - Design goals and theming for custom views (Search Results, Dashboard).
- [Editor Integration](ui-ux/editor-integration.md) - Guidelines for CodeLens and Hover providers to ensure unobtrusive assistance.

---

**Note to AI Agents:** When asked to implement or modify a feature in `vscode-client`, always read the corresponding design document here first to ensure you adhere to the established architecture and UX patterns.