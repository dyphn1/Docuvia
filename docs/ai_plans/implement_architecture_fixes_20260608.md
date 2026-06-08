# AI Implementation Plan: System Architecture Fixes

**Date:** 2026-06-08 / 2026-06-09
**Based on:** `docs/roadmap/reports/2026-06-08_architecture_review_summary.md`
**Context:** Cross-validated architecture review highlighting critical concurrency, security, semantic, and integration issues, followed by a Phase 2 Codex review and remediation.

## 🎯 Phase 1: Initial Architecture Consolidation (Completed)

### ✅ Task 1: [P0.1] Fix Concurrency Mutex in Knowledge Graph Generation
- **Status:** COMPLETED
- **Description:** Replaced blind status updates in `POST /projects/:id/generate` with atomic conditional updates (`WHERE status = 'active'`) and returning `409 Conflict` to prevent DB duplication.

### ✅ Task 2: [P0.2] Add Authentication to Metabolism Endpoint
- **Status:** COMPLETED
- **Description:** Added authentication to the `GET /admin/metabolism-tick` route using `Authorization: Bearer <token>` or `admin_token` query parameter.

### ✅ Task 3: [P1.4] Restore API-First Discipline (Feedback Endpoint)
- **Status:** COMPLETED
- **Description:** Added the existing `POST /search/feedback` endpoint to `lib/api-spec/openapi.yaml` and regenerated Orval clients.

### ✅ Task 4: [P1.1 & P1.2] Correct Intent Router Semantics
- **Status:** COMPLETED
- **Description:** 
  - **Direct Lookup**: Implemented full-text search against `l3_nodes.content`.
  - **Hybrid Search**: Implemented `Intersection + Cross-Validation Boosting`.
  - **LIKE wildcard injection**: Created `escapeLike()` to escape `%` and `_` characters.

### ✅ Task 5: [P1.3] Search Interface Consolidation
- **Status:** COMPLETED
- **Description:** Refactored `POST /search` and `/mcp/query` endpoints to be thin adapters that ONLY call `routeQuery()` from `intent-router.ts`.

### ✅ Task 6: [P2.1] Core Defense Net (Unit Tests)
- **Status:** COMPLETED
- **Description:** Wrote Vitest unit tests for `intent-router.ts` and `embedding.ts` focusing on cosine similarity math, temporal decay calculations, query sanitization, and LIKE escaping.

---

## 🎯 Phase 2: Codex Review Blocking Issues Remediation (Completed)

### ✅ Task 7: [P0] Metabolism Auth Fail-Closed Security Fix
- **Status:** COMPLETED
- **Description:** Removed the dangerous default `"dev-secret-token"`. The route now explicitly fails closed (`500 Internal Server Error`) if `ADMIN_SECRET_TOKEN` is missing, unless explicitly running in a development environment (`NODE_ENV === 'development'`).

### ✅ Task 8: [P1] Intent Router Project Filtering for L3 & Direct
- **Status:** COMPLETED
- **Description:** Added `innerJoin` with `l2NodesTable` in `intent-router.ts` to properly enforce `projectId` filtering for `l3_nodes` in both vector search fallbacks and direct lookup searches.

### ✅ Task 9: [P1] Search Response & Feedback OpenAPI Alignment
- **Status:** COMPLETED
- **Description:** 
  - Updated `/search` response schema (`SearchResultItem`) in `openapi.yaml` to match `AgenticSearchResult` (added `source`, `nodeLayer: commit`, id string support).
  - Added the required `nodeLayer` field to `/search/feedback` schema to accurately target updates in `l2_nodes` or `l3_nodes` tables. Regenerated all hooks and validators.

### ✅ Task 10: [P1] Generate Error Recovery Strategy
- **Status:** COMPLETED
- **Description:** Updated the atomic update lock in `generate.ts`. New generation pipelines can now successfully reclaim a project if it was stuck in `"error"` state, or if it was stuck in a stale `"indexing"` state for more than 30 minutes.
