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
