# AST Implementation Architecture (V3) Fixes

## Implementation Goals
1. **Fix Git Rename Conflict:** Remove redundant AST similarity matching and rely purely on `git diff-tree -M` for rename tracking.
2. **Fix Lazy Resolution Flaw:** Force AST workers to resolve local function calls against import statements to emit Fully Qualified Names (FQNs) instead of raw strings.
3. **Fix Poison Pill Thrashing:** Implement a Poison Pill Quarantine list for files that trigger timeouts or crashes, preventing endless worker respawns.
4. **Fix IPC Backpressure OOM:** Replace "pausing workers" with a strict ACK-based bounded semaphore protocol for IPC message queues to prevent OOM.
5. **Fix Polyglot Blindness:** Introduce framework-specific AST tracking (tRPC, Next.js Server Actions) alongside OpenAPI to support implicit framework boundaries.

## Approach / Methodology
The goal is to update the V3 architecture document (`ast_implementation_architecture.md`) to integrate the five critical fixes identified by the Verifier. We will directly modify the existing sections (Section 3 for IPC Backpressure, and Challenges 1-4 for the rest) to ensure the design constraints are robust before actual code implementation begins. The edits will replace flawed logic with the new strict invariants.

## Detailed Implementation Steps
1. **Modify Section 3 (Single-Threaded Write Queue with Backpressure)**:
   - **Current:** Mentions pausing parallel parser workers when the queue exceeds a threshold.
   - **New:** Implement a **Strict ACK Protocol / Bounded Job Dispatch**. The main thread must maintain a bounded semaphore (e.g., max 100 in-flight jobs) and wait for ACKs from workers. This strictly bounds the IPC message queue to prevent memory blowups (OOM).

2. **Modify Open Challenge 1 (Node Identity & UUID Stability - Git Rename)**:
   - **Current:** Uses `>80% AST structural similarity` to merge IDs when files are renamed in Git.
   - **New:** Remove the 80% similarity check. Rely *exclusively* on `git diff-tree -M` (or `-C`) for exact rename tracking. FQNs are updated deterministically based on Git's native rename output, saving CPU cycles.

3. **Modify Open Challenge 2 (Cross-Language / Polyglot Edges)**:
   - **Current:** Exclusively relies on API Contracts (OpenAPI/Swagger) as Bridge Nodes.
   - **New:** Expand to cover **Framework-Native Implicit Boundaries**. Relying only on OpenAPI creates polyglot blindness for modern stacks (tRPC, Next.js Server Actions, GraphQL). We will use framework-specific AST plugins to trace these exact RPC boundaries while still rejecting blind regex string matching.

4. **Modify Open Challenge 3 (Parsing Granularity vs. Database Bloat - Lazy Resolution)**:
   - **Current:** Workers extract raw outbound call strings (e.g., `init()`) and do not attempt to build cross-file semantic pointers in memory.
   - **New:** **Scope-Resolved Ingestion**. Extracting raw call strings fails for common names. Workers MUST resolve local call strings against the file's `import` statements (Scope Resolution) to form explicit Fully Qualified Name (FQN) pointers (e.g., `moduleA::init`) *during* ingestion, preventing high collision rates later.

5. **Modify Open Challenge 4 (Fault Tolerance & Timeouts - Poison Pill Thrashing)**:
   - **Current:** A hard timeout of 500ms kills the worker, and the main thread auto-respawns it.
   - **New:** Add a **Poison Pill Quarantine / Blacklist**. If a file kills a worker (timeout or segfault), its hash/path is added to a permanent blacklist. This prevents the newly respawned worker from endlessly retrying the same poison file and causing thrashing.

## Implementation Details
- **Affected Workspace**: `Docuvia`
- **Affected File**: `docs/roadmap/reports/ast_implementation_architecture.md`
- **Affected Packages**: None (Documentation only task)
