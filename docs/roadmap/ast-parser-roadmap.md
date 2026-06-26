# 🗺️ Docuvia AST Parser — Unfinished Items Tracker

> Completed items have been merged into [master-roadmap.md](master-roadmap.md) Phase 5. This file tracks only unfinished work.
> For detailed Phase 1-4 completed item descriptions, refer to `master-roadmap.md`.

---

## Unfinished Items (Implementation Backlog)

### Phase 4: Resilience & Scalability

- [ ] **Batch Write Optimization** — Streaming chunked batch INSERTs for large `.jsonl` files to avoid overwhelming PostgreSQL.
  - Target file: `artifacts/api-server/src/lib/ast-ingestion-pipeline.ts`
  - Key logic: Stream-read `.jsonl` → batch INSERT every N records → avoid memory bloat

### Phase 5: AST Microkernel Advanced Features

- [ ] **Incremental Fast-Path** — Use `git diff-tree -M` for O(1) delta detection, only re-parse changed files.
  - Target file: `artifacts/api-server/src/lib/ast-ingestion-pipeline.ts`
  - Key logic: `git diff-tree -M` → compare against `project_files` table → parse only changed/new files

- [ ] **Cross-Language Edges** — Cross-language dependency edge detection (API Contracts, framework-specific AST tracking).
  - Target file: `artifacts/ast-core/src/parser-core.ts`
  - Key logic: OpenAPI/Swagger as Bridge Nodes, tRPC/Next.js Server Actions tracking

- [ ] **Zero-Server Deep Traversal** — Pure local SQLite graph queries, no API server dependency.
  - Target file: `artifacts/vscode-client/src/KnowledgeStore.ts`
  - Key logic: SQLite recursive CTE queries for graph traversal

- [ ] **Local Context Compression** — Token reduction pipeline before sending to LLM.
  - Target file: `artifacts/ast-core/src/parser-core.ts`
  - Key logic: AST Skeleton compression, symbol deduplication

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
4. Update `docs/roadmap/roadmap_checklist.md` Phase 8 corresponding item status
5. Update `.ast-verification-index.json`
6. Git commit + push
