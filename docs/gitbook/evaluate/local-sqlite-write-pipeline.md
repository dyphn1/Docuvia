> **Note:** This document contains competitor analysis and references that have not been fully integrated into the current implementation yet.

# 04. Local SQLite Write Pipeline

**Severity:** 🔴 CRITICAL
**Domain:** Local Storage
**Target:** `@workspace/cli` (`sync` command)

## Deficit Description

Even if the AST core parses the files (Issue #03), the resulting architectural data (L2 Modules, L3 Decisions) must be durably stored in the Local HEAD Index (`.docuvia/local.db`). The current pipeline lacks the concrete `INSERT/UPDATE` mechanisms to transform AST output into the finalized SQLite schema locally.

## Acceptance Criteria

1. Establish a local `drizzle-orm` instance bound to `better-sqlite3` targeting `.docuvia/local.db` inside the AST execution loop.
2. Persist extracted AST nodes into the `l2_nodes` and `l3_nodes` tables.
3. Automatically serialize these changes into an append-only JSON event and commit it to the `docuvia-knowledge` git orphan branch to fulfill the Event Sourcing architecture.

## Current State (as of 2026-07-05) — Two Disconnected Pipelines

These acceptance criteria are **not unified in practice**. Two independent write paths exist for the same conceptual data, and they never intersect:

- **`analyze`** (`lib/core/src/services/sqlite-graph.repository.ts`, `SqliteGraphRepository.persistAstGraph`) — parses the AST and persists L2/L3 nodes into the real, durable `.docuvia/local.db` via `drizzle-orm`. This is the actual Local HEAD Index.
- **`sync --local`** (`artifacts/cli/src/commands/sync.ts`) — re-parses the AST independently and writes into a `GitNativePersistenceService`-managed **temp directory** (`fs.mkdtemp`), which is deleted (`fs.rm`) once the orphan-branch write completes. It never reads from or writes to `.docuvia/local.db`, and currently calls `writeKnowledgeToOrphanBranch(1)` with a hardcoded `projectId`, reflecting the single-tenant limitation noted in [crosscutting-concepts.md §8.4](../architecture/crosscutting-concepts.md).

Do not assume these two commands operate on the same underlying store — running one does not update the other's data. Unifying them (routing `sync --local` through `SqliteGraphRepository`/`.docuvia/local.db` instead of a discarded temp dir) is a real pipeline rewrite, tracked separately; this note exists so the divergence is at least documented rather than silent.
