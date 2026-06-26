# Verification Report: Item 4.2 — Vector Index & Search (pgvector Migration)
- **Date**: 2026-06-26
- **Phase & Item**: Phase 4 - Vector Index & Search
- **Target File**: `artifacts/api-server/src/lib/intent-router.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🔴 CRITICAL — pgvector migration not implemented**: ADR-019 (Accepted) mandates `vector(1536)` column type with IVFFlat/HNSW indexes. Actual implementation stores embeddings as `text("embedding")` (JSONB text). No `CREATE EXTENSION IF NOT EXISTS vector;` found anywhere.

2. **🔴 CRITICAL — In-memory cosine similarity loads all embeddings into Node.js heap**: `intent-router.ts` fetches all L2/L3 nodes with non-null embeddings and computes cosine similarity in JavaScript. This is the exact OOM risk ADR-019 was designed to prevent. Code comment at line 209 acknowledges: `// TODO: [CRITICAL BUG FIX] - pgvector migration missing.`

3. **🟡 MEDIUM — Dead code: `vector-search.ts` implements correct pgvector SQL but is never called**: `performVectorSearch` uses `embedding::vector <=> ${vectorStr}::vector` syntax but is orphaned — not imported by `intent-router.ts`.

4. **🟡 MEDIUM — N+1 project name lookups**: For each L2 result, a separate query fetches project name. Should be batched or JOINed.

5. **🟢 LOW — Duplicate `.sort()` call**: Line 376–377 sorts the same array twice.

### Recommended Fix
1. Add `CREATE EXTENSION IF NOT EXISTS vector;` migration.
2. Alter `l2_nodes.embedding` and `l3_nodes.embedding` columns from `text` to `vector(1536)`.
3. Create IVFFlat or HNSW indexes on embedding columns.
4. Wire `performVectorSearch` from `vector-search.ts` into `intent-router.ts`.
5. Add data migration script for existing JSONB embeddings.
