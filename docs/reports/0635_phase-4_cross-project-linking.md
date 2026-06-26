# Design Verification Report — Item 4.4

**Item ID:** 4.4
**Description:** Cross-project linking — detectCrossProjectLinks() creates review tasks only, no graph edges; ADR-018's 4 core mechanisms unimplemented
**Verification Date:** 2026-06-27
**Verdict:** ⚠️ WARN
**Type:** Re-verification (previous: 0627_phase-4_cross-project-linking.md, 2026-06-26)

---

## Design Spec References

| Document | Section | Description |
|----------|---------|-------------|
| `ADR-018-temporal-and-conceptual-bidirectional-linking.md` | Full | 4D graph: conceptual edges (IMPLEMENTS, EXPLAINS), temporal edges (EVOLVED_INTO), bidirectional validation (HAS_RULE), self-healing janitor |
| `ADR-019-pgvector-migration.md` | Full | pgvector deployment for similarity search — NOW DEPLOYED (used in intent-router.ts, NOT in detectCrossProjectLinks) |

---

## Source Files Examined

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/routes/generate.ts` | Knowledge generation pipeline; contains `detectCrossProjectLinks()` at line 267 |
| `artifacts/api-serverembedding.ts` | Embedding generation (OpenAI SDK) + cosineSimilarity helper |
| `artifacts/api-server/src/lib/intent-router.ts` | Intent router with pgvector SQL cosine search (reference pattern, NOT used for cross-project) |
| `lib/db/src/schema/l2_nodes.ts` | L2 nodes schema — no `content_hash` column |
| `lib/db/src/schema/l3_nodes.ts` | L3 nodes schema — no `content_hash` column |
| `lib/db/src/schema/node_links.ts` | Graph edges — references `l2_nodes` only, no `commitSha`/`diffSummary`/`sourceProjectId`/`targetProjectId` |
| `lib/db/src/schema/review_tasks.ts` | Review tasks — used as sole output of cross-project detection |
| `artifacts/api-server/src/routes/index.ts` | Route mounting — `standardLimiter` only, no auth on `/api/projects/:id/generate` |

**Checksums (SHA-256):**

| File | Hash | Previous (2026-06-26) | Change |
|------|------|----------------------|--------|
| `artifacts/api-server/src/routes/generate.ts` | `41e9e00001dbabbe08bd7a08d514a2f7c7949bec2634a61b2abf7e7ff9191b85` | Changed (commit 4557177: pgvector migration, 68c4c57: compressAstContext wiring) | **Changed** (code added outside detectCrossProjectLinks) |
| `artifacts/api-server/src/lib/embedding.ts` | `1d8b71ebfdabf6b7b0ef205dab0fb324523e40bbe05c8ef5e40fe0927fff6ff6` | Unknown (not in prior report) | **New measurement** |
| `lib/db/src/schema/l2_nodes.ts` | `a9343bd34c0adffd66d6ae89dab294a9d8032165ff475ee67b0bcc29882c71b9` | Unknown | **New measurement** |
| `lib/db/src/schema/l3_nodes.ts` | `902a75616544e267c9a2676a3cb18eade6e8f24f80ccb61a014842de83916819` | Unknown | **New measurement** |
| `lib/db/src/schema/node_links.ts` | `412987d14bfa7ab8548851204529f6a3bf361e56718dba725f86d85810e9a90a` | Unknown | **New measurement** |
| `lib/db/src/schema/review_tasks.ts` | `a62b1e88176b5996b088a369722fc3d3e6b26f3c3cf8b6d58be1e5503b25d01b` | Unknown | **New measurement** |

**Note:** Prior report (0627) used the old format without a checksums table. Cross-file comparison is limited to `generate.ts` checksum which confirms changes from pgvector migration and compressAstContext wiring.

---

## Round 1 — Architecture & Design Review

### Design ↔ Implementation Alignment

**✅ Correctly implemented (partial):**

1. **Cross-project similarity detection exists** — `detectCrossProjectLinks()` at `generate.ts:267` queries all L2 nodes from other projects, computes pairwise cosine similarity against a newly-generated node, and creates `review_tasks` entries of type "merge" when similarity ≥ 0.85. This is the detection half of ADR-018's vision.

2. **pgvector is now deployed** — Commit `4557177` migrated embeddings to `vector(1536)` with IVFFlat indexes. `intent-router.ts` successfully uses SQL-level cosine search (`embedding::vector <=> ${vectorStr}::vector`) with temporal decay. This infrastructure could be leveraged for cross-project similarity but is NOT.

### Gaps / Deviations

1. **❌ No graph edges created (critical gap)** — `detectCrossProjectLinks()` only writes to `review_tasks`. No records in `node_links`, no `cross_project_links` table, no `IMPLEMENTS`/`EXPLAINS`/`EVOLVED_INTO`/`SIMILAR_LINK` edge types. The knowledge graph has no cross-project relationships.

2. **❌ No temporal edges (EVOLVED_INTO)** — ADR-018 requires temporal edges tagged with commit SHA and diff summary. The `node_links` table has no `commitSha` or `diffSummary` columns. `l2_nodes` and `l3_nodes` have no `content_hash` for temporal tracking.

3. **❌ No self-healing re-anchoring (Background Janitor)** — ADR-018 requires a janitor in `metabolism.ts` that validates links and re-anchors L3 rules when target commits disappear. No such logic exists. Without `content_hash` on `l2_nodes`/`l3_nodes`, re-anchoring is impossible.

4. **❌ No bidirectional validation (HAS_RULE)** — ADR-018 requires L3 rules in the orphan branch to contain a pointer to the user's commit, with a `HAS_RULE` edge in the local DB. Absent.

---

## Round 2 — Code Quality & Security Review

### Strengths

1. **Correct SQL injection protection** — The `detectCrossProjectLinks()` function uses Drizzle's query builder with parameterized conditions. No raw SQL string interpolation.

2. **Null-safe embedding handling** — The filter `isNotNull(l2NodesTable.embedding)` prevents null embedding crashes. The loop has `if (!otherEmb) continue`.

3. **Deduplication** — Before creating a review task, it checks if one already exists for this entity+task combo.

4. **pgvector pattern available** — `intent-router.ts` demonstrates the correct pattern for vector search with SQL `(1 - (embedding::vector <=> ${vectorStr}::vector))` and temporal decay. This is the reference implementation that should be adopted for cross-project similarity.

### Issues Found

1. **⚠️ IDOR — Unauthenticated cross-project data access** — `routes/index.ts` mounts `projectsRouter` (which includes `/generate`) with only `standardLimiter` (rate limiter). No `requireApiKey` or `requireAuth` middleware. Any caller can trigger `detectCrossProjectLinks()` which loads embeddings from ALL projects' L2 nodes — this is cross-tenant data exposure. Confirmed unchanged from prior verification.

2. **⚠️ O(N²) in-memory scan despite pgvector availability** — `detectCrossProjectLinks()` loads ALL L2 nodes from ALL other projects into memory and computes pairwise `cosineSimilarity()` in JS. With pgvector deployed and working in `intent-router.ts`, this should use SQL-level `embedding::vector <=> ${vectorStr}::vector` for O(log N) IVFFlat search. The pgvector migration (commit `4557177`) did NOT refactor this function.

3. **⚠️ No error handling in similarity loop** — If the embedding query throws (e.g., pgvector extension not available for a specific project), the entire generation pipeline fails. No try/catch around the loop or graceful degradation.

---

## Round 3 — Integration & Completeness Review

### Integration Correctness

1. **Detection wired into pipeline** — `detectCrossProjectLinks()` is called at `generate.ts:973` after L2 node creation with embedding. The trigger path is correct: new node → generate embedding → cross-project check.

2. **No wiring of edge creation** — The function's output goes only to `review_tasks`. No downstream process converts review tasks into graph edges.

### Missing Coverage

1. **No edge persistence layer** — Even if similarity is detected, the relationship is ephemeral (review task only). A `cross_project_links` table or extension to `node_links` with `sourceProjectId`, `targetProjectId`, `edgeType`, `similarityScore`, `commitSha` is needed.

2. **No refactor to pgvector** —-leverage fix is moving from in-memory O(N²) to SQL-level O(log N) cosine search using the existing pgvector deployment.

3. **No auth middleware** — The generate route has no authentication check.

---

## Changes Since Last Verification

| Change | Impact |
|--------|--------|
| Commit `4557177` — pgvector migration to `vector(1536)` | Infrastructure improvement; enables SQL-level cosine search but NOT leveraged in `detectCrossProjectLinks()` |
| Commit `68c4c57` — wire compressAstContext into generate.ts | Unrelated to cross-project linking; no functional change to `detectCrossProjectLinks()` |
| Intent-router now uses pgvector cosine search | Provides the reference pattern for cross-project refactor |

**Net change:** `generate.ts` has changed (code additions), but `detectCrossProjectLinks()` function body, schema dependencies, and auth are **identical** to 2026-06-26. All findings from 0627 remain valid and unchanged.

---

## Findings Summary

| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | 🔴 HIGH | Architecture | No graph edges created — only review_tasks, no node_links/cross_project_links records | Unchanged |
| 2 | 🔴 HIGH | Architecture | No temporal edges (EVOLVED_INTO) or content_hash on l2_nodes/l3_nodes | Unchanged |
| 3 | 🔴 HIGH | Architecture | No self-healing janitor for re-anchoring after rebases | Unchanged |
| 4 | 🔴 HIGH | Security | IDOR — unauthenticated /api/projects/:id/generate with cross-project embedding reads | Unchanged |
| 5 | 🟡 MEDIUM | Performance | O(N²) in-memory cosine similarity despite pgvector availability in intent-router.ts | Unchanged |
| 6 | 🟡 MEDIUM | Architecture | No bidirectional validation (HAS_RULE) per ADR-018 | Unchanged |
| 7 | � MEDIUM | Architecture | No IMPLEMENTS or types per ADR-018 | Unchanged |
| 8 | 🟢 LOW | Robustness | No error handling in detectCrossProjectLinks() similarity loop | Unchanged |

---

## Overall Verdict

**⚠️ WARN**

The `detectCrossProjectLinks()` function correctly DETECTS cross-project similarity (detection half) but FAILS to ACT on it (action half). It creates review_tasks entries only — no graph edges, no temporal tracking, no self-healing. Additionally, the O(N²) scan pattern is now obsolete (pgvector is deployed and proven in `intent-router.ts`), and the endpoint remains unauthenticated allowing cross-tenant embedding reads (IDOR). All findings are carried forward from 0627_phase-4_cross-project-linking.md with no degradation or improvement.
