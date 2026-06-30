# Knowledge Graph View: Tree Nodes & Structure

## Overview

The Knowledge Graph View is a dedicated VS Code TreeView (`docuvia.knowledgeGraph`) that provides a hierarchical representation of the project's architecture and design decisions across multi-root workspaces.

## Node Hierarchy

> **Note**: The L1/L2/L3 abstraction tiers described below are defined in [ADR-005: Three-tier knowledge graph](../../adrs/ADR-005-knowledge-abstraction-strategy.md).

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
- **Data Source**: Local-First SQLite ([ADR-002](../../adrs/ADR-002-local-first-architecture.md)) via Database-as-IPC ([ADR-014](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md)) (formerly `.docuvia/l1_tags.yaml`)
- **Context Value**: `l1tag`
- **Icon**: `$(tag)`
- **Behavior**: Expands to show L2 Modules if modules reference this Tag ID.

### 3. L2 Module Nodes (Level 2)

- **Role**: Represents functional subsystems or specific components (e.g., "OAuth Provider", "Dashboard React Component").
- **Data Source**: Local-First SQLite via Database-as-IPC (formerly `.docuvia/l2_modules.yaml`)
- **Context Value**: `l2module`
- **Icon**: `$(package)`
- **Behavior**: Expands to show L3 Entries if decisions reference this Module ID.

### 4. L3 Entry Nodes (Level 3)

- **Role**: Represents individual design decisions or architecture rules.
- **Data Source**: SQLite queried via Database-as-IPC, with raw content managed via Git Blob Identity ([ADR-016](../../adrs/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md)) on the `docuvia-knowledge` orphan branch ([ADR-017](../../adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md))
- **Context Value**: `l3entry`
- **Icon**: `$(note)`
- **Behavior**:
  - Terminal node (cannot be expanded).
  - Clicking the node executes `vscode.open` to open the underlying Markdown file in the editor.

### 5. Unassigned Decisions Node (Virtual Level 1)

- **Role**: A virtual container node directly under the Project node to group L3 entries that haven't been assigned to an L2 module.
- **Context Value**: `unassigned-group`
- **Icon**: `$(question)`
- **Behavior**:
  - Automatically created if there are L3 decisions where `l2_module_id: unassigned` or the ID is missing/invalid.
  - Expands to show the unassigned L3 Entry Nodes.

> ⚠️ **CONFLICT – Not Implemented**: The `unassigned-group` node is fully specified above but is **absent from [`knowledge-graph-tree-provider.ts`](../../../../artifacts/vscode-client/src/knowledge-graph-tree-provider.ts)**. The current `getChildren` implementation for `project` nodes only iterates L1 tags; it never checks for decisions with `l2_module_id === 'unassigned'` or an unmapped ID, and never appends an `unassigned-group` item. This node type will remain invisible to users until Round 2 adds the required logic to `KnowledgeGraphTreeProvider`.

### 6. Placeholder Nodes

- **Role**: Informational nodes displayed when data is missing.
- **Context Value**: None
- **Icon**: `$(info)`
- **Scenarios**:
  - No workspace open: "No workspace folder open".
  - Empty `local.db`: "No L1 tags found in local.db".

## Data Management & Sync

- **Store**: Handled by the singleton [`KnowledgeStore`](../../../../artifacts/vscode-client/src/knowledge-store.ts).
- **Reactivity**: Triggered via Database-as-IPC ([ADR-014](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md)) and AST Microkernel events ([ADR-020](../../adrs/ADR-020-unified-isomorphic-ast-microkernel.md)), replacing legacy `vscode.FileSystemWatcher` on `.docuvia/**`.
- **Lazy Evaluation & Rendering**:
  - By default, nodes below Project are collapsed.
  - `getChildren` dynamically evaluates snapshots.
  - When `onDidChangeTreeData` is fired, the store attempts to pass specific affected Project nodes for localized UI repaints, rather than rebuilding the entire multi-root tree.
- **Snapshot**: Multi-workspace aware, maintaining a Map of snapshots keyed by workspace root path.
