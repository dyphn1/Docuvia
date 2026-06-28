# CLI & Core API Parity Status

This document tracks the implementation status of CLI commands, their alignment with the Shared Core API (`@workspace/core`), and parity across other presentation layers (MCP, VS Code).

## Implementation Matrix

| Command | Core Service Dependency | API Alignment | MCP Tool Exists | VS Code Parity | Status / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `init` | `InitService` | ✅ Valid | ✅ `docuvia_init` | ✅ `docuvia.initProject` | Well-aligned. Now uses non-intrusive Git plumbing commands. |
| `analyze` | `AnalyzeService` | ✅ Valid | ✅ `docuvia_analyze` | ✅ `docuvia.startExplore` | Evolving to support full AST scanning via Worker Pool. |
| `extract` | `ExtractService` | ✅ Valid | ✅ `docuvia_extract` | ✅ `docuvia.addDecision` | Well-aligned. |
| `query` | `QueryService` | ✅ Valid | ✅ `docuvia_query_local` | ✅ Chat `query` | MCP uses `QueryService.query()` natively. |
| `clean` | `CleanService` | ✅ Valid | ✅ `docuvia_clean` | ❌ Missing | Core service is instantiated properly with `workspaceRoot`. MCP tool added. |
| `status` | `StatusService` | ✅ Valid | ✅ `docuvia_status` | ❌ Missing | Core service is instantiated properly with `workspaceRoot`. MCP tool added. |
| `detect-changes`| `ChangeDetectionService`| ✅ Valid | ✅ `docuvia_detect_changes` | ❌ Missing | Core service is instantiated properly with `workspaceRoot`. MCP tool added. |
| `sync` | `SyncService` | ✅ Valid | ✅ `docuvia_sync` | ⚠️ Semantic Drift | Logic extracted into `SyncService` cleanly. MCP tool added. VS Code uses `refresh` differently. |

## Architectural Findings & Next Steps

1. **Core API Encapsulation (ADR-021) - ✅ COMPLETED**
   - Extracted `sync` logic from `cli.ts` into a new `SyncService` inside `@workspace/core`.
   - Refactored `mcp/server.ts` to call `QueryService.query()` directly instead of relying on `queryCommand` and monkey-patching `console.log`.

2. **Multi-root Workspace Isolation - ✅ COMPLETED**
   - Refactored `StatusService` and `ChangeDetectionService` to remove `static` methods. They now require a `workspaceRoot` upon instantiation to properly scope database queries and git executions, preventing single-root bias.

3. **Feature Parity - ✅ COMPLETED**
   - Implemented MCP tools for `clean`, `status`, `detect-changes`, and `sync` to achieve full parity with the CLI.

4. **Local CLI Fixes - ✅ COMPLETED**
   - Replaced LLM extraction stub with a real local LLM extraction call in the `docuvia extract` command.
   - Fixed AST Worker Pool paths.
   - Parameterized environmental variables for OpenAI models.

## Brutal Competitor Analysis (Docuvia vs. Industry Standards)

When evaluated against industry-leading context engines and code-intelligence CLIs (e.g., **GitNexus**, **Sourcegraph (Cody / sg)**, **Cursor (Shadow Workspace)**, **GitHub Copilot (Workspace)**), Docuvia's current architecture exhibits several **fatal flaws** that prevent it from being a production-ready knowledge graph.

### 1. Incremental Sync is Non-Existent (The "Delta" Problem)
* **Competitors:** GitNexus uses file hashing (`crypto.createHash('sha256')`) and dirty-tracking to only parse files that have changed. Sourcegraph uses LSIF/SCIP diffs. Cursor relies on fast LSP-based invalidation.
* **Docuvia:** `AnalyzeService.analyzeProject()` currently runs a blind `INSERT` with `crypto.randomUUID()` for every AST node it discovers. If a user runs `docuvia analyze` twice, **the entire graph duplicates**. There is zero upsert logic (`ON CONFLICT DO UPDATE`), zero file hash delta tracking, and no cleanup of deleted files. This makes the CLI completely unusable for automated workflows (like `post-commit` hooks) on large codebases because the SQLite DB will bloat infinitely.

### 2. The WASM Loading Strategy is Held Together by Duct Tape
* **Competitors:** Tree-sitter implementations in robust tools (like `GitNexus` or native Rust tools) either compile parsers directly, bundle `.wasm` explicitly via Webpack/Vite loaders, or rely on native bindings (Node-API).
* **Docuvia:** `AstWorkerPool` and `ast-worker.ts` rely on extremely fragile path resolutions (`node_modules/tree-sitter-wasms/out/...`). Depending on how `pnpm` hoists dependencies (or doesn't), the CLI regularly fails with "WASM not found, falling back to mock". A CLI cannot ship to consumers expecting them to have a specific `node_modules` layout.

### 3. Missing Semantic Call Graph (Edges are Weak)
* **Competitors:** GitNexus builds profound execution flows (`CALLS`, `IMPLEMENTS`, `EXTENDS`, `ACCESSES`). If you query a function, you know exactly what breaks if you change it.
* **Docuvia:** The AST worker only identifies `contains` (File contains Function) and `imports` (File imports Module). There is **no semantic link** showing that `Function A` calls `Function B`. Without this Call Graph, Docuvia is just a glorified `grep`. It cannot answer "What depends on this?".

### 4. L3 Extraction (Agentic RAG) is Disconnected from the Global Scan
* **Competitors:** Context engines automatically link high-level architectural intent (embeddings) to the underlying symbols.
* **Docuvia:** While it claims to be a "Knowledge Graph", `docuvia analyze` only builds `L2 Nodes` (Syntax). The actual LLM-based decision extraction (`L3 Nodes`) is triggered manually via `docuvia extract <file>` and is not integrated into a background pipeline. This means the Knowledge Graph stays functionally empty of "intent" unless the user manually curates every file.

### 🚀 Resolution (The "Survival" Update) - ✅ COMPLETED
The above fatal flaws have been directly addressed and merged to achieve competitive parity:

1. **Incremental Sync (Delta Hashing):** Implemented the `project_files` SQLite table. `AnalyzeService` now computes a `sha256` hash of every file, performing `UPSERT` operations (`ON CONFLICT DO UPDATE`), cleaning up stale nodes, and skipping AST parsing entirely for unchanged files. 
2. **Robust WASM Loading:** Eliminated duct-tape path resolutions. The AST Worker now uses `createRequire(import.meta.url)` and native `require.resolve()` to safely and dynamically locate `tree-sitter-wasms` regardless of the package manager's hoisting strategy.
3. **Semantic Call Graph:** `ast-worker.ts` now traverses `call_expression` AST nodes, extracting target functions and injecting `CALLS` edges into `node_links`, giving Docuvia true "blast radius" query capabilities similar to GitNexus.
4. **Background L3 Extraction (Agentic RAG):** Bridged the gap between global scanning and intent extraction. Introduced the `docuvia analyze --deep` flag, which cascades into `AnalyzeService` to automatically trigger asynchronous background LLM extractions (L3 RAG) after the local AST graph is built.
