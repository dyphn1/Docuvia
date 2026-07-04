# 🗺️ Docuvia AST Parser — Unfinished Items Tracker

> Completed items have been merged into [master-roadmap.md](./README.md) Phase 5. This file tracks only unfinished work.
> For detailed Phase 1-4 completed item descriptions, refer to `master-roadmap.md`.

---

## Unfinished Items (Implementation Backlog)

### Phase 4: Resilience & Scalability

- [x] **Batch Write Optimization** — Streaming chunked batch INSERTs for large `.jsonl` files to avoid overwhelming PostgreSQL.
  - Target file: `lib/core/src/services/ast-ingestion-pipeline.ts`
  - Key logic: 4-phase streaming pipeline (collect → batch L2 → batch L3 → batch links). BATCH_INSERT_CHUNK=500, .onConflictDoNothing(), single pre-load of existing nodes.
  - Status: ✅ Done (2026-07-28)

### Phase 5: AST Microkernel Advanced Features

- [x] **Incremental Fast-Path** — Use `git diff-tree -M` for O(1) delta detection, only re-parse changed files.
  - Target file: `lib/core/src/services/ast-ingestion-pipeline.ts`
  - Key logic: `detectChangedFiles()` + `updateFileHashes()` + `mode: "incremental"` wired in ingest.ts and ast-ingestion-pipeline.ts
  - Status: ✅ Done (2026-07-28)

- [x] **Cross-Language Edges** — Cross-language dependency edge detection (API Contracts, framework-specific AST tracking).
  - Target file: `artifacts/ast-core/src/bridge-provider.ts` → wired in `lib/core/src/services/ast/ast-worker.ts`
  - Key logic: Bridge Provider parses OpenAPI 3.x/Swagger 2.0 → api_contract JSONL events → ingestion pipeline creates L2 `pcd` + per-endpoint L3 nodes + consumer→contract links via path/operationId matching
  - Status: ✅ Done (2026-06-26) — bridge-provider.ts implements parseOpenApiSpec() + isOpenApiFile() detection; ast-worker.ts routes .yaml/.json files to bridge provider when they contain openapi/swagger keys; ingestion pipeline Phases 1/2/3.5/4.5 handle all api_contract events

- [x] **Zero-Server Deep Traversal** — Pure local SQLite graph queries, no API server dependency.
  - Target file: `artifacts/vscode-client/src/knowledge-store.ts`
  - Key logic: SQLite recursive CTE + in-memory BFS fallback, `traverseGraph()` method, `docuvia.graph.traverse` command, dual DDL blocks (l2_nodes.type + node_links), server `/projects/:id/graph` returns node_links
  - Status: ✅ Done (2026-06-27) — implementation was in uncommitted working tree from prior session; build passes; remaining gap is edge data sync mechanism (node_links table never populated)

- [x] **Local Context Compression** — Token reduction pipeline before sending to LLM.
  - Target file: `artifacts/ast-core/src/parser-core.ts` → wired in `artifacts/api-server/src/routes/generate.ts`
  - Key logic: AST Skeleton compression, symbol deduplication → compressAstContext() pipeline (dedup→sort→truncate→budget), maxTotalChars=6000, maxPerNodeChars=600
  - Status: ✅ Done (2026-07-28) — compressAstContext() wired into document context pipeline in generate.ts. Documents are deduplicated, sorted by confidence, truncated, and assembled within token budget before being sent to LLM.

- [x] **Sub-second Incremental Watch** — Fast-path AST updates on file save.
  - Target file: `artifacts/api-server/src/routes/ingest.ts`
  - Key logic: `mode: "incremental"` → `detectChangedFiles()` → parse only changed files
  - Status: ✅ Done (2026-06-26) — `project_files` table + `detectChangedFiles()` + `updateFileHashes()` implemented. Route wired with `mode: "incremental"`. Migration 003 created. Build passes.

---

## Cron Agent Usage

When the AST Language Implementor cron runs:

1. Read `docs/reports/.ast-verification-index.json` to get the list of unfinished items
2. Select the first `status: "todo"` item to implement
3. After implementation, run build + test + DB migration
4. Update `docs/gitbook/roadmap/roadmap-checklist.md` Phase 8 corresponding item status
5. Update `.ast-verification-index.json`
6. Git commit + push
