# Knowledge Graph View: Tree Nodes & Structure

## Overview

The Knowledge Graph View is a dedicated VS Code TreeView (`docuvia.knowledgeGraph`) that provides a hierarchical representation of the project's architecture and design decisions across multi-root workspaces.

## Node Hierarchy

> **Note**: The L1/L2/L3 abstraction tiers described below are defined in [ADR-005: Three-tier knowledge graph](../../../adr/ADR-005-knowledge-abstraction-strategy.md).

### 1. Project Nodes (Level 0)

- **Role**: Represents a single VS Code Workspace Folder.
- **Context Value**: `project-initialized` or `project-uninit`.
- **Icon**: `$(root-folder)`
- **Behavior**:
  - Automatically populated for every active workspace folder.
  - Dynamically updates when folders are added or removed from the workspace.
  - If initialized (has `.docuvia/`), expands to show L1 Tags.
  - If uninitialized, exposes an inline `Init` action.

### 2. L1 Tag Nodes (Level 1)

- **Role**: Represents top-level architectural categories (e.g., "Authentication", "UI Core").
- **Data Source**: Local-First SQLite ([ADR-002](../../../adr/ADR-002-local-first-architecture.md)) via Database-as-IPC ([ADR-014](../../../adr/ADR-014-sql-indexed-graph-and-database-as-ipc.md)) (formerly `.docuvia/l1_tags.yaml`)
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
- **Data Source**: SQLite queried via Database-as-IPC, with raw content managed via Git Blob Identity ([ADR-016](../../../adr/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md)) on the `docuvia-knowledge` orphan branch ([ADR-017](../../../adr/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md))
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
  - Automatically created if any entry in `snapshot.routerIndex` has no `l2_module_id`, or one that doesn't match a known module ID.
  - Expands to show the unassigned L3 Entry Nodes.

> ✅ **Implemented**: this is live in `artifacts/vscode-client/src/knowledge-graph-tree-provider.ts` — `getChildren()` for `project` nodes filters `routerIndex` for entries with a missing/invalid `l2_module_id` and, if any exist, appends an `unassigned-group` node; expanding it filters the same set again and returns them as `l3decision` nodes. This directly surfaces the "orphaned decisions" issue noted in [Run Extraction](../command-palette/run-extraction.md) (extraction-created decisions have no `l2_module_id` at all) and [User Journeys](../ui-ux/user-journeys.md).

### 6. Placeholder Nodes

- **Role**: Informational nodes displayed when data is missing.
- **Context Value**: None
- **Icon**: `$(info)`
- **Scenarios**:
  - No workspace open: "No workspace folder open".
  - Empty `local.db`: "No L1 tags found in local.db".

## Data Management & Sync

- **Store**: `KnowledgeGraphTreeProvider` queries `@workspace/core`'s `LocalSnapshotService` directly per node expansion — see [Knowledge Graph State](store.md) for how the legacy `KnowledgeStore` singleton was replaced.
- **Reactivity**: still uses `vscode.workspace.createFileSystemWatcher`, but watching `.docuvia/local.db` (the SQLite file) rather than the legacy YAML files — any change/create/delete event on that file calls `refresh()`, which fires `onDidChangeTreeData` for the whole tree. This is the mechanism that actually keeps the view in sync after writes.

  > ⚠️ **Known bug**: several call sites ([Run Extraction](../command-palette/run-extraction.md), the `/extract` chat handler, `tags.ts`) explicitly call `vscode.commands.executeCommand("docuvia.knowledgeGraph.refresh")` after writing to SQLite — but no command with that exact ID is ever registered (only `docuvia.refreshKnowledgeGraph`, registered in `commands/index.ts` and used correctly by [Init Project](../command-palette/init-project.md)). These calls silently no-op. The tree still ends up refreshed in practice because the `.docuvia/local.db` file watcher above fires independently, but the explicit refresh call itself is dead code today.

- **Lazy Evaluation & Rendering**:
  - By default, nodes below Project are collapsed.
  - `getChildren` dynamically evaluates snapshots by querying `LocalSnapshotService` per call — there is no in-memory cached tree.
- **Snapshot**: Multi-workspace aware, maintaining a Map of snapshots keyed by workspace root path via the Core API.
