# Verification Report: Item 9.4.2 — Integration Tests: DB Transactions with withRollback()
- **Date**: 2026-06-26
- **Phase & Item**: Phase 1 - Integration Tests withRollback
- **Target File**: `artifacts/api-server/test/support/db.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🔴 HIGH — Integration tests fail at module-load time**: Both `generate.test.ts` and `mcp-list-projects.test.ts` fail with `Error: Failed to load url sqlite`. The root cause is `artifacts/api-server/src/memory/shared-memory.ts` importing `node:sqlite`, which Vite cannot resolve during test mode. Unit tests (24/24) pass, but both integration tests are completely blocked.

2. **🟡 MEDIUM — Limited test coverage**: Only 2 integration tests exist (`generate.test.ts` and `mcp-list-projects.test.ts`), covering only the generate pipeline and MCP list projects endpoint.

3. **🟡 MEDIUM — `generate.test.ts` tightly coupled to MSW handler response**: The test expects hardcoded L1/L2/L3 names that are tightly coupled to the MSW handler's response. If the fuzzy handler changes, the test breaks.

4. **🟢 LOW — `mcp-list-projects.test.ts` only tests happy path**: No test for empty project list, projects without L2/L3 nodes, or error cases.

### Recommended Fix
1. Fix the `node:sqlite` import issue in `shared-memory.ts` — either add a Vite resolve alias or conditionally import it only in production builds.
2. Add integration tests for all major endpoints (ingest, search, review, export, metabolism).
3. Decouple `generate.test.ts` from hardcoded MSW responses by using scenario-based fixtures.
