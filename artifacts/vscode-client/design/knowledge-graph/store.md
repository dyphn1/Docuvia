# Core Concepts: KnowledgeStore

## Singleton Architecture

[`KnowledgeStore`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/KnowledgeStore.ts) acts as the single source of truth for all Docuvia Knowledge Graph data loaded into the current VS Code instance.

## Multi-Root Workspace Support

The store maintains a `Map<string, KnowledgeGraphSnapshot>`, mapping `workspaceRoot` paths to their individual parsed snapshots.

## Key Methods

- `load()`: Iterates over `vscode.workspace.workspaceFolders`. For each folder, checks if `.docuvia` exists. If so, parses `l1_tags.yaml`, `l2_modules.yaml`, `l3_router.yaml`, and the markdown files in `l3_decisions/`.
- `startWatcher(context)`: Creates a separate `vscode.FileSystemWatcher` for `.docuvia/**` in _every_ workspace folder. Also binds `vscode.workspace.onDidChangeWorkspaceFolders` to dynamically handle folders being added/removed.
  - **Debounce & Batching**: Events are debounced (e.g., 300ms) to collect a batch of changes, ignoring non-yaml/md temporary files.
  - **Incremental Update vs Full Reload**:
    - Based on configuration `docuvia.knowledgeGraph.incrementalUpdateThreshold` (default 50) and `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold` (default 0.5).
    - If the number of changed files in a batch is within thresholds, the store performs an **Incremental Update** (only parsing changed files and updating specific snapshot entries).
    - If changes exceed thresholds (e.g., git checkout/merge), it falls back to a **Full Reload** for efficiency.
- `getSnapshotFor(uri)`: Resolves a given file URI or path back to its parent workspace folder, then returns the specific snapshot for that project.
- `onDidLoad` (event): A `vscode.Event<void>` emitted by the internal `_onDidLoad` EventEmitter after every successful `load()` call. Subscribers (`KnowledgeGraphTreeProvider`, `DashboardPanel`) use this event to refresh their UI without polling. Subscribe via `store.onDidLoad(() => { /* refresh */ })`.

> ⚠️ **CONFLICT – Debounce and Incremental Update Not Implemented**: The current `KnowledgeStore.startWatcher()` implementation calls `void this.load()` **immediately** on every `onDidCreate`, `onDidChange`, and `onDidDelete` event – there is no 300ms debounce, no batch collection, and no incremental update path. The `docuvia.knowledgeGraph.incrementalUpdateThreshold` and `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold` settings have no effect at runtime (and are also absent from `package.json`). Full debounce + incremental update is scheduled for Round 2.

---

## Lifecycle / Disposal

`KnowledgeStore` participates in VS Code's extension lifecycle:

- **Activation**: `KnowledgeStore.getInstance(outputChannel)` returns (or creates) the singleton. The singleton is created once per extension host process.
- **`load()`**: Called once immediately after activation, and thereafter by `startWatcher` callbacks and by `initProject`/`runExtraction` after they write files.
- **`dispose()`**: Called by `extension.deactivate()` via `KnowledgeStore.getInstance(outputChannel).dispose()`. Disposes all active `FileSystemWatcher` instances, calls `_onDidLoad.dispose()`, and resets the static `_instance` to `null` so the singleton can be recreated in tests.

> ⚠️ **CONFLICT – `parseTags` Silent Failure on `project_name` + `tags:` Format**: [`parser.ts::parseTags`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/parser.ts) calls `parseYaml(content) as unknown[]` and immediately calls `.map()` on the result. When `l1_tags.yaml` uses the skeleton's object format (`{ project_name: "...", tags: [{...}] }`), the parsed value is a plain object – not an array – and calling `.map()` throws `TypeError: raw.map is not a function`. The `tryParse` wrapper in `KnowledgeStore` catches this silently and returns `[]`. **Any user who follows the generated skeleton and populates the `tags:` array will see zero L1 tags in the tree view.** A fix is scheduled for Round 2 (`parseTags` should check if the result has a `tags` property and use it as the list).
