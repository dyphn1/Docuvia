# AI Implementation Plan: System Architecture Fixes

**Date:** 2026-06-08
**Based on:** `docs/roadmap/reports/2026-06-08_architecture_review_summary.md`
**Context:** Cross-validated architecture review highlighting critical concurrency, security, semantic, and integration issues.

## 🎯 Task Breakdown & Subagent Dispatch Plan

### ✅ Task 1: [P0.1] Fix Concurrency Mutex in Knowledge Graph Generation
- **Status:** COMPLETED (Fixed in previous turn)
- **Description:** Replaced blind status updates in `POST /projects/:id/generate` with atomic conditional updates (`WHERE status = 'active'`) and returning `409 Conflict` to prevent DB duplication.
- **Agent:** Backend Developer

### ⏳ Task 2: [P0.2] Add Authentication to Metabolism Endpoint
- **Status:** PENDING
- **Description:** Add authentication to the `GET /admin/metabolism-tick` route in `artifacts/api-server/src/routes/metabolism.ts`. It should be protected by a shared-secret token or similar mechanism to prevent unauthorized access.
- **Agent:** Backend Developer

### ⏳ Task 3: [P1.4] Restore API-First Discipline (Feedback Endpoint)
- **Status:** PENDING
- **Description:** Add the existing `POST /search/feedback` endpoint to `lib/api-spec/openapi.yaml` and regenerate the Orval clients.
- **Agent:** API Architect

### ⏳ Task 4: [P1.1 & P1.2] Correct Intent Router Semantics
- **Status:** PENDING
- **Description:** Fix `artifacts/api-server/src/lib/intent-router.ts`.
  - **Direct Lookup**: Change from pure commit-hash prefix lookup to proper full-text search against `l3_nodes.content`.
  - **Hybrid Search**: Change from `Union + Dedupe` to `Intersection + Cross-Validation Boosting` as per ADR-007.
  - **LIKE wildcard injection**: Escape `%` and `_` characters in user inputs for graph and direct searches.
- **Agent:** Backend Developer

### ⏳ Task 5: [P1.3] Search Interface Consolidation
- **Status:** PENDING
- **Description:** Refactor `artifacts/api-server/src/routes/search.ts` and `artifacts/api-server/src/routes/mcp.ts` to be thin adapters that route their search execution through the unified `intent-router.ts` (or a shared `agentic-search` module). Ensure temporal decay and validity filtering are applied globally.
- **Agent:** Backend Developer

### ⏳ Task 6: [P2.1] Core Defense Net (Unit Tests)
- **Status:** PENDING
- **Description:** Write unit tests for `intent-router.ts` and `embedding.ts` focusing on cosine similarity math, temporal decay calculations, and hybrid merging logic.
- **Agent:** Backend Developer
