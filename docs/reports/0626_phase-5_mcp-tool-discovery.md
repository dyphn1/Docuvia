# Verification Report: Item 6.2.2 — MCP Tool Discovery
- **Date**: 2026-06-26
- **Phase & Item**: Phase 5 - MCP Tool Discovery
- **Target File**: `artifacts/api-server/src/routes/mcp.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🟡 MEDIUM — No tool discovery endpoint**: There is no `GET /mcp/tools` or equivalent REST endpoint that returns available tools. No JSON-RPC `tools/list` method (the MCP spec's standard discovery mechanism). Clients must be manually configured with endpoint URLs and schemas.

2. **🟡 MEDIUM — kg-engine UI out of sync with implementation**: The UI hardcodes 5 of 8 endpoints. The badge says "5 tools available" but there are 8. New endpoints added to `mcp.ts` do not propagate to the UI.

3. **🟡 MEDIUM — No test coverage for 7 of 8 endpoints**: Only `list_projects` has an integration test. The other 7 endpoints have zero test coverage.

4. **🟢 LOW — OpenAPI spec now complete**: All 8 endpoints documented (improvement since last verification).

### Recommended Fix
1. Implement `GET /api/mcp/tools` that returns a JSON array of available tools with names, descriptions, methods, paths, and parameter schemas.
2. Fix kg-engine UI: update badge to "8 tools" and add missing endpoints. Better yet, generate the list from the OpenAPI spec or discovery endpoint.
3. Add integration tests for all 8 MCP endpoints.
