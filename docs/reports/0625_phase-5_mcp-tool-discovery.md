# Verification Report: Item 6.2.2 — MCP Tool Discovery
- **Date**: 2026-06-25
- **Phase & Item**: Phase 5 - Mcp Tool Discovery
- **Target File**: Unknown (Derived from audit)
- **Status Update Required**: ❌ ERROR / ⚠️ WARN

### Description of Failure
1. **🟡 `read_shared_memory` and `retrieve_original` are undocumented.** These endpoints exist in the route file (mcp.ts:68-91) but are not in the OpenAPI spec. This violates the "API-first" principle stated in AGENTS.md. Any changes to these endpoints won't trigger codegen updates.


2. **🟡 kg-engine MCP page is manually maintained.** The `mcp.tsx` file hardcodes endpoint definitions (name, method, path, description, params). If a new endpoint is added to `mcp.ts`, the UI won't reflect it unless manually updated. This is a direct consequence of having no tool discovery mechanism.


3. **🟡 No test coverage for `read_shared_memory` or `retrieve_original`.** The only MCP integration test is `mcp-list-projects.test.ts`. The two undocumented endpoints have zero test coverage.


4. **🔴 No rate limiting on any MCP endpoint.** Same issue as identified in 6.2.1 report — no rate limiting on MCP routes, which could lead to LLM API credit exhaustion.

### Recommended Fix
Review the warnings and implement fixes in the corresponding source files.
