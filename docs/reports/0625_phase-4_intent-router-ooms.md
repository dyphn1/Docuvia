# Verification Report: Intent Router (Event Loop Blocking)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 4 - Semantic search
- **Target File**: artifacts/api-server/src/lib/intent-router.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
The `intent-router.ts` contains severe event loop and memory flaws in the fast-path arbitration logic:
*   **Event Loop Blocking & OOM in Fast Arbitration:** Inside `routeQuery()`, the Fast Arbitration Graph Filter blindly fetches the entire `l1TagsTable` and `l2NodesTable` for a project into memory on *every single query*. It then runs an unbounded `.toLowerCase().includes()` loop. For large knowledge graphs, this acts as a synchronous blockage of the Node.js event loop and will trigger OOM under moderate concurrent load.
*   **Unbounded SQL `IN` Clause in Graph Traversal:** In `graphTraversalHandler()`, target node lookups are executed using `sql\`${l2NodesTable.id} IN ${targetIds}\``. Because there's no chunking or limits on `targetIds`, highly-connected "god nodes" will generate massive, unbounded SQL queries that can crash the database client.

### Recommended Fix
Rewrite `routeQuery()` to perform the L1/L2 string matching entirely within PostgreSQL using an `ILIKE` or `pg_trgm` query rather than loading all rows into Node.js memory. Implement chunking (e.g., chunks of 1000) for the `IN` clause array in `graphTraversalHandler()`.
