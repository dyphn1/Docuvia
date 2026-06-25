# Verification Report: MCP Security (DoS & Prompt Injection)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 5 - MCP Search Knowledge
- **Target File**: artifacts/api-server/src/routes/mcp.ts, artifacts/api-server/src/lib/intent-router.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
1. **Unauthenticated Remote DoS (Node.js Crash):** The authentication middleware in `mcp.ts` checks the `MCP_PAT` using `.length` on strings and then passes them to `crypto.timingSafeEqual(Buffer.from(...))`. Because `.length` counts characters and `Buffer.from()` allocates bytes, an attacker can send a token containing multi-byte characters with the same character count. `timingSafeEqual` will instantly crash the Node.js process with a `RangeError` if the buffer sizes differ.
2. **Bypassed Length Limits (DB DoS):** `GET /mcp/search_knowledge` does not use Zod to validate the max length of `req.query.query`. The `intent-router.ts` applies truncation only for the LLM. An attacker can send a 50MB string that triggers the `isSingleWord` short-circuit, injecting the payload directly into an expensive Postgres `ILIKE` wildcard query, causing immediate DB CPU starvation.
3. **Unescaped SQL Wildcards:** `/mcp/get_dependencies` and `/mcp/impact_analysis` inject `req.query.module` directly into a `like(..., '%${moduleName}%')` statement without using the `sanitizeLikeInput()` utility, allowing attackers to evaluate unintended broad matches.

### Recommended Fix
Fix the auth middleware to use `Buffer.byteLength()` before calling `timingSafeEqual`. Add Zod max-length constraints to all GET MCP endpoints. Use `sanitizeLikeInput()` on all query parameters before passing them to Drizzle ORM `like()` clauses.
