# Verification Report: Item 9.1.4 — Bearer Token Auth for MCP
- **Date**: 2026-06-26
- **Phase & Item**: Phase 5 - MCP Auth
- **Target File**: `artifacts/api-server/src/routes/mcp.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🟡 MEDIUM — Timing side-channel** (`mcp.ts:22`): String comparison via `!==` is not constant-time. An attacker can exploit timing differences to incrementally guess the token. Should use `crypto.timingSafeEqual()` (already used in `github_webhooks.ts:29`).

2. **🟡 MEDIUM — No OpenAPI security declaration**: `openapi.yaml` has zero `components.securitySchemes` entries and zero `security:` fields on paths. Auth is invisible to spec consumers and generated clients.

3. **🟡 MEDIUM — Broken test** (`mcp-list-projects.test.ts:28`): Test calls `GET /api/mcp/list_projects` without setting `MCP_PAT` and without sending an Authorization header, then expects `200`. Since `MCP_PAT` is not set in test env, the middleware returns `500` (fail-closed). The auth implementation has zero meaningful test coverage.

4. **🟡 MEDIUM — No rate limiting on auth endpoints**: No `express-rate-limit` or equivalent on MCP routes (addressed separately in 9.1.7).

5. **🟢 LOW — Non-MCP routes have no auth**: All other API routes have zero authentication. MCP auth provides a false sense of security.

### Recommended Fix
1. Replace `!==` with `crypto.timingSafeEqual()` matching the pattern in `github_webhooks.ts:29`.
2. Add `components.securitySchemes.BearerAuth` and `security: [{BearerAuth: []}]` to all `/mcp/*` paths in OpenAPI spec.
3. Fix broken test: set `process.env.MCP_PAT` in test setup, send `Authorization` header, add 401/500 negative test cases.
4. Apply rate limiting to MCP routes.
