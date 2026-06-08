# System Architecture & Issue Review Summary

**Date:** 2026-06-08
**Target Commit:** `35b31913769ba660b8ddaae08ea4deee6e7ce280`
**Purpose:** Provided for cross-validation by other AI models, documenting the original analysis methodology, issue aggregation, and macro-perspective reflections on the project.

---

## 🛠️ Methodology & Process Log

To ensure an objective and comprehensive analysis, the review process was structured as follows:

1. **Targeting**:
   - Executed `git show 35b31913769ba660b8ddaae08ea4deee6e7ce280 --stat` to confirm the commit introduced 12 inspection reports (`0012` through `0023`).
2. **Keyword Extraction & Scanning**:
   - Ran `grep` scripts across all new reports for keywords such as `(Issue|Problem|Risk|Error|Fail|Missing)` and extracted the surrounding context into `report_summary.txt` (over 1,500 lines).
   - Executed `grep -A 10 "^## Overall Verdict"` to extract the final verdict (PASS / WARN / FAIL) from each report.
3. **Aggregation & Categorization**:
   - Cross-referenced the extracted warnings and failures, categorizing them into 5 core dimensions: Concurrency, Architecture Integration, Spec Deviation, Security/Performance, and Test Coverage.
4. **Macro-Perspective Reflection**:
   - Paused the standard code-debugging perspective and switched to a "Whole Project" lens (focusing on product, architecture, stability, cognition, and strategy). Iterated through 5 deep reflections to derive the final conclusions and priorities.

---

## 📋 Issues & Failures Summary

From reports 0012 to 0023, excluding the VS Code Client (2.1.1) which received a ✅ PASS, the following core issues were identified:

1. **Concurrency & Data Consistency (1.4.2) — ❌ FAIL**
   - **Complete Lack of Mutex Mechanisms**: When triggering Knowledge Graph generation (`POST /projects/:id/generate`), there is absolutely no database-level locking or request queuing implemented. Concurrent requests will result in duplicated L2/L3 nodes and review tasks, causing severe database pollution and inconsistency.
2. **Architectural Disintegration & Code Splintering (1.3.1, 1.3.2, 1.3.6) — ⚠️ WARN**
   - **Web UI Bypasses Core Brain**: The flagship "4-Way LLM Intent Router" is completely unintegrated with the frontend UI. The current Web UI (`query.tsx`) and parts of MCP search completely bypass the Router, relying on duplicated, inline legacy logic.
   - **Multiple Inconsistent Implementations**: Vector search has three parallel and inconsistent implementations across `intent-router.ts`, `search.ts`, and `mcp.ts`. The `search.ts` implementation even drops the "validity filtering" and "temporal decay" features.
3. **Specification Deviations & Logic Errors (1.3.4, 1.3.5) — ⚠️ WARN**
   - **Incorrect Direct Search Spec**: The design doc requires full-text search on `l3_nodes.content`. The actual implementation performs a "Commit Hash lookup". As a result, natural language queries classified as 'Direct' will permanently return zero results.
   - **Hybrid Search Logic Flaw**: Implemented as a Union rather than the Intersection specified in the design, and lacks the cross-validation scoring boost mechanism.
   - **Temporal Decay**: The UI does not wire back to the Feedback API, making the decay mechanism purely unidirectional (aging only) with no way for human interaction to refresh node vitality.
4. **Performance & Security Vulnerabilities (1.3.3, 1.4.1) — ⚠️ WARN**
   - **High-Risk Security Flaw**: The `/admin/metabolism-tick` route lacks authentication entirely. Anyone can trigger system metabolism.
   - **SQL Injection Risk**: Graph Search relies on vulnerable SQL `LIKE` wildcard patterns.
   - **Performance Time-Bombs**: Both Vector and Graph search suffer from severe `N+1` query issues. Database columns mistakenly use `text` instead of `jsonb`. The Intent Router's supposedly O(1) arbitration is actually O(N) in practice.
5. **Severe Lack of Testing (Spanning all backend modules) — ⚠️ WARN**
   - **Zero Unit Tests** exist for core algorithms including LLM intent classification, Cosine Similarity math, temporal decay calculations, and graph traversal logic.

---

## 🧠 5 Macro-Perspective Reflections

**🔹 Reflection 1: Core Value Delivery Crisis (Integration Dimension)**
Docuvia's main selling point is "Agentic RAG" (4-way intent routing and knowledge graph). The reports reveal this core engine is an isolated silo; the primary Web UI doesn't use it. The developers built the engine but failed at system boundary integration. Building new features now will only distance this unused engine further from practical application.

**🔹 Reflection 2: System Fragility & Tech Debt Cascade (Testing & Architecture Dimension)**
All search logic, decay math, and LLM validations have "zero tests," coupled with three inconsistent search implementations. Maintenance-wise, this is a ticking time bomb. Without a testing safety net, future changes (e.g., swapping OpenAI versions or tweaking Prompts) risk silently breaking the search results.

**🔹 Reflection 3: Fatal Flaw in Parallel Scaling (Stability Dimension)**
The **❌ FAIL** in report 1.4.2 is an absolute blocker for production. In real-world scenarios (e.g., concurrent Webhooks or user double-clicks), lacking a Mutex lock will cause graph nodes to be frantically duplicated. Without an immediate database-level defense, subsequent Graph Searches will break due to duplicate nodes, quickly filling the DB with garbage data.

**🔹 Reflection 4: Drift Between Design and Implementation (Cognitive Gap Dimension)**
Direct Search became a commit hash lookup; Hybrid Search became a union. This indicates a cognitive gap between the "AI Agent (or developer)" and the ADR/Architecture docs. If development continues, these foundational logic errors will compound, leading to highly inaccurate search results. Development must pause to strictly realign with `ADR-007`.

**🔹 Reflection 5: Strategic Redirection & Resource Allocation (Project Management Dimension)**
The project is currently in a "Demo-ware" state—all the parts exist, but the assembly is loose and dangerous. From a macro project perspective, it is absolutely the wrong time to add new features (e.g., integrating external systems). The project must enter a "Consolidation Phase" to pay down technical debt.

---

## 🎯 Conclusion & Next Steps

Based on the 5 macro-perspective reflections, the conclusion is: **The project has reached a "Technical Debt Tipping Point." Development of new features must be frozen immediately.**

It is recommended to prioritize the following three steps to salvage the system architecture:

1. **Fix Fatal Errors (P0)**: Immediately patch the concurrency Mutex issue on `POST /projects/:id/generate` to prevent the database from being polluted with duplicate nodes. Simultaneously add authentication to `/admin/metabolism-tick`.
2. **Unify the Search Engine (P1)**: Delete redundant search logic in `search.ts` and `mcp.ts`. Force the Web UI and all endpoints to call `intent-router.ts` uniformly, ensuring "temporal decay" and "4-way routing" are applied globally. Rewrite Direct Search to perform proper full-text lookup.
3. **Establish Core Defense Net (P2)**: Mandate unit test coverage for `intent-router.ts` and `embedding.ts`. This is the absolute baseline required to guarantee that future Agentic RAG evolutions do not regress.

---

## Cross-Validation Addendum - Second Review

**Reviewer:** Codex
**Review Date:** 2026-06-08
**Scope:** Rechecked commit `35b31913769ba660b8ddaae08ea4deee6e7ce280`, the added reports, and the current source tree.

### Verified Findings

1. **The target commit is documentation-only.**
   - Commit `35b31913769ba660b8ddaae08ea4deee6e7ce280` adds reports `0012` through `0023` and revises `docs/roadmap/roadmap_checklist.md`.
   - It does not directly change runtime source code. Therefore, this review validates whether the reports correctly describe the current source tree, not whether the commit introduced the runtime defects.

2. **The generate concurrency issue is real and should remain P0.**
   - `artifacts/api-server/src/routes/generate.ts` defines `POST /projects/:id/generate`.
   - The handler sets `projects.status = "indexing"`, but does not atomically claim the project with a conditional update such as `WHERE status = 'active'`.
   - This makes `projects.status` an indicator, not a lock. Two concurrent requests can both enter the long-running pipeline.

3. **The search architecture is genuinely split across multiple modules.**
   - `artifacts/kg-engine/src/pages/query.tsx` calls `/api/search`.
   - `artifacts/api-server/src/routes/search.ts` implements standalone search.
   - `artifacts/api-server/src/routes/mcp.ts` implements both legacy `/mcp/search_knowledge` and `/mcp/query`.
   - `artifacts/api-server/src/lib/intent-router.ts` contains the intended Agentic RAG router.
   - These interfaces overlap, but their implementations diverge in routing strategy, temporal decay, validity filtering, result shape, and feedback behavior.

4. **The admin metabolism endpoint is unauthenticated.**
   - `artifacts/api-server/src/routes/metabolism.ts` exposes `/admin/metabolism-tick` without authentication.
   - Because this route can trigger DB writes and OpenAI calls, the security concern is high severity.

5. **Test coverage is thin for the riskiest modules.**
   - Current API server tests are not broad enough to protect the intent router, embedding math, temporal decay, graph traversal, metabolism mutex behavior, or generate concurrency behavior.

### Corrections to the Original Summary

1. **"SQL Injection Risk" should be rephrased.**
   - The code uses Drizzle parameterization, so this is not classic SQL injection.
   - The more accurate issue is **SQL LIKE wildcard injection / overly broad matching**: unescaped `%` and `_` in user or LLM-derived terms can match far more nodes than intended.
   - The remediation is still valid: centralize and escape LIKE inputs, or move to proper full-text search where appropriate.

2. **The feedback endpoint exists, but the feedback loop is incomplete.**
   - `POST /search/feedback` exists in `artifacts/api-server/src/routes/search.ts`.
   - However, it is not listed in `lib/api-spec/openapi.yaml`, which breaks the project's API-first convention.
   - The Web UI does not consistently call it after useful interactions, so temporal decay can still behave as mostly one-way aging in the main user flow.

3. **"Delete search.ts and mcp.ts logic" is directionally right but too blunt.**
   - The public routes should not be removed casually because they are existing API interfaces.
   - A safer approach is to keep route adapters while moving shared behavior behind one deep search module.
   - Routes should become thin adapters that normalize request/response shape, call the shared search interface, and preserve backward compatibility where needed.

4. **Do not force all callers into the current `routeQuery()` unchanged.**
   - `routeQuery()` itself has semantic drift: direct lookup is commit-hash based, hybrid search behaves like union + dedupe, and the fast-path graph arbitration does O(N) term loading.
   - Unifying callers before correcting this module would spread the wrong behavior more consistently.

### Recommended Revised Remediation Plan

1. **P0 - Add an atomic generate guard.**
   - Replace check-then-set behavior with a conditional update:
     - `UPDATE projects SET status = 'indexing', updated_at = now() WHERE id = ? AND status = 'active' RETURNING *`
   - Return `409 Conflict` when no row is claimed.
   - Add stale `indexing` recovery rules, otherwise a crashed request can leave the project blocked.
   - Add integration tests that fire concurrent generate requests and assert only one succeeds.

2. **P0 - Protect privileged metabolism routes.**
   - Add authentication to `/admin/metabolism-tick`.
   - Keep `/metabolism-tick` compatible with the VS Code heartbeat, but explicitly define whether it is public, token-protected, or rate-limited.
   - Add tests for mutex behavior and unauthorized admin access.

3. **P1 - Create one deep search module, then adapt routes to it.**
   - Extract shared search behavior into a module with a narrow interface, for example `agentic-search`.
   - Keep `/search`, `/mcp/search_knowledge`, `/mcp/query`, and extension routes as adapters.
   - Normalize these concerns in one place:
     - temporal decay
     - validity filtering
     - project filtering for L2 and L3 results
     - LIKE escaping or full-text query handling
     - result shape mapping
     - feedback event handling

4. **P1 - Correct intent-router semantics before making it universal.**
   - Rework Direct RAG so it supports the intended direct lookup semantics, not only commit hash prefix lookup.
   - Rework Hybrid RAG from union + dedupe toward graph/vector cross-validation with an explicit scoring boost.
   - Avoid calling O(N) architectural-term loading an O(1) fast path unless terms are cached or indexed.

5. **P1 - Restore API-first discipline.**
   - Add `/search/feedback` to `lib/api-spec/openapi.yaml`.
   - Regenerate Orval clients after spec changes.
   - Move the frontend away from hand-written fetch calls when generated hooks are available.

6. **P2 - Add focused tests around the real interfaces.**
   - Unit tests: `cosineSimilarity`, `parseEmbedding`, temporal decay math, LIKE escaping, hybrid merge/boost, direct lookup parsing.
   - Integration tests: `/search`, `/mcp/query`, `/mcp/search_knowledge`, `/search/feedback`, `/admin/metabolism-tick`, concurrent `/projects/:id/generate`.
   - The interface is the test surface: test the route adapters and the shared search module, not only isolated helper functions.

### Rethink 1 - Is "Feature Freeze" Too Strong?

The original summary says new feature development must be frozen immediately. This is directionally correct for features that depend on Agentic RAG, generate, or search correctness. However, a total freeze may be too broad.

A more precise rule is:

- Freeze new features that expand ingestion, RAG behavior, graph generation, search ranking, or external automation.
- Allow small UX, documentation, and test-infrastructure work if it directly supports consolidation.
- Allow security fixes, API-spec alignment, and migration-safe refactors.

This avoids blocking useful hardening work while still preventing the project from building more surface area on unstable modules.

### Rethink 2 - What Is the Deepest Root Cause?

The deepest issue is not merely "missing mutex" or "missing tests." Those are symptoms. The root architectural problem is that core behavior is implemented behind shallow, duplicated interfaces:

- Search has several route-level implementations instead of one deep module.
- `projects.status` exists as data, but not as a concurrency interface.
- Feedback exists as an endpoint, but not as a closed product workflow.
- The intent router exists, but not as the default search contract.

The best repair strategy is therefore not just patching individual files. It is to deepen the relevant modules:

1. Make generate serialization a real interface, not an incidental status update.
2. Make search routing one shared interface with multiple adapters.
3. Make feedback part of the query lifecycle, not a loose endpoint.
4. Make tests target those interfaces so future implementation changes stay local.

With that framing, the recommended priority remains: **P0 concurrency/security, P1 search unification with corrected semantics, P2 tests and API-first cleanup.**

---

## Implementation Follow-up Review - Staged Changes

**Reviewer:** Codex
**Review Date:** 2026-06-09
**Scope:** Reviewed the current `git diff --cached` after another model staged implementation fixes for the architecture issues above.

### What Was Improved

1. **Generate concurrency guard was partially fixed.**
   - `POST /projects/:id/generate` now uses a conditional update with `WHERE projects.status = 'active'`.
   - If no row is claimed, the route returns `409 Conflict`.
   - This addresses the main double-click / concurrent request race where two active generate pipelines could start at the same time.

2. **Search routes were partially consolidated.**
   - `/search` now calls `routeQuery()`.
   - `/mcp/search_knowledge` now calls `routeQuery()`.
   - This removes a large amount of duplicated vector/LIKE search logic from route handlers.

3. **Intent router semantics were partially improved.**
   - Direct lookup now supports `l3_nodes.content` full-text-like matching via `ilike`.
   - Hybrid search now applies a boost when vector and graph results intersect.
   - `escapeLike()`, `sanitizeQuery()`, and `calculateTemporalDecay()` were exported and covered by unit tests.

4. **API-first work was started.**
   - `/search/feedback` was added to `lib/api-spec/openapi.yaml`.
   - Generated API clients and Zod artifacts were regenerated.

5. **Core math tests were added.**
   - New unit tests cover cosine similarity, embedding parsing, query sanitization, LIKE escaping, and temporal decay.

### Blocking Issues Found

1. **High - `/search` runtime response no longer matches OpenAPI.**
   - `artifacts/api-server/src/routes/search.ts` returns `routeQuery().results` directly.
   - Those results are `AgenticSearchResult[]`, which may include `source` and `nodeLayer = "commit"`.
   - `lib/api-spec/openapi.yaml` still declares `/search` as returning `SearchResponse` with `SearchResultItem.nodeLayer` limited to `l1 | l2 | l3`.
   - This breaks the API-first contract and can mislead generated frontend clients.
   - Fix direction: either map `/search` back to the legacy `SearchResultItem` shape, or update the OpenAPI `/search` response to the agentic result shape and adapt the UI intentionally.

2. **High - Project filtering still fails for L3 and Direct results.**
   - `/search` passes `projectId` into `routeQuery()`, but `vectorSearchHandler()` does not apply project filtering to L3 rows.
   - L3 results are returned with `projectId: null`, so the UI can show cross-project results even when a project filter is selected.
   - `directLookupHandler()` also does not receive or enforce `projectId`, so commit hash and content matches can cross project boundaries.
   - Fix direction: join L3 through L2 for project filtering and project metadata, and pass/enforce `projectId` in direct lookup.

3. **High - Admin metabolism auth is fail-open when the environment is misconfigured.**
   - `/admin/metabolism-tick` now checks a token, but falls back to the hardcoded `"dev-secret-token"` when `ADMIN_SECRET_TOKEN` is missing.
   - In production, a missing env var would silently expose the admin route to anyone who knows the default token.
   - Query-param tokens (`admin_token`) are also likely to leak into logs/history.
   - Fix direction: fail closed when `ADMIN_SECRET_TOKEN` is missing, prefer `Authorization: Bearer`, and avoid query-param credentials unless explicitly constrained to local development.

4. **Medium - `/search/feedback` can update the wrong rows and can return false success.**
   - The staged schema uses `{ nodeId, interactionType }` and removes `nodeLayer`.
   - The handler updates both `l2_nodes` and `l3_nodes` with that ID.
   - If L2 and L3 rows share the same numeric ID, both get refreshed. If neither exists, the route still returns success.
   - `interactionType` is accepted but not recorded.
   - Fix direction: restore `nodeLayer` or use a globally unique node reference, check affected row count, and record or intentionally ignore `interactionType` in a documented way.

5. **Medium - Generate guard lacks recovery policy.**
   - The atomic claim is good, but failed pipelines set the project to `error`.
   - Subsequent generate requests now return `409` unless another workflow resets status to `active`.
   - There is no stale `indexing` recovery rule for crashed processes.
   - Fix direction: define explicit recovery/reset behavior for `error` and stale `indexing` states, and test it.

### Verification Results

1. **Typecheck passed.**
   - Command: `pnpm --filter @workspace/api-server run typecheck`
   - Result: passed.

2. **Unit tests passed, but the full API server test command did not complete successfully.**
   - Command: `pnpm --filter @workspace/api-server run test`
   - New unit tests passed.
   - Existing DB-backed integration test failed because local PostgreSQL at `127.0.0.1:5432` was not available.
   - This means the staged changes have not yet been validated by DB-backed route regression tests in this environment.

### Current Merge Readiness

The staged implementation is **not ready to merge as-is**.

The direction is good: the main generate race is reduced, duplicate search logic is smaller, and API/codegen work started. However, the staged changes introduce contract drift and leave key correctness gaps:

1. Fix `/search` response contract mismatch.
2. Enforce project filtering for L3 and direct results.
3. Make admin metabolism auth fail closed.
4. Repair `/search/feedback` identity semantics.
5. Add DB-backed tests for generate concurrency, search project filtering, feedback row targeting, and admin auth.

Only after those are addressed should the changes be considered a real closure of the original architecture findings.
