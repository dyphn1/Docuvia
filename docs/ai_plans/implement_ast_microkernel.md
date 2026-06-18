# Implementation Plan: AST Microkernel (Phase 1)

## Reference
- **ADR**: `docs/design/adrs/ADR-009-ast-microkernel-architecture.md`
- **Roadmap**: Milestone 4.1 & 4.3

## Objective
Establish the foundational AST Microkernel inside `@workspace/api-server`. This phase will focus on setting up the Worker Pool, the `web-tree-sitter` WASM execution environment, and the File-Based IPC Bypass (JSONL Spooling) to prevent memory issues.

## Tasks

### 1. Dependencies & Infrastructure
- Navigate to `artifacts/api-server`.
- Install `web-tree-sitter` (for isomorphic parsing) and `piscina` (or use native `worker_threads` if preferred, but `piscina` handles pooling nicely) as dependencies.
- Install `@types/web-tree-sitter` as a dev dependency.

### 2. AST Worker Pool (`src/lib/ast/ast-worker-pool.ts`)
- Create a worker pool manager.
- Implement the **ACK Protocol / Semaphore Bounded Dispatch**: the pool should limit concurrent file processing to `os.cpus().length - 1`.
- The pool should accept a list of file paths to parse.

### 3. AST Worker & JSONL Spooling (`src/lib/ast/ast-worker.ts`)
- Initialize `web-tree-sitter` in the worker thread.
- Implement a dummy/stub loader for WASM grammars (we will implement dynamic downloading in Phase 2, for now, just define the interface).
- **File-Based IPC Bypass**: Instead of returning an AST object, the worker should write a simple "Skeleton" (e.g., just an array of the file's classes and functions, or even just a dummy JSON string for now) to a temporary `.jsonl` file in the OS temp directory (`os.tmpdir()`).
- The worker returns ONLY `{ status: 'done', file: '/tmp/...jsonl' }` to the main thread.

### 4. Verification
- Add a simple unit test or runnable script to verify that dispatching 10 dummy files to the pool correctly generates 10 `.jsonl` files and returns their paths.
- Ensure `pnpm --filter @workspace/api-server run build` passes with zero TypeScript errors.