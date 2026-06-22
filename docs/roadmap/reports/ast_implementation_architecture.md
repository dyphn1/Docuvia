# AST Implementation Architecture (V3)

_Debate Summary & Final Architecture Plan_

Following a 5-round adversarial team discussion integrating perspectives from SRE/Security, QA, PM, and System Architecture, Docuvia's AST implementation strategy has been finalized. We drew heavy inspiration from competitor analyses (`GitNexus`, `code-review-graph`, `graphify`, `headroom`) to adapt their best patterns to our Node.js 24 + SQLite local-first environment.

## The 5-Round Debate Summary

1. **Round 1 (Architect)**: Proposed an initial plan using `web-tree-sitter` (WASM) for cross-platform support, a manual hashing step for incremental updates, and a Drizzle ORM ingestion pipeline.
2. **Round 2 (SRE Challenger)**: Brutally critiqued V1. Pointed out that parsing AST in WASM on Node 24 is slow due to V8 boundary costs, `Promise.all` would trigger OOMs, manual hashing ignores Git's built-in tracking, and concurrent SQLite writes would lock the database.
3. **Round 3 (Architect)**: Revised to V2. Proposed native `tree-sitter` bindings, Worker Thread streaming to fix memory issues, `git diff-tree` for O(1) change detection, and a single-threaded Write Queue for SQLite batching.
4. **Round 4 (QA/PM)**: Attacked V2 edge cases. Native bindings are notoriously hard to package in VS Code extensions across OS/archs; what about non-Git folders? Demanded a return to WASM but constrained to workers, and insisted on backpressure for the write queue.
5. **Round 5 (Architect)**: Finalized V3. Blended the SRE performance constraints with the QA/PM deployment realities into the definitive plan below.

---

## Final Architecture Plan (V3)

### 1. Isomorphic WASM Parsing & Zero-LLM Token Cost

We will exclusively use `web-tree-sitter` inside isolated Node.js `worker_threads`. This guarantees zero-compilation portability across both the VS Code extension and the Node.js API server.

- **Zero-LLM Local Graph**: Inspired by `GitNexus` and `graphify`, the AST parsing and Skeleton extraction happens **entirely locally without calling an LLM**. This allows Docuvia to answer deep structural queries and calculate blast radii locally with zero API cost.
- **SRE Compromise:** To prevent IPC serialization bottlenecks and V8 boundary costs, workers will parse the AST internally, execute the compression (extracting only lightweight "Skeletons"—symbols, imports, signatures), and send _only the skeletons_ back to the main thread. Raw ASTs never cross the IPC boundary.

### 2. Sub-second Incremental Updates & Graceful Degradation

Following the pattern from `code-review-graph`, we will not re-parse the world on every save.

- **Incremental Computation:** `git diff-tree` is used as the primary O(1) fast-path to find the exact delta. The system only dispatches the changed files to the AST workers, leaving the rest of the SQLite graph untouched.
- **Fallback Implementation:** For non-versioned folders, the ingestion engine will gracefully degrade to a fallback scanner using `fast-glob` and `xxhash`. This achieves the same incremental effect by skipping files whose `xxhash` content fingerprints have not changed.

### 3. Single-Threaded Write Queue with Strict ACK Protocol (Database Safety)

To ensure ACID compliance and eliminate SQLite/Drizzle `SQLITE_BUSY` contention, all database writes will remain on a strict Single-Threaded Write Queue.

- **File-Based IPC Bypass (JSONL Spooling):** Instead of serializing massive JSON Skeleton objects over Node.js IPC (which balloons the V8 heap and causes garbage collection pauses), workers will write the extracted Skeletons directly to temporary `.jsonl` (JSON Lines) files on the local disk. The worker only sends a tiny IPC message containing the file path (e.g., `{ status: 'done', file: '/tmp/chunk-123.jsonl' }`).
- **Strict ACK Protocol / Bounded Job Dispatch:** To prevent IPC backpressure OOM, the main thread maintains a bounded semaphore (e.g., max 100 in-flight jobs). It reads the `.jsonl` files as streams, waits for ACKs from workers, and uses SQLite bulk-inserts (or `COPY` for Postgres) to ingest the data. This strictly bounds the IPC message queue and ensures the database catches up without memory blowups.

### 4. Config-Driven Dynamic Grammars (Microkernel Plugin Ecosystem)

We will not bloat the extension/server artifact by bundling every single language grammar.

- **Implementation:** A `languages.toml` registry (inspired by `code-review-graph`) will map file extensions to tree-sitter grammars. We will bundle only the core `.wasm` files (TS/JS, Python, Rust, Go) and dynamically download/cache secondary language grammars on-demand when encountered in the user's workspace.

### 5. Strict Separation of AST vs. LSP (The Microkernel Principle)

Addressing previous architectural decisions, this plan strictly decouples AST from LSP.

- **Separation of Concerns:** The AST workers are "dumb, fast, and stateless". They extract syntax and topology but do not attempt complex type-resolution or cross-file inference.
- **Progressive Enrichment:** Heavy Language Server Protocols (LSPs like `tsserver` or `pylance`) are explicitly excluded from this AST pipeline. The Microkernel treats LSP as a separate, on-demand progressive enrichment layer that is only awakened when the AI Agent specifically requests deep type inference, keeping the core AST ingestion lightweight and blazing fast.

---

## Open Implementation Challenges (To Be Resolved)

As we move into the actual coding phase for the AST plugins, the following 4 implementation details must be resolved as Acceptance Criteria:

1. **Node Identity & UUID Stability**: **(Resolved)**
   - **With Git**: Option C (FQN + Git Rename Detection). We use the Fully Qualified Name (e.g., `src/auth.ts::login`) as the primary ID. We rely _exclusively_ on `git diff-tree -M` (or `-C`) for exact rename tracking without any redundant >80% AST similarity checks. FQNs are updated deterministically based on Git's native rename output, saving CPU cycles.
   - **Without Git**: Option B (Structural Content Hash). For non-versioned folders, we rely on the AST structural hash as the fallback identity to track moved/renamed symbols, since we lack Git's `rename` tracking.
2. **Cross-Language / Polyglot Edges**: **(Resolved)** We will use **API Contracts (e.g., OpenAPI/Swagger) as Bridge Nodes** as the primary mechanism. AST scanners will parse contract files (like `openapi.yaml`) into special "Contract Nodes". Both the frontend API client and backend route controllers will map directly to these Contract Nodes.
   - **Framework-Native Implicit Boundaries**: Relying only on OpenAPI creates polyglot blindness for modern stacks. We expand this to use framework-specific AST tracking (e.g., tRPC, Next.js Server Actions, GraphQL) alongside OpenAPI to trace these exact RPC boundaries while still rejecting blind heuristic string matching (regex).
3. **Parsing Granularity vs. Database Bloat**: **(Resolved)** We will adopt **Scope-Resolved Ingestion**. Extracting raw call strings fails for common names (e.g., `init()`). Workers MUST resolve local call strings against the file's `import` statements (Scope Resolution) to form explicit Fully Qualified Name (FQN) pointers (e.g., `moduleA::init`) _during_ ingestion, preventing high collision rates later. These explicit FQN "soft links" (Def-Use chains) will be dynamically resolved via SQL queries at query-time, falling back to the on-demand LSP only when deeper precise disambiguation is required.
4. **Fault Tolerance & Timeouts**: **(Resolved)** The worker pool will enforce strict boundaries to prevent the ingestion pipeline from crashing on malformed or minified files. We will implement:
   - **Explicit Allowlist (Pre-Filtering)**: Only files with extensions explicitly defined in our `languages.toml` (e.g., `.ts`, `.py`, `.go`) are processed. All unknown extensions, binaries, and unsupported languages are instantly dropped during the directory-traversal phase before ever reaching a worker.
   - **Size Limits**: Files exceeding a configurable threshold (e.g., 1MB) or matching known minified patterns (`*.min.js`) will be skipped immediately before parsing.
   - **Poison Pill Quarantine / Blacklist**: If a file kills a worker (timeout of 500ms or segfault), its hash/path is added to a permanent blacklist. This prevents the newly respawned worker from endlessly retrying the same poison file and causing thrashing.
   - **Auto-Respawn**: The main thread will monitor worker health and automatically respawn workers that crash due to Tree-sitter segmentation faults or OOMs.
