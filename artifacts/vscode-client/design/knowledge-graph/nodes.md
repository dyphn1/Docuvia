# Knowledge Graph View: Tree Nodes & Structure

## Overview
The Knowledge Graph View is a dedicated VS Code TreeView (`docuvia.knowledgeGraph`) that provides a hierarchical representation of the project's architecture and design decisions across multi-root workspaces.

## Node Hierarchy

### 1. Project Nodes (Level 0)
- **Role**: Represents a single VS Code Workspace Folder.
- **Context Value**: `project-initialized` or `project-uninitialized`.
- **Icon**: `$(root-folder)`
- **Behavior**:
  - Automatically populated for every active workspace folder.
  - Dynamically updates when folders are added or removed from the workspace.
  - If initialized (has `.docuvia/`), expands to show L1 Tags.
  - If uninitialized, exposes an inline `Init` action.

### 2. L1 Tag Nodes (Level 1)
- **Role**: Represents top-level architectural categories (e.g., "Authentication", "UI Core").
- **Data Source**: `.docuvia/l1_tags.yaml`
- **Context Value**: `l1tag`
- **Icon**: `$(tag)`
- **Behavior**: Expands to show L2 Modules if modules reference this Tag ID.

### 3. L2 Module Nodes (Level 2)
- **Role**: Represents functional subsystems or specific components (e.g., "OAuth Provider", "Dashboard React Component").
- **Data Source**: `.docuvia/l2_modules.yaml`
- **Context Value**: `l2module`
- **Icon**: `$(package)`
- **Behavior**: Expands to show L3 Entries if decisions reference this Module ID.

### 4. L3 Entry Nodes (Level 3)
- **Role**: Represents individual design decisions or architecture rules.
- **Data Source**: `.docuvia/l3_router.yaml` (index) and `.docuvia/l3_decisions/*.md`
- **Context Value**: `l3entry`
- **Icon**: `$(note)`
- **Behavior**:
  - Terminal node (cannot be expanded).
  - Clicking the node executes `vscode.open` to open the underlying Markdown file in the editor.

### 5. Placeholder Nodes
- **Role**: Informational nodes displayed when data is missing.
- **Context Value**: None
- **Icon**: `$(info)`
- **Scenarios**:
  - No workspace open: "No workspace folder open".
  - Empty `l1_tags.yaml`: "No L1 tags found in l1_tags.yaml".

## Data Management & Sync
- **Store**: Handled by the singleton `KnowledgeStore`.
- **Reactivity**: Uses `vscode.FileSystemWatcher` to monitor changes in `.docuvia/**` across all workspaces. Any file change fires an `onDidChangeTreeData` event to refresh the UI immediately without requiring a manual refresh.
- **Snapshot**: Multi-workspace aware, maintaining a Map of snapshots keyed by workspace root path.
