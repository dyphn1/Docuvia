# Core Concepts: KnowledgeStore

## Singleton Architecture
`KnowledgeStore` acts as the single source of truth for all Docuvia Knowledge Graph data loaded into the current VS Code instance.

## Multi-Root Workspace Support
The store maintains a `Map<string, KnowledgeGraphSnapshot>`, mapping `workspaceRoot` paths to their individual parsed snapshots.

## Key Methods
- `load()`: Iterates over `vscode.workspace.workspaceFolders`. For each folder, checks if `.docuvia` exists. If so, parses `l1_tags.yaml`, `l2_modules.yaml`, `l3_router.yaml`, and the markdown files in `l3_decisions/`.
- `startWatcher(context)`: Creates a separate `vscode.FileSystemWatcher` for `.docuvia/**` in *every* workspace folder. If any file changes, it calls `load()` again to refresh the snapshots. Also binds `vscode.workspace.onDidChangeWorkspaceFolders` to dynamically handle folders being added/removed.
- `getSnapshotFor(uri)`: Resolves a given file URI or path back to its parent workspace folder, then returns the specific snapshot for that project.
