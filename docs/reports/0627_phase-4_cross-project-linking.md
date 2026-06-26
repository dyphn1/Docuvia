# Verification Report: Cross-project Linking

- **Date**: 2026-06-26
- **Phase & Item**: Phase 4 - Cross-project Linking
- **Target File**: `artifacts/api-server/src/routes/generate.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure

The `detectCrossProjectLinks()` function in `generate.ts` partially implements ADR-018's cross-project similarity detection but **fails to create any knowledge graph edges** and **does not implement 3 of ADR-018's 4 core mechanisms**:

1. **🔴 HIGH — No graph edges created**: The function only creates `review_tasks` entries of type "merge" when cross-project similarity is detected. No records are written to `node_links`, no `IMPLEMENTS`/`EXPLAINS`/`EVOLVED_INTO` edges exist, and no new table implements these edge types. The knowledge graph is not updated with cross-project relationships.

2. **🔴 HIGH — No temporal edges (EVOLVED_INTO)**: ADR-018 requires temporal edges tagged with commit SHA and diff summary. The `node_links` table has no `commitSha`, no `diffSummary`, and no temporal edge type. The `commit_l2_links` table maps commits to L2 nodes but does not track evolution between versions.

3. **🔴 HIGH — No self-healing re-anchoring**: ADR-018 requires a Background Janitor that validates links and re-anchors L3 rules when target commits disappear (rebase/amend). No janitor logic exists for this purpose. The `l2_nodes` and `l3_nodes` tables have no `content_hash` column, which is required for the re-anchoring algorithm.

4. **🟡 MEDIUM — No bidirectional validation (HAS_RULE)**: ADR-018 requires L3 rules in the orphan branch to contain a pointer to the user's commit, with a `HAS_RULE` edge in the local DB. This mechanism is entirely absent.

5. **🟡 MEDIUM — O(N²) similarity scan with no indexing**: The function loads ALL L2 nodes from ALL other projects into memory and computes pairwise cosine similarity. With `pgvector` not deployed (ADR-019 missing), embeddings are compared in-application via a JS loop. This will OOM or timeout at scale.

6. **🟡 MEDIUM — No auth on generate route**: `/api/projects/:id/generate` has no authentication middleware (only `standardLimiter` rate limiter). The cross-project embedding reads are unauthenticated — any caller can trigger a scan of all projects' embeddings. This is an IDOR surface for the cross-project data access.

7. **🟢 LOW — No IMPLEMENTS or EXPLAINS edges**: ADR-018 specifies conceptual edges (`IMPLEMENTS` from Physical → Conceptual, `EXPLAINS` from Document → Physical). No schema or code supports these edge types.

### Recommended Fix

1. **Create edge schema**: Add a `cross_project_links` table or extend `node_links` with columns: `sourceProjectId`, `targetProjectId`, `edgeType` (IMPLEMENTS, EXPLAINS, EVOLVED_INTO, SIMILAR_LINK), `commitSha`, `contentHash`, `similarityScore`.

2. **Write actual edges**: In `detectCrossProjectLinks()`, after detecting similarity, insert a record into the edge table (not just a review task). Use the `node_links` table with `linkType: "similar_link"` as an interim solution.

3. **Add content_hash to l2_nodes/l3_nodes**: Required for self-healing re-anchoring. Hash the file content during ingestion and store it.

4. **Implement self-healing janitor**: Add a background job in `metabolism.ts` that validates `node_links` integrity — if a target commit no longer exists, search by `content_hash` for the new commit and re-anchor.

5. **Add auth middleware to generate route**: Apply `requireAuth` or `requireApiKey` to `/api/projects/:id/generate` to prevent unauthenticated cross-project data access.

6. **Deploy pgvector (ADR-011)**: Move similarity queries to SQL with `<=>` operator to eliminate the O(N²) in-memory scan. This is a prerequisite for cross-project linking to scale.

7. **Add EVOLVED_INTO tracking**: On ingestion, compare current AST nodes with previous version (by content_hash). If a node evolved (same FQN, different content), create an `EVOLVED_INTO` edge tagged with the commit SHA.
