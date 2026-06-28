# Local-First Architecture Concepts & Status (Docuvia)

_Project Focus: Prioritize Local-First features. Other features are deprioritized unless addressing critical bugs._

## 1. User Interfaces

| Component            | Sub-feature         | Local-First Context                                             | Status / Progress                            | Score (1-10) | Internal Workspace Reference (Inspiration)                            |
| :------------------- | :------------------ | :-------------------------------------------------------------- | :------------------------------------------- | :----------- | :-------------------------------------------------------------------- |
| **VS Code Client**   | Editor Integration  | Seamless local IDE experience, Multi-root workspace support.    | Command Parity reached. Blast radius CodeLens and Hover active. | 8            | **code-review-graph-vscode** (MCP tool integration, Webview handling) |
| **CodeLens / Hover** | Context Awakening   | O(1) AST symbol anchoring instead of fuzzy search.              | Active. Integrates `getImpact()` and `getContext()` from SQLite directly. | 8            | **GitNexus** (`context({name: "symbolName"})` O(1) lookup strategies) |
| **Topology**         | Graph Visualization | Local HTML/D3.js visualization (`local-html-visualization`).    | Pending                                      | 1            | **code-review-graph** (D3.js interactive HTML graph generator)        |
| **CLI**              | CLI Tools           | Local `init`, `analyze`, `extract`, `sync`, `query`, `mcp`, `status`, `clean`, and `detect-changes`. | Production parity reached. Features git-native delta hash, background RAG, and pure plumbing. | 9            | **GitNexus** (`gitnexus-cli` index, analyze, query)                   |

## 2. Infrastructure & Pipeline

| Component             | Sub-feature         | Local-First Context                                                         | Status / Progress                                     | Score (1-10) | Internal Workspace Reference (Inspiration)                          |
| :-------------------- | :------------------ | :-------------------------------------------------------------------------- | :---------------------------------------------------- | :----------- | :------------------------------------------------------------------ |
| **AST Microkernel**   | web-tree-sitter     | Isomorphic offline parsing, native fallback (`native-parsing-fallback`).    | Active. Multi-language Web-tree-sitter worker pool with dynamic resolution. | 8            | **code-review-graph** (`parser.py` Tree-sitter + fallbacks)         |
| **Worker Pool**       | Concurrency         | Non-blocking execution in isolated workers (`worker-pool-concurrency`).     | Active. Used by `AnalyzeService` for global AST scanning. | 8            | **GitNexus** (Parallel ingestion pipeline)                          |
| **Local DB**          | SQLite/Drizzle      | High-speed IPC-bypass writing (`local-sqlite-write-pipeline`), L1~L3 nodes. | Robust. Features synchronous bulk UPSERTs and relational schema (L1-L3). | 8            | **code-review-graph** (`graph.db` SQLite WAL mode)                  |
| **Incremental Sync**  | Hash Deltas & Hooks | `file-hash-delta-detection`, sub-second updates, Git pre/post-commit.       | Active. Git-native blob hashing via `ls-files -s`, with graceful manual fallback. | 9            | **code-review-graph** (`incremental.py` Git-based change detection) |
| **Git Orphan Branch** | Isomorphic Sync     | Distributing local graphs without cloud via Git orphan branches.            | Integrated via 100% pure Git plumbing (`git hash-object`, `git commit-tree`). | 9            | **Docuvia** (Existing `docuvia-knowledge` branch paradigm)          |
| **Graph Edges**       | Dependency & BFS    | AST dependency edges, local blast radius (`local-bfs-blast-radius`).        | Active. Parser correctly injects `CALLS` semantic edges into the DB.  | 7            | **GitNexus** (`gitnexus-impact-analysis` blast radius, BFS)         |

## 3. APIs & AI Protocols

| Component           | Sub-feature     | Local-First Context                                  | Status / Progress                              | Score (1-10) | Internal Workspace Reference (Inspiration)                          |
| :------------------ | :-------------- | :--------------------------------------------------- | :--------------------------------------------- | :----------- | :------------------------------------------------------------------ |
| **MCP Server**      | Context Sharing | Standardized local context for Claude/Cursor.        | Only 3 basic tools. code-review-graph has 30+. | 3            | **code-review-graph** (`main.py` FastMCP server, 30+ tools)         |
| **Intent Router**   | Query Dispatch  | Routing queries to Text, Graph, or Local Embeddings. | Deep RAG auto-extraction now fully robust (persists L1/L3 without silent failing). | 8            | **Docuvia** (`intent-router.ts` vector/graph/direct hybrid routing) |
| **Enhanced Search** | Hybrid Search   | FTS5 + Local Vector search.                          | Partial (FTS5 done, Vectors pending)           | 4            | **code-review-graph** (`search.py` FTS5 hybrid search + embeddings) |

## 4. Buffers & Boundaries

| Component       | Sub-feature       | Local-First Context                                       | Status / Progress | Score (1-10) | Internal Workspace Reference (Inspiration)                        |
| :-------------- | :---------------- | :-------------------------------------------------------- | :---------------- | :----------- | :---------------------------------------------------------------- |
| **Inbox Queue** | sys-uncategorized | Handling unclassifiable fragments for batch/human review. | Planned           | 2            | **headroom** / **tolaria** (Task queueing concepts if applicable) |
| **Dirty State** | LSP Pre-warming   | Handling unsaved buffers via background LSP loading.      | Pending Research  | 1            | **GitNexus** (Scope resolution pipeline caching)                  |

---

## 5. Interface Parity Audit (Hexagonal Architecture Alignment)

As defined in [ADR-021](../design/adrs/ADR-021-shared-core-api-and-presentation-layers.md), all interfaces (CLI, MCP, VS Code) must act as presentation layers over a Shared Core API. The Phase 3 tech debt resolution has addressed the major architectural leaks.

| Core Capability       | VS Code (Client)                         | MCP (AI Agent)        | CLI (Terminal)    | Status / Architectural Gap                                                                                |
| :-------------------- | :--------------------------------------- | :-------------------- | :---------------- | :-------------------------------------------------------------------------------------------------------- |
| **Query DB**          | Chat: `@docuvia query`                   | `docuvia_query_local` | `docuvia query`   | **[Resolved]** All interfaces now route through `@workspace/core` using the shared Drizzle schema.        |
| **Initialize DB**     | `docuvia.initProject`                    | `docuvia_init`        | `docuvia init`    | **[Resolved]** Implemented in `ProjectService` inside `@workspace/core`.                                  |
| **Analyze / Explore** | `docuvia.startExplore` / Chat: `explore` | `docuvia_analyze`     | `docuvia analyze` | **[Resolved]** Implemented via `AnalyzeService` using file-scanning logic in `@workspace/core`.           |
| **Extract Decision**  | `docuvia.addDecision` / Chat: `extract`  | `docuvia_extract`     | `docuvia extract` | **[Resolved]** Implemented via `ExtractService` inside `@workspace/core`.                                 |
| **Sync / Refresh**    | `docuvia.sync` (Aliased)                 | ✅ `docuvia_sync`     | `docuvia sync`    | **[Resolved]** VS Code now registers `docuvia.sync`, aligning the vocabulary perfectly across all interfaces. |


## 6. Post-Survival Architecture Re-Evaluation

Following the major Phase 3 refactoring (the "Survival" update), the backend data pipeline and CLI tools have reached near-parity with established benchmarks like **GitNexus**. 

**Where Docuvia Excels:**
* **Indexing & Persistence:** The combination of Git-native blob hashing (falling back to fast-glob), synchronous SQLite UPSERTs, and dynamic Web-tree-sitter workers has given Docuvia an extremely fast and resilient core. 
* **State Isolation:** The Git plumbing approach (orphan branches without working-tree disruption) guarantees zero interference with the user's daily git flow.

**The Remaining Bottlenecks (Where to pivot next):**
1. **Cross-File Resolution Depth:** While we extract `CALLS` edges locally and bridge IDs across files (Ring 3 parity), we lack GitNexus's sophisticated grouping of these edges into high-level global execution flows (`processes`).
2. **Webview UI / Topology:** The Graph Visualization layer in VS Code (Webview) and the browser React client (`kg-engine`) still lack D3.js interactive mappings of the newly enriched SQLite database.

**Next Steps for the Development Team:**

1. **Address Semantic Drift in Sync:** Resolve the discrepancy between VS Code `refresh` and CLI `sync`.
