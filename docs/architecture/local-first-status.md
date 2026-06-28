# Local-First Architecture Concepts & Status (Docuvia)

_Project Focus: Prioritize Local-First features. Other features are deprioritized unless addressing critical bugs._

## 1. User Interfaces

| Component            | Sub-feature         | Local-First Context                                             | Status / Progress                            | Score (1-10) | Internal Workspace Reference (Inspiration)                            |
| :------------------- | :------------------ | :-------------------------------------------------------------- | :------------------------------------------- | :----------- | :-------------------------------------------------------------------- |
| **VS Code Client**   | Editor Integration  | Seamless local IDE experience, Multi-root workspace support.    | Bare prototype. Massive gap vs Cursor.       | 3            | **code-review-graph-vscode** (MCP tool integration, Webview handling) |
| **CodeLens / Hover** | Context Awakening   | O(1) AST symbol anchoring instead of fuzzy search.              | Planned / Prototyping                        | 3            | **GitNexus** (`context({name: "symbolName"})` O(1) lookup strategies) |
| **Topology**         | Graph Visualization | Local HTML/D3.js visualization (`local-html-visualization`).    | Pending                                      | 1            | **code-review-graph** (D3.js interactive HTML graph generator)        |
| **CLI**              | CLI Tools           | Local `init`, `analyze`, `extract`, `sync`, `query`, `mcp`, `status`, `clean`, and `detect-changes`. | Core implemented, error handling fixed, dual-track routing. Robust but still basic. | 7            | **GitNexus** (`gitnexus-cli` index, analyze, query)                   |

## 2. Infrastructure & Pipeline

| Component             | Sub-feature         | Local-First Context                                                         | Status / Progress                                     | Score (1-10) | Internal Workspace Reference (Inspiration)                          |
| :-------------------- | :------------------ | :-------------------------------------------------------------------------- | :---------------------------------------------------- | :----------- | :------------------------------------------------------------------ |
| **AST Microkernel**   | web-tree-sitter     | Isomorphic offline parsing, native fallback (`native-parsing-fallback`).    | Uses native TS compiler API, but lacks true multi-language web-tree-sitter. | 3            | **code-review-graph** (`parser.py` Tree-sitter + fallbacks)         |
| **Worker Pool**       | Concurrency         | Non-blocking execution in isolated workers (`worker-pool-concurrency`).     | Active                                                | 6            | **GitNexus** (Parallel ingestion pipeline)                          |
| **Local DB**          | SQLite/Drizzle      | High-speed IPC-bypass writing (`local-sqlite-write-pipeline`), L1~L3 nodes. | Basic CRUD. Lacks full graph traversal.               | 4            | **code-review-graph** (`graph.db` SQLite WAL mode)                  |
| **Incremental Sync**  | Hash Deltas & Hooks | `file-hash-delta-detection`, sub-second updates, Git pre/post-commit.       | Uses git diff for delta checks. Safe but not true Turborepo hashing. | 4            | **code-review-graph** (`incremental.py` Git-based change detection) |
| **Git Orphan Branch** | Isomorphic Sync     | Distributing local graphs without cloud via Git orphan branches.            | Conceptual / Prototyping                              | 2            | **Docuvia** (Existing `docuvia-knowledge` branch paradigm)          |
| **Graph Edges**       | Dependency & BFS    | AST dependency edges, local blast radius (`local-bfs-blast-radius`).        | Planned                                               | 3            | **GitNexus** (`gitnexus-impact-analysis` blast radius, BFS)         |

## 3. APIs & AI Protocols

| Component           | Sub-feature     | Local-First Context                                  | Status / Progress                              | Score (1-10) | Internal Workspace Reference (Inspiration)                          |
| :------------------ | :-------------- | :--------------------------------------------------- | :--------------------------------------------- | :----------- | :------------------------------------------------------------------ |
| **MCP Server**      | Context Sharing | Standardized local context for Claude/Cursor.        | Only 3 basic tools. code-review-graph has 30+. | 3            | **code-review-graph** (`main.py` FastMCP server, 30+ tools)         |
| **Intent Router**   | Query Dispatch  | Routing queries to Text, Graph, or Local Embeddings. | Basic routing. Lacks LlamaIndex depth.         | 3            | **Docuvia** (`intent-router.ts` vector/graph/direct hybrid routing) |
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
| **Sync / Refresh**    | `docuvia.refreshKnowledgeGraph`          | ❌ Missing            | `docuvia sync`    | Semantic drift: VS Code "refresh" implies UI reload, while CLI "sync" implies pushing to a remote server. |

**Next Steps for the Development Team:**

1. **Address Semantic Drift in Sync:** Resolve the discrepancy between VS Code `refresh` and CLI `sync`.
