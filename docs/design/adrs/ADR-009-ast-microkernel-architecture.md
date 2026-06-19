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
To eliminate `SQLITE_BUSY` errors and database locking, all writes go through a strict Single-Threaded Write Queue. To bypass V8 memory limits and IPC OOM crashes during massive monorepo ingestion, workers spool their extracted AST skeletons directly to temporary `.jsonl` files on disk. The main thread coordinates with workers using a **Strict ACK Protocol / Bounded Job Dispatch** (e.g., max 100 in-flight jobs) to bound the IPC message queue, and streams the `.jsonl` payloads directly into the database via bulk-insert operations.

### 4. Config-Driven Dynamic Grammars & Provider Plugins
To prevent artifact bloat and support paradigm-shifting languages (e.g., Shell, SQL, Markdown) that cannot map cleanly to a "class/function" model, language grammars and behaviors are managed dynamically via a Provider Ecosystem.
- **Provider Interface**: Instead of a rigid string-mapping `.toml` file, languages are implemented as dynamic `LanguageProvider` modules that export custom scope resolvers and tree-sitter mappings (similar to GitNexus).
- **Zero-Code Registration**: For 90% of OOP/Procedural languages, a simple `.toml` configuration auto-generates a default Provider. For highly divergent languages (like Bash or SQL), teams can drop a custom JavaScript/WASM Provider plugin into the workspace without altering the core API Server logic.
- Only core grammars (TS/JS, Python, Rust, Go) are bundled; others are fetched or executed on-demand.

### 5. Strict Separation of AST vs. LSP
AST parsing is maintained as a "dumb, fast, and stateless" layer. Heavy semantic resolution is deferred to a progressive enrichment LSP layer that is only awakened when deep type inference is explicitly required.

### Resolving Critical SRE/QA Implementation Challenges
- **Node Identity & UUID Stability**: We use FQN (`src/auth.ts::login`). Under Git, we rely *exclusively* on `git diff-tree -M` (or `-C`) for exact rename tracking without redundant AST similarity checks. Without Git, we fall back to AST structural content hashes.
- **Cross-Language / Polyglot Edges**: We rely on API Contracts (e.g., OpenAPI/Swagger) as Bridge Nodes. Furthermore, we expand to cover **Framework-Native Implicit Boundaries** by introducing framework-specific AST tracking (e.g., tRPC, Next.js Server Actions) while still rejecting blind heuristic string matching.
- **Parsing Granularity vs. Database Bloat**: We adopt **Scope-Resolved Ingestion**. Workers MUST resolve local call strings against the file's `import` statements at ingestion to form explicit Fully Qualified Name (FQN) pointers (e.g., `moduleA::init`), preventing query-time ambiguity and collision rates.
- **Fault Tolerance**: The pipeline is hardened with four layers: 
  1. *Explicit Allowlist Pre-Filtering* (`languages.toml`)
  2. *Size Limits* (e.g., skip `>1MB` or `*.min.js`)
  3. *Poison Pill Quarantine / Blacklist* (Kill worker at 500ms, flag file in permanent SQLite blacklist so it is never endlessly retried by respawned workers)
  4. *Auto-Respawn* of crashed workers.

## Consequences
- **Positive**: Complete feature parity with local-first agents regarding structural graph analysis. Eliminates LLM API token waste for context gathering. Rock-solid ingestion pipeline that will not OOM or lock databases on huge repositories.
- **Negative**: Increased complexity handling `worker_threads` and `.jsonl` spool files. Requires maintaining `languages.toml` and domain resolvers for edge cases.