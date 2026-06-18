# ADR-009: AST Microkernel Architecture & Ingestion Pipeline

## Status
Accepted (2026-06-19)

## Context
Following a 5-round adversarial team discussion, we evaluated Docuvia's lack of native AST parsing compared to competitors like `GitNexus`, `code-review-graph`, `graphify`, and `headroom`. To enable deep structural code analysis without relying on expensive language servers (LSP), we need a blazing-fast, token-efficient, local-first AST ingestion pipeline. 

## Decision

We will implement an AST Microkernel Architecture (V3) centered around the following pillars:

### 1. Isomorphic WASM Parsing & Zero-LLM Token Cost
We use `web-tree-sitter` exclusively inside Node.js `worker_threads`. This provides portability across both the VS Code extension and the Node.js API server. By executing parsing and skeleton compression inside the worker, we establish a **Zero-LLM Local Graph**, calculating structural topology and blast radii entirely locally with zero API cost. Raw ASTs are never passed over IPC to prevent V8 IPC serialization overhead.

### 2. Sub-second Incremental Updates & Graceful Degradation
To achieve O(1) incremental computation, we use `git diff-tree -M` as the primary fast-path delta calculator. For workspaces lacking a `.git` repository, the engine gracefully degrades to using `fast-glob` paired with `xxhash` content fingerprints.

### 3. File-Based IPC Bypass & Single-Threaded Write Queue
To eliminate `SQLITE_BUSY` errors and database locking, all writes go through a strict Single-Threaded Write Queue. To bypass V8 memory limits and IPC OOM crashes during massive monorepo ingestion, workers spool their extracted AST skeletons directly to temporary `.jsonl` files on disk. The main thread uses an ACK protocol/Semaphore dispatch to coordinate workers and stream the `.jsonl` payloads directly into the database via bulk-insert operations.

### 4. Config-Driven Dynamic Grammars
To prevent artifact bloat, language grammars are managed dynamically via a `languages.toml` registry. Only core grammars (TS/JS, Python, Rust, Go) are bundled; others are fetched on-demand.

### 5. Strict Separation of AST vs. LSP
AST parsing is maintained as a "dumb, fast, and stateless" layer. Heavy semantic resolution is deferred to a progressive enrichment LSP layer that is only awakened when deep type inference is explicitly required.

### Resolving Critical SRE/QA Implementation Challenges
- **Node Identity & UUID Stability**: We use FQN (`src/auth.ts::login`). Under Git, we explicitly trust `git diff-tree -M` for renames. Without Git, we fall back to AST structural content hashes.
- **Cross-Language / Polyglot Edges**: We rely exclusively on API Contracts (e.g., OpenAPI/Swagger) as Bridge Nodes to map boundaries (e.g., React fetch to Express route). Custom Domain Resolvers can be provided for frameworks lacking explicit contracts (e.g., tRPC). Heuristic string matching is explicitly rejected.
- **Parsing Granularity vs. Database Bloat**: We adopt Statement-Level Extraction. Crucially, we use **In-Worker Import Resolution**, meaning local calls are resolved against explicit `import` statements at ingestion to form FQN pointers, effectively solving query-time ambiguity.
- **Fault Tolerance**: The pipeline is hardened with four layers: 
  1. *Explicit Allowlist Pre-Filtering* (`languages.toml`)
  2. *Size Limits* (e.g., skip `>1MB` or `*.min.js`)
  3. *Hard Timeouts & Quarantine* (Kill worker at 500ms, flag file in SQLite blacklist so it is not retried)
  4. *Auto-Respawn* of crashed workers.

## Consequences
- **Positive**: Complete feature parity with local-first agents regarding structural graph analysis. Eliminates LLM API token waste for context gathering. Rock-solid ingestion pipeline that will not OOM or lock databases on huge repositories.
- **Negative**: Increased complexity handling `worker_threads` and `.jsonl` spool files. Requires maintaining `languages.toml` and domain resolvers for edge cases.