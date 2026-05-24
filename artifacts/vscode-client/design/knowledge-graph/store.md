# Core Concepts: KnowledgeStore

## Singleton Architecture
`KnowledgeStore` acts as the single source of truth for all Docuvia Knowledge Graph data loaded into the current VS Code instance.

## Multi-Root Workspace Support
The store maintains a `Map<string, KnowledgeGraphSnapshot>`, mapping `workspaceRoot` paths to their individual parsed snapshots.

## Key Methods
- `load()`: Iterates over `vscode.workspace.workspaceFolders`. For each folder, checks if `.docuvia` exists. If so, parses `l1_tags.yaml`, `l2_modules.yaml`, `l3_router.yaml`, and the markdown files in `l3_decisions/`.
- `startWatcher(context)`: Creates a separate `vscode.FileSystemWatcher` for `.docuvia/**` in *every* workspace folder. Also binds `vscode.workspace.onDidChangeWorkspaceFolders` to dynamically handle folders being added/removed.
  - **Debounce & Batching**: Events are debounced (e.g., 300ms) to collect a batch of changes, ignoring non-yaml/md temporary files.
  - **Incremental Update vs Full Reload**:
    - Based on configuration `docuvia.knowledgeGraph.incrementalUpdateThreshold` (default 50) and `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold` (default 0.5).
    - If the number of changed files in a batch is within thresholds, the store performs an **Incremental Update** (only parsing changed files and updating specific snapshot entries).
    - If changes exceed thresholds (e.g., git checkout/merge), it falls back to a **Full Reload** for efficiency.
- `getSnapshotFor(uri)`: Resolves a given file URI or path back to its parent workspace folder, then returns the specific snapshot for that project.
