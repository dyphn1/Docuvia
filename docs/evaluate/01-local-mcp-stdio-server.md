# 01. Local MCP Stdio Server

**Severity:** 🔴 CRITICAL
**Domain:** Local MCP Integration
**Target:** `@workspace/cli`

## Deficit Description
Currently, Docuvia's MCP tools (e.g., `Search Knowledge`, `Get Dependencies`) are tightly coupled to the Express API server in `artifacts/api-server/src/routes/mcp.ts`. This requires developers to boot a heavy Node.js HTTP server just to give AI tools access to the knowledge graph. This is a "Local-Server-Required" anti-pattern, violating true Local-First principles.

Competitors like `code-review-graph` run their MCP server directly over standard input/output (`stdio`), allowing Cursor and Claude Desktop to spawn the process invisibly in the background.

## Acceptance Criteria
1. Extract MCP tool definitions and execution logic from the Express routes into a shared library.
2. Implement a new CLI command `docuvia mcp` inside `@workspace/cli`.
3. Use `@modelcontextprotocol/sdk/server/stdio` to expose the extracted tools.
4. The `stdio` server MUST interact exclusively with `.docuvia/local.db` (Local HEAD Index) and require zero network connectivity.