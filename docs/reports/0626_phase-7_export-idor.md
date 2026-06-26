# Verification Report: Item 6.2.3 — Export (Markdown / JSON) IDOR Vulnerability
- **Date**: 2026-06-26
- **Phase & Item**: Phase 7 - Export (Markdown / JSON)
- **Target File**: `artifacts/api-server/src/routes/export.ts`
- **Status Update Required**: ❌ ERROR

### Description of Failure
1. **🔴 CRITICAL — IDOR / Broken Access Control (CWE-639)**: `export.ts:23` uses `const userId = (req as any).user?.id || 1`. Since no auth middleware populates `req.user`, the fallback `|| 1` means `userId` is always `1`. Since all projects default to `ownerId = 1`, the ownership check `project.ownerId !== userId` always evaluates to `false` — granting unrestricted access to every project's data.

2. **🔴 CRITICAL — No authentication middleware**: No JWT, session, or API key middleware is applied to the export routes. Any unauthenticated user can export all knowledge graph data for any project.

3. **🟡 MEDIUM — N+1 query in JSON export**: For each L2 node, separate queries fetch `l2NodeL1TagsTable` and `l3NodesTable`. Should use JOINs or batch queries.

4. **🟡 MEDIUM — N+1 query in Markdown export**: Inside the streaming loop, each L2 node triggers a separate `l3Nodes` query.

5. **🟡 MEDIUM — No rate limiting on export**: Export operations are data-intensive (dump entire projects). No specific rate limiter is applied.

6. **🟡 MEDIUM — No audit logging**: Exporting sensitive knowledge graph data should be logged for compliance. No `activity_log` entries are created.

7. **🟢 LOW — No tests for ownership check**: No unit or integration tests verify the IDOR fix.

### Recommended Fix
1. Implement authentication middleware (JWT, session, or API key) that populates `req.user.id` from a verified token.
2. Remove the `|| 1` fallback — unauthenticated requests should return 401.
3. Write integration tests verifying: owner can export (200), non-owner cannot export (403), unauthenticated requests get 401.
4. Replace N+1 queries with batched JOINs.
5. Add rate limiting and audit logging for export operations.
