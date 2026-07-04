> **Note:** This document contains competitor analysis and references that have not been fully integrated into the current implementation yet.

# 07. Local BFS Blast Radius Optimization

**Severity:** 🟠 HIGH
**Domain:** Token Optimization
**Target:** `@workspace/cli` (`query` command)

## Deficit Description

The current `docuvia query` command limits token consumption by simply taking the top 5 records that match a `LIKE` query. While this prevents token explosion, it completely ignores topological relationships. If module A depends on module B, and a developer queries module B, the AI is not informed about module A. A generic Breadth-First Search (BFS) graph traversal solves this flawlessly.

## Acceptance Criteria

1. Extend `query.ts` to utilize the `node_links` table in SQLite.
2. Implement a local BFS algorithm that accepts a target node and a `depth` parameter (e.g., depth=2).
3. Extract and return the graph neighborhood (callers and callees) formatted tightly as part of the `<docuvia_context>` prompt.
