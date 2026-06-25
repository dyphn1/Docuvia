# Command: Docuvia Init Project

## Command Details

- **Command ID**: `docuvia.initProject`
- **Title**: `Docuvia: Init Project`
- **Activation Context**: Available globally via Command Palette, or triggered via inline tree view actions/welcome views (registered in [`extension.ts`](../../../../artifacts/vscode-client/src/extension.ts)).

## Functional Flow

```mermaid
flowchart TD
    Start[Trigger docuvia.initProject] --> PreFlight[Pre-Flight Checks: git status]
    PreFlight -- Modified Tracked Files --> Block[Block: Show "Commit/Stash Changes" Error]
    PreFlight -- Clean --> Resolve[Resolve Workspace Root]
    Resolve --> Choose{Multiple roots?}
    Choose -- Yes --> QuickPick[Show QuickPick of uninitialized roots]
    Choose -- No --> Single[Use single root]
    QuickPick --> Ping[Ping API /health limit: 2000ms]
    Single --> Ping
    Ping -- Success --> OnlineOpts[Show Options: New, Connect, Demo]
    Ping -- Timeout/Fail --> OfflineOpts[Show Options: New, Demo. Connect disabled]
    OnlineOpts -->|Connect| ConnectAPI[Connect to Remote Graph via Server-Side Zero-to-One]
    OfflineOpts -->|New| OfflineConfig[Offline Local-First Architecture Heuristic Fallback]
    OnlineOpts -->|New| AIConfig[AI-Driven Configuration]
    OnlineOpts -->|Demo| CloneDemo[Clone & Explore Demo]
    OfflineOpts -->|Demo| CloneDemo
    AIConfig --> StateCheck[Check Artifact State]
    OfflineConfig --> StateCheck
    StateCheck --> CheckExist{SQLite DB exists?}
    CheckExist -- Yes --> ValidateFiles{All required files exist?}
    ValidateFiles -- No --> Repair[Prompt: Repair Workspace]
    ValidateFiles -- Yes --> Overwrite{docuvia-knowledge branch exists?}
    CheckExist -- No --> BranchCheck{docuvia-knowledge branch exists?}
    BranchCheck -- Yes --> ConnectPrompt[Prompt: Connect to Existing or Reset/Overwrite]
    BranchCheck -- No --> Scaffold[Initialize SQLite DB & Start AST Worker]
    Overwrite -- Yes --> ConnectPrompt
    Overwrite -- No --> Scaffold
    ConnectPrompt -- Overwrite --> Scaffold
    ConnectPrompt -- Connect --> Reload
    Repair --> ScaffoldMissing[Re-sync from Orphan Branch]
    ScaffoldMissing --> Reload
    Scaffold --> Reload[Refresh UI via SQLite IPC]
    ConnectAPI --> Reload
    Reload --> Notify[Show Success Toast]
```

1. **Pre-Flight Checks (The Dirty Git Tree Disaster)**:
   - Before any scaffolding begins, the extension MUST run `git status --porcelain`.
   - If there are modified **tracked** files, the initiation is **blocked** with a clear error: `"Please commit or stash your changes before initializing Docuvia. Creating an orphan branch requires a clean working tree."` Untracked files may be ignored unless they conflict.

2. **Workspace Resolution**:
   - Check if an explicit node was passed (e.g., from an inline tree action). If so, use `node.workspaceRoot`.
   - If no node was passed, check how many workspace folders are currently open.
   - If exactly 1, use it.
   - If multiple:
     - Filter out folders that are already initialized (have a `.docuvia` directory loaded in the store).
     - If all are initialized, show an information message and exit.
     - Display a `QuickPick` menu allowing the user to select one of the remaining uninitialized workspace folders.

3. **Three-Way Choice & Offline Fallback (The "Connect" Black Hole)**:
   - Present three options: `[✨ Initialize Knowledge Graph here (New), 🔗 Connect to Remote Graph (Existing), 📚 Clone & Explore Demo Sandbox (Demo)]`.
   - The "Connect" (remote API) option actively pings for network connectivity via a lightweight `/health` endpoint using an `AbortController` with a strict `2000ms` timeout.
   - If the ping times out or the user is air-gapped, the "Connect" option is **disabled/grayed out** with an `(Offline)` suffix, preventing the UI from hanging infinitely.
   - If the AI server is offline, the "New" path falls back to local-first heuristics for configuration.

4. **State Corruption & Collisions**:
   - If the `docuvia-knowledge` branch already exists locally (checked via `git rev-parse --verify docuvia-knowledge`): Prompt the user to either "Connect to Existing" or "Reset/Overwrite".
   - If the local SQLite DB exists, we perform a **granular schema check** to ensure all required tables are present.
   - If the DB is missing core tables, prompt the user with a "Repair Workspace" option to run migrations safely, without destroying existing data.

5. **Scaffolding (SQLite & Local-First)**:
   - **Explicit Consent**: Transparent artifact creation is mandated. The user must provide explicit consent before the local SQLite database or the `docuvia-knowledge` [Orphan Branch](../../adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md) is created.
   - **Polyfill Strategy**: The command checks if the local SQLite DB already exists to prevent accidental deletion.
   - Initialize the [Local-First SQLite DB](../../adrs/ADR-002-local-first-architecture.md) in the resolved workspace root.
   - Scaffold the internal tables (projects, l1_tags, l2_nodes) using [Database-as-IPC](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md).
   - Boot the [AST Microkernel](../../adrs/ADR-020-unified-isomorphic-ast-microkernel.md) worker to prepare for [Progressive Enrichment](../../adrs/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md).
   - **Force Overwrite**: If the target workspace is already fully initialized but the user invokes this command directly from the palette targeting that workspace, display a warning prompt: `".docuvia already exists. Do you want to overwrite existing files? This action cannot be undone."` before proceeding with destructive generation.

   > ⚠️ **CONFLICT – Force-Overwrite Prompt Not Implemented**: The current `initProject` implementation uses `writeIfAbsent()` for all skeleton files, which silently skips files that already exist. There is no force-overwrite dialog. Additionally, in multi-root scenarios, the folder picker explicitly filters out already-initialized folders, so a fully initialized project can never be selected from the palette at all – there is no code path that would trigger the overwrite prompt. Data is never accidentally destroyed (files are skipped, not overwritten), but a user who wants to intentionally re-initialize a project cannot do so. The overwrite dialog is scheduled for Round 2.

6. **Post-Initialization**:
   - Request the [`KnowledgeStore`](../../src/KnowledgeStore.ts) to reload (reading the newly created files).
   - This reload triggers the `FileSystemWatcher`, which in turn fires the UI update event.
   - Display a success message: `Docuvia: Project "<name>" initialized. Populate the YAML files to build your knowledge graph.`

## Edge Cases Handled

- User cancels project name input (silently aborts).
- User attempts to initialize when no workspace folders are open (shows error).

---

## Known Issues

> ⚠️ **CONFLICT – `parseTags` YAML Format Bug (Critical)**: The skeleton `l1_tags.yaml` generated by `initProject` uses the object format:
>
> ```yaml
> project_name: "MyProject"
> tags:
>   # - id: <uuid>
>   #   slug: ...
> ```
>
> However, [`parser.ts::parseTags`](../../src/parser.ts) calls `parseYaml(content) as unknown[]` and immediately invokes `.map()` on the result. When the file has a top-level object (not an array), `parseYaml` returns a plain object, and `.map()` throws `TypeError: raw.map is not a function`. The `tryParse` wrapper in `KnowledgeStore` catches this silently and returns an empty array. **Any user who populates the `tags:` list in the skeleton file will see zero L1 tags in the Knowledge Graph tree view.** A fix is scheduled for Round 2 (`parseTags` must check if the parsed result is an object with a `tags` property and use that array instead of treating the whole document as a flat list).
