# Core Concepts: KnowledgeStore (Local-First SQLite DB)

## Database-as-IPC Architecture

In Docuvia v1.0, [`knowledge-store.ts`](../../../../artifacts/vscode-client/src/knowledge-store.ts) is no longer a naive in-memory singleton parsing YAML files. It acts as the robust client-side coordinator that interacts with the [Local-First Architecture](../../adrs/ADR-002-local-first-architecture.md) via [Database-as-IPC](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md).

## Multi-Root Workspace Support

The store dynamically maps `workspaceRoot` paths to their respective Project IDs within the local SQLite database.

## Key Methods & Operations

- `load()`: Iterates over `vscode.workspace.workspaceFolders`. For each folder, it queries the local SQLite database to retrieve the structured [L1/L2/L3 abstraction tiers](../../adrs/ADR-005-knowledge-abstraction-strategy.md). It does **not** read `.docuvia` YAML files, which are deprecated.
- `startWatcher(context)`: Subscribes to changes directly from the [AST Microkernel](../../adrs/ADR-020-unified-isomorphic-ast-microkernel.md).
  - **Reactivity**: Instead of using `vscode.FileSystemWatcher` (which is blind to semantic intent), the VS Code Client receives lightweight IPC control signals from the AST Worker indicating that the SQLite graph has been updated.
  - **Background Debouncing**: All debounce logic is handled natively by the [Asynchronous Metabolism](../../adrs/ADR-008-asynchronous-metabolism.md) worker.
  - **Git Checkout Defense**: Branch switches do not trigger massive reloads. The store leverages [Git Blob Native Identity](../../adrs/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md) to instantly query flipped `is_active` flags in SQLite, executing a fast incremental diff rather than a full UI rebuild.
- `getSnapshotFor(uri)`: Resolves a given file URI to its local SQLite sub-graph, returning the contextual snapshot for CodeLens/Hover enrichment (via [Progressive Enrichment](../../adrs/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md)).
- `onDidLoad` (event): A `vscode.Event<void>` emitted to subscribers (`KnowledgeGraphTreeProvider`, `DashboardPanel`) allowing the UI to repaint when the local SQLite cache updates.

## Offline Writes (CQRS Outbox)

When the user triggers a command (e.g., adding a decision):

1. `KnowledgeStore` writes the change directly into the local SQLite database so the UI updates instantly.
2. The change is inserted into a `SyncOutbox` table.
3. Once the network is restored, the changes are dispatched to the API Server where they are pushed to the [Orphan Branch](../../adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md) to maintain the [Git-Isomorphic Graph](../../adrs/ADR-004-git-isomorphic-graph.md).

---

## Lifecycle / Disposal

`KnowledgeStore` participates in VS Code's extension lifecycle:

- **Activation**: Initializes the SQLite connection pool and spawns the AST Microkernel worker thread.
- **`load()`**: Dispatches the initial graph read.
- **`dispose()`**: Called by `extension.deactivate()`. Safely closes the SQLite connection, terminates the AST Microkernel worker thread, and clears all `onDidLoad` subscriptions to prevent memory leaks in the Extension Host.
