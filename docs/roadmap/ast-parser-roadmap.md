# 🗺️ Docuvia AST Parser Roadmap & Implementation Guide

This document defines the architecture decisions (V3), the upcoming roadmap, and implementation details for the Docuvia AST (Abstract Syntax Tree) Knowledge Graph Ingestion System. It serves as a handoff document for other Agents (e.g., Hermes) to schedule and execute.

---

## 🏗️ Core Architecture Decisions (V3 Final)
After multiple rounds of debate among Architects, SRE/Security, QA, and PMs, we established the following 5 pillars for the AST implementation:

1. **Isomorphic WASM Parsing & Zero-LLM Token Cost**
   - Exclusively use `web-tree-sitter` inside isolated Node.js `worker_threads` to guarantee zero-compilation portability across the VS Code extension and Node.js API server.
   - **Local-First**: Extract "Skeletons" (symbols, imports, signatures) entirely locally without calling an LLM, allowing deep structural queries and blast radius calculations at zero API cost. To avoid V8 boundary overhead, workers return only lightweight Skeletons, never raw ASTs.

2. **Sub-second Incremental Updates & Graceful Degradation**
   - **Git Repositories**: Use `git diff-tree` for O(1) change detection, dispatching only modified files to AST workers and leaving the rest of the graph untouched.
   - **Non-Git Folders**: Gracefully degrade to `fast-glob` + `xxhash`, parsing only files whose content fingerprints have changed.

3. **Single-Threaded Write Queue & Strict ACK Protocol (Database Safety)**
   - **File-Based IPC avoids OOM**: Workers write extracted Skeletons directly to temporary `.jsonl` files and return only the file path via IPC. This prevents massive JSON serialization from crashing the Node.js main thread's heap.
   - **Backpressure**: The main thread maintains a bounded job limit (e.g., max 100), streams the `.jsonl` files, and uses SQLite/PostgreSQL bulk inserts, eliminating `SQLITE_BUSY` deadlocks.

4. **Config-Driven Dynamic Grammars (Microkernel Ecosystem)**
   - Manage grammars dynamically via `languages.toml`. We bundle only core `.wasm` files (TS, Python, Rust, Go) and download/cache secondary grammars on-demand, preventing extension bloat.

5. **Strict Separation of AST vs. LSP**
   - AST workers are "dumb, fast, and stateless"—they extract syntax and topology but do not attempt complex cross-file type inference.
   - Full Language Server Protocols (LSP like `tsserver` or `pylance`) act as a **progressive enrichment layer**, awakened in the background only when an AI Agent requests precise type disambiguation or needs to sync unsaved buffers.

---

## 🛠️ Open Implementation Challenges & Resolution Status

- ✅ **1. Node Identity & UUID Stability**
   - Use "Fully Qualified Name (FQN)" combined with Git rename tracking (`git diff-tree -M`) as the primary ID. For non-versioned folders, we fallback to AST structural hashes.
- ✅ **2. Cross-Language / Polyglot Edges**
   - Parse API Contract files (e.g., `openapi.yaml`) as "Bridge Nodes", combined with framework-native AST tracking (e.g., tRPC, Server Actions) to trace exact RPC boundaries instead of blind regex.
- ✅ **3. Parsing Granularity vs. Database Bloat (Scope-Resolved Ingestion)**
   - Workers resolve call strings against file `import` statements into FQNs (e.g., `moduleA::init`) during ingestion, creating explicit Def-Use chains to reduce collision rates.
- ✅ **4. Fault Tolerance & Timeouts**
   - **Explicit Allowlist**: Process only extensions listed in `languages.toml`.
   - **Size Limits**: Skip files >1MB or minified files (e.g., `.min.js`).
   - **Poison Pill Isolation**: Any file that crashes or exceeds 500ms is added to a permanent blacklist to prevent retry loops.
   - **Auto-Respawn**: Main thread monitors and automatically restarts crashed workers.

---

## Phase 1: Multi-language Support Expansion

**Goal**: Expand parsing capabilities from TypeScript/JavaScript to other mainstream languages in the following priority order.

### Language Implementation Task List

- [x] **1. Python (`tree-sitter-python`)**
  - High priority for AI and backend development. Needs to handle `from module import function` syntax.
- [x] **2. Rust (`tree-sitter-rust`)**
  - Systems programming. Crucial since related projects (tolaria, headroom) use Rust. Requires mapping `struct_item`, `impl_item`, `function_item`.
- [x] **3. Go (`tree-sitter-go`)**
  - Common microservice language. Requires mapping Go packages and Struct method receivers.
- [x] **4. Java (`tree-sitter-java`)**
  - Enterprise backend standard. Needs careful extraction of Classes and Interfaces.
- [x] **5. C/C++ (`tree-sitter-c`, `tree-sitter-cpp`)**
  - System and library layer. Distinct parsing rules for headers (`.h`) vs implementations (`.c`).
- [x] **6. Ruby (`tree-sitter-ruby`)**
  - Supports traditional Web frameworks (e.g., Rails).
- [x] **7. PHP (`tree-sitter-php`)**
  - Covers legacy and modern Web applications.
- [x] **8. C# (`tree-sitter-c-sharp`)**
  - Supports the .NET ecosystem.

**Phase 1 Status**: ✅ 2026-06-24 — All 8 languages (Python, Rust, Go, Java, C/C++, Ruby, PHP, C#) are registered in `artifacts/ast-core/src/language-registry.ts` and validated via compilation.

---

## Phase 2: Query API & Extraction Accuracy

**Goal**: Replace brute-force child-node traversal (`descendantsOfType`) with native Tree-sitter Query APIs to handle complex syntax boundaries.

### Implementation Checklist:

- [x] **Tree-sitter Query Integration**: Add logic in `LanguageProvider` to compile `.scm` syntax queries (e.g., `(class_declaration name: (identifier) @class.name)`).
- [x] **Scope Map & Imports Parsing**:
  - Handle named imports (`import { A as B }`).
  - Handle wildcard imports (`import * as X`).
- [x] **Method vs Function Classification**: When extracting `call_expression`, distinguish between standard function calls `func()` and object method calls `obj.method()` to calculate accurate FQNs.

**Phase 2 Status**: ✅ 2026-06-24 — `initQueries()` implemented in `language-provider.ts`; `buildScopeMap()` and `classifyCall()` implemented in `ast-worker.ts`.

---

## Phase 3: Knowledge Graph Ingestion & Database Integration

**Goal**: Convert `.jsonl` skeleton files generated by `ast-worker.ts` into the official Docuvia Graph structure and persist them to the database.

### Implementation Checklist:

- [x] **Pipeline Integration**: `ast-ingestion-pipeline.ts` implemented to read `.jsonl` and write to `l2_nodes`, `l3_nodes`, and `node_links` tables. Endpoint `POST /projects/:id/ingest/ast` registered.
- [ ] **Topology Mapping**:
  - Map Files to `l2_nodes` (or equivalent entities).
  - Map Classes/Functions to `l3_nodes` (or specific Symbol Nodes).
- [ ] **Edge Creation**: Transform extracted `calls` and `imports` into `CALLS` or `DEPENDS_ON` records in the `node_links` table.

---

## Phase 4: Resilience & Scalability Limits

**Goal**: Ensure the system handles tens of thousands of files across large repositories without hanging or crashing.

### Implementation Checklist:

- [x] **Poison Pill Quarantine**: Implemented `quarantine-db.ts` (SQLite). If a file takes >500ms to parse, terminate the worker and quarantine the file to prevent OOM loops.
- [ ] **Batch Write Optimization**: For `.jsonl` files with tens of thousands of lines, implement streaming reads and chunked batch `INSERT`s to prevent PostgreSQL performance degradation.

**Phase 4 Status**: ✅ Poison Pill implemented in `ast-worker-pool.ts` (500ms timeout + AbortController + quarantine). ⏳ Batch Write Optimization pending.

---
