# Docuvia Non-Success Roadmap Verification & Analysis Report

This report compiles and re-organizes all design-verification items that are currently in a non-success status (`FAIL` or `WARN`). It documents the reported findings, summarizes our codebase verification, and details which problems are verified as actual issues in the codebase.

## Table of Contents

- [I. FAIL Items (Critical Blockers)](#i-fail-items-critical-blockers)
- [II. Verified Major WARN Items](#ii-verified-major-warn-items)
- [III. Other WARN Items Summary](#iii-other-warn-items-summary)

## I. FAIL Items (Critical Blockers)

These items are verified as critical blockers that prevent the features from being usable end-to-end.

### Item 2.2.1 — FAIL Project initialization command (docuvia.initProject)

- **Status:** `FAIL`
- **Report File:** [0227_2.2.1.md](./reports/0227_2.2.1.md)

**Codebase Verification (2026-06-23):** _VERIFIED EXISTENCE._

- Checked `artifacts/vscode-client/src/extension.ts` (lines 579-583). The `initProject()` function only creates `l1_tags.yaml` and `_project_profile.yaml`. It does NOT create `l2_modules.yaml` or `l3_router.yaml` as required.
- The directory `.docuvia/l3_decisions/` is not created by `initProject()`.
- The integration test `artifacts/vscode-client/src/tests/phase1.test.ts` asserts the existence of `l2_modules.yaml` and `l3_router.yaml`, which makes the test fail.
- `store.initializeSnapshot(targetRoot)` is commented out.

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                                                                                                |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | ❌ High   | `initProject()` does NOT create `l1_tags.yaml`, `l2_modules.yaml`, or `l3_router.yaml` skeleton files as required by the design spec. Creates `manifest.yaml`, `config.yaml`, `.snapshot-ref` instead. |
| 2   | ❌ High   | `initProject()` does NOT create the `.docuvia/l3_decisions/` directory as required by the design spec.                                                                                                 |
| 3   | ❌ High   | Integration test (`phase1.test.ts`) asserts existence of files that `initProject` doesn't create — test will fail.                                                                                     |
| 4   | ⚠️ Medium | Project name prompt (`showInputBox`) from design spec is not implemented — name is silently taken from directory basename.                                                                             |
| 5   | ⚠️ Medium | `store.initializeSnapshot(targetRoot)` is commented out (line 509) — snapshot ref file is written but snapshot is not initialized.                                                                     |
| 6   | ⚠️ Medium | Path traversal check uses fragile `path.relative()` with joined paths instead of proper containment check.                                                                                             |
| 7   | ⚠️ Low    | `require()` used for `fs/promises` and `js-yaml` in ESM module context (lines 479, 492).                                                                                                               |
| 8   | ℹ️ Info   | Inline init action, viewsWelcome, and context value configuration are correctly implemented.                                                                                                           |
| 9   | ℹ️ Info   | Ecosystem detection (`detectEcosystem`) is a reasonable implementation not explicitly in design spec.                                                                                                  |

## Recommendations

1. **Create skeleton YAML files in `initProject()`**: Add `writeIfAbsent` calls for `l1_tags.yaml`, `l2_modules.yaml`, and `l3_router.yaml` with the skeleton content specified in the design spec (including the `project_name` key in `l1_tags.yaml`).
2. **Create `l3_decisions/` directory**: Add `fs.mkdir(path.join(docuviaDir, 'l3_decisions'), { recursive: true })` to `initProject()`.
3. **Fix the integration test**: Update `phase1.test.ts` to either test for the files that `initProject` actually creates (`manifest.yaml`, `config.yaml`, `.snapshot-ref`), or fix `initProject` to create the files the test expects.
4. **Add project name prompt**: Implement the `showInputBox` step from the design spec, or update the design spec to reflect the intentional simplification.
5. **Uncomment or remove `initializeSnapshot`**: Either implement snapshot initialization or remove the commented-out call and the `.snapshot-ref` file write.
6. **Strengthen path traversal check**: Use a proper path containment check (e.g., ensure `targetRoot` starts with one of the workspace folder paths).

---

## Overall Verdict

**❌ FAIL**

The `docuvia.initProject` command is registered, accessible from the command palette and inline tree view, and successfully creates a `.docuvia/` directory. However, it fails to implement three critical requirements from the design spec: (1) creating the skeleton YAML files (`l1_tags.yaml`, `l2_modules.yaml`, `l3_router.yaml`), (2) creating the `l3_decisions/` directory, and (3) prompting for a project name. The integration test asserts the existence of files that the command doesn't create, making it a failing test. The command produces an empty knowledge graph with no user-facing scaffolding, significantly degrading the onboarding experience. The feature needs the missing file creation logic to be considered functional.

---

### Item 7.3.2 — Query result display with strategy indicator

- **Status:** `FAIL`
- **Report File:** [0301_7.3.2.md](./reports/0301_7.3.2.md)

**Codebase Verification (2026-06-23):** _VERIFIED EXISTENCE._

- Checked `artifacts/kg-engine/src/pages/query.tsx` (lines 65-72). The fetch request sends body fields `{ query, projectId, limit }` instead of `{ q, project_id, limit }`. This triggers Zod validation 400 Bad Request error from the backend.
- There is no `Authorization` header sent by `query.tsx`, causing 401 Unauthorized errors from the backend MCP middleware.
- The `SearchResponse` UI does not parse or render the backend's `routingStrategy`, `metadata.reasoning`, or result `source` field. No strategy indicator badge is displayed.

**Report Findings:**

## Summary

| Aspect                     | Status                | Details                                                                          |
| -------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| Query results display      | ⚠️ Broken in practice | Field name mismatch + no auth make it non-functional                             |
| Result card content        | ✅ Good               | Layer badge, score, project name, title, content all display                     |
| Strategy indicator         | ❌ Missing            | `routingStrategy` is in backend response but frontend never reads or displays it |
| Per-result source          | ❌ Missing            | `AgenticSearchResult.source` not mapped to `SearchResultItem`                    |
| Request contract alignment | ❌ Broken             | `{ query, projectId }` vs `{ q, project_id }` — 400 on every request             |
| Auth                       | ❌ Missing            | No Bearer token sent                                                             |
| Empty/loading states       | ✅ Complete           | Well-implemented UX                                                              |
| Test coverage              | ❌ Missing            | No tests for query page or POST /mcp/query                                       |

## Gaps & Recommendations

1. **[CRITICAL] Fix request body field names** — Change `query.tsx` line 68-72 from `{ query, projectId, limit }` to `{ q, project_id, limit }` to match the `mcpQueryBodySchema` Zod schema in `mcp.ts:230-234`.

2. **[CRITICAL] Add Authorization header** — Add `Authorization: Bearer ${MCP_PAT}` to the fetch call headers (same pattern needed as 7.3.1). Store `MCP_PAT` in env or config.

3. **[HIGH] Display routing strategy indicator** — Add `routingStrategy: RoutingStrategy` and `metadata: { classificationConfidence, reasoning, durationMs }` to the `SearchResponse` interface. Display a strategy badge in the results header (e.g., "🧭 Vector Search" or "🔗 Graph Traversal" or "🔍 Direct Lookup" or "⚡ Hybrid"). Use color-coded badges consistent with the layer badge pattern at lines 173-179.

4. **[HIGH] Display per-result source indicators** — Add `source: "vector" | "graph" | "direct"` to `SearchResultItem`. Show a small icon or label on each result card indicating how it was found (complements the layer badge).

5. **[MEDIUM] Switch to generated React Query hooks** — Import the generated mutation hook for `POST /mcp/query` from `@workspace/api-client-react` instead of raw `fetch()`. This provides automatic cache management and aligns with the project's API-first architecture.

6. **[LOW] Show metadata reasoning** — Optionally display `metadata.reasoning` as a tooltip or subtitle to help users understand why the system chose a particular strategy.

---

### Item 8.4.3 — docuvia.addDecision

- **Status:** `FAIL`
- **Report File:** [0324_8.4.3.md](./reports/0324_8.4.3.md)

**Codebase Verification (2026-06-23):** _VERIFIED EXISTENCE._

- Checked `artifacts/vscode-client/src/extension.ts` (lines 160 and 273). The handlers for `docuvia.addDecision` and `docuvia.addDecisionFromSelection` are indeed commented out.
- The implementation helper function `addDecision()` is entirely missing from the `vscode-client` source files.

**Report Findings:**

## Summary

| Aspect                              | Status            | Details                           |
| ----------------------------------- | ----------------- | --------------------------------- |
| Command registration (package.json) | ✅ Present        | Lines 59, 93, 200                 |
| Command registration (extension.ts) | ✅ Present        | Lines 159, 264                    |
| Handler implementation              | ❌ Missing        | Body is empty/commented out       |
| addDecision function                | ❌ Does not exist | Zero matches across entire `src/` |
| Design spec completeness            | ✅ Complete       | 6-step workflow documented        |
| Test coverage                       | ❌ None           | No tests for either command       |
| End-to-end flow                     | ❌ Non-functional | Command is a silent no-op         |

## Gaps & Recommendations

1. **Implement `addDecision` function** — The entire function body needs to be written. The design spec at `design/command-palette/add-decision.md` provides the complete algorithm. This is the primary blocker.

2. **Uncomment handler calls in `extension.ts:160` and `:273`** — Once the function exists, uncomment the calls or inline the logic directly in the handler.

3. **Add slug collision check** — Before writing, verify no existing file has the same slug. Prompt user to overwrite or rename.

4. **Validate workspace initialization** — Block with "Initialize Docuvia first" if `.docuvia/` is not initialized in the target workspace.

5. **Handle special-character titles** — Validate slug is non-empty after sanitization.

6. **Append to `l3_router.yaml`** — The design doc's known bugs (BUG C-1/I-1) note this gap even in the intended implementation. Address it to make decisions visible to CodeLens/Hover.

7. **Add tests** — At minimum, verify: title input → file creation with correct frontmatter, workspace resolution, uninitialized workspace error.

8. **Consider hiding commands from package.json** — Until implemented, these commands should be removed from `package.json` to avoid user confusion, OR a placeholder message ("This feature is coming soon") should be shown.

---

## II. Verified Major WARN Items

These items have status `WARN` and represent significant architectural drift or design specification mismatches. They have been verified in the codebase.

### Item 6.2.1 — POST /mcp/query endpoint

- **Status:** `WARN`
- **Report File:** [0288_6.2.1.md](./reports/0288_6.2.1.md)

**Codebase Verification (2026-06-23):** _VERIFIED EXISTENCE._

- In `artifacts/api-server/src/routes/mcp.ts`, `mcpQueryBodySchema` is defined inline instead of using the generated schema from `@workspace/api-zod`.
- `include_pending` is read from query params `req.query` instead of body `req.body` in a POST endpoint.

**Report Findings:**

## Summary

| Aspect                         | Status           | Details                                                           |
| ------------------------------ | ---------------- | ----------------------------------------------------------------- |
| Endpoint exists and mounted    | ✅               | `POST /api/mcp/query` via mcpRouter                               |
| Zod validation                 | ✅ Strong        | Inline schema with `.safeParse()`, returns 400                    |
| Bearer token auth              | ✅               | MCP_PAT middleware on all `/mcp/*` routes                         |
| Intent routing (4-way)         | ✅ Full          | vector, graph, direct, hybrid all implemented                     |
| O(1) fast-path filters         | ✅               | `#attach`, file extension, architectural term                     |
| LLM classification fallback    | ✅               | gpt-4o-mini with JSON response format                             |
| Response shape matches OpenAPI | ✅               | `{ query, routingStrategy, entities, results, metadata }`         |
| Error handling                 | ✅               | Try/catch + logger, 400 for validation, 500 for server errors     |
| Input sanitization             | ✅               | Control char stripping, LIKE escaping                             |
| Generated Zod usage            | ⚠️ Gap           | Inline schema instead of `McpQueryBody` from `@workspace/api-zod` |
| `include_pending` parameter    | ⚠️ Inconsistency | Query param not documented in OpenAPI spec                        |
| Rate limiting                  | ❌ Missing       | No rate limiting on any MCP endpoint                              |
| Integration test coverage      | ❌ Missing       | No test for POST `/mcp/query` or any MCP query endpoint           |

## Gaps & Recommendations

1. **Migrate inline Zod schema to generated.** Replace the inline `mcpQueryBodySchema` (mcp.ts:230-234) with `McpQueryBody` from `@workspace/api-zod`. If the stricter `.int().positive()` constraints are desired, add them to the OpenAPI spec and regenerate. This ensures the "API-first" principle is enforced.

2. **Add `include_pending` to OpenAPI spec or body schema.** Either add `include_pending` as a query parameter in the OpenAPI path definition, or move it into the `McpQueryInput` body schema for consistency. Document the behavior either way.

3. **Add integration tests for POST `/mcp/query`.** Create `artifacts/api-server/test/integration/mcp-query.test.ts` with test cases for:
   - Valid query with results
   - Missing `q` parameter (400)
   - `q` exceeding 2000 chars (400)
   - Invalid `project_id` (400)
   - `include_pending=true` returning pending nodes
   - Bearer token missing (401)
   - Bearer token invalid (401)

4. **Add rate limiting to MCP endpoints.** Implement a rate limiter (e.g., `express-rate-limit`) on the MCP router to prevent LLM API credit exhaustion. Consider per-token rate limits since MCP uses PAT authentication.

5. **Fix redundant boolean expressions.** Remove `|| false` from lines 98 and 244 in mcp.ts. The comparison already returns a boolean.

## Final Verdict: ⚠️ WARN

The POST `/mcp/query` endpoint is **fully implemented and operational** with correct Zod validation, Bearer token auth, 4-way intent routing, O(1) fast-path filters, and proper error handling. The architecture is solid and matches the design spec. The gaps are: (1) inline Zod schema instead of generated (spec drift risk), (2) `include_pending` parameter inconsistency between implementation and OpenAPI spec, (3) no rate limiting, and (4) no integration test coverage for this endpoint. These are quality and completeness concerns, not functional defects.

---

### Item 6.2.2 — MCP tool discovery

- **Status:** `WARN`
- **Report File:** [0290_6.2.2.md](./reports/0290_6.2.2.md)

**Codebase Verification (2026-06-23):** _VERIFIED EXISTENCE._

- Endpoints `/mcp/read_shared_memory` and `/mcp/retrieve_original` exist in `artifacts/api-server/src/routes/mcp.ts` but are completely missing from `lib/api-spec/openapi.yaml`.
- There is no programmatically exposed tool discovery endpoint conforming to standard MCP.

**Report Findings:**

## Summary

| Aspect                             | Status     | Details                                                                           |
| ---------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| Individual MCP endpoints exist     | ✅         | 8 endpoints in `mcp.ts`, all functional                                           |
| Bearer token auth on all endpoints | ✅         | MCP_PAT middleware on all `/mcp/*` routes                                         |
| Input validation                   | ✅         | All endpoints validate required params, return 400                                |
| Error handling                     | ✅         | Try/catch + logger on all endpoints                                               |
| OpenAPI spec coverage              | ⚠️ Gap     | 6 of 8 endpoints documented; `read_shared_memory` and `retrieve_original` missing |
| kg-engine UI coverage              | ⚠️ Gap     | 5 of 8 endpoints listed; hardcoded                                                |
| Tool discovery endpoint            | ❌ Missing | No `tools/list` or equivalent discovery mechanism                                 |
| Test coverage                      | ❌ Missing | Only 1 of 8 endpoints has integration tests                                       |
| Rate limiting                      | ❌ Missing | No rate limiting on any MCP endpoint                                              |

## Gaps & Recommendations

1. **Add a tool discovery endpoint.** Implement `GET /api/mcp/tools` (or `GET /api/mcp/tools/list`) that returns a JSON array of available tools with their names, descriptions, HTTP methods, paths, and parameter schemas. This would:
   - Enable dynamic client-side discovery
   - Keep the kg-engine UI in sync automatically
   - Follow the MCP specification's capability advertisement pattern

2. **Document all endpoints in OpenAPI spec.** Add `read_shared_memory` and `retrieve_original` to `lib/api-spec/openapi.yaml` and run codegen. This enforces the "API-first" principle.

3. **Make the kg-engine MCP page dynamic.** Instead of hardcoding endpoints in `mcp.tsx`, fetch the tool list from the discovery endpoint (once implemented) or generate it from the OpenAPI spec.

4. **Add integration tests for all MCP endpoints.** Create test files for the 7 untested endpoints, covering success cases, validation errors, and auth failures.

5. **Add rate limiting.** As noted in the 6.2.1 report, implement rate limiting on MCP routes to prevent LLM API credit exhaustion.

## Final Verdict: ⚠️ WARN

The individual MCP tool endpoints are **fully implemented and operational** — 8 endpoints exist with proper auth, validation, and error handling. However, **MCP tool discovery is missing**: there is no programmatic mechanism for clients to discover available tools. The OpenAPI spec partially serves this role but is incomplete (6 of 8 endpoints). The kg-engine UI hardcodes a subset of 5 endpoints. The lack of a discovery endpoint means clients must be manually configured, and new endpoints are invisible until separately documented. This is a completeness and maintainability gap, not a functional defect in the individual endpoints.

---

### Item 6.2.3 — Bearer token auth for MCP

- **Status:** `WARN`
- **Report File:** [0292_6.2.3.md](./reports/0292_6.2.3.md)

**Codebase Verification (2026-06-23):** _VERIFIED EXISTENCE._

- In `openapi.yaml`, there are no `securitySchemes` defined for MCP routes.
- The Bearer token verification in `mcp.ts` uses simple string comparison (`!==`) instead of timing-safe checks (`crypto.timingSafeEqual`).

**Report Findings:**

## Summary

| Aspect                         | Status     | Details                                                      |
| ------------------------------ | ---------- | ------------------------------------------------------------ |
| Auth middleware exists         | ✅         | `router.use("/mcp", ...)` at mcp.ts:19-36                    |
| All MCP endpoints protected    | ✅         | 8/8 endpoints covered by middleware                          |
| Fail-closed on missing env var | ✅         | Returns 500 if `MCP_PAT` unset                               |
| Proper HTTP status codes       | ✅         | 401 for bad token, 500 for misconfig                         |
| Logging of auth events         | ✅         | IP logging on 401, error logging on 500                      |
| CLI sends Bearer token         | ✅         | `scripts/src/cli.ts:23`                                      |
| Timing-safe comparison         | ❌ Missing | Uses `!==` instead of `crypto.timingSafeEqual()`             |
| OpenAPI spec declares auth     | ❌ Missing | No `securitySchemes` or `security` fields                    |
| Test coverage for auth         | ❌ Missing | No tests for 401/500 responses; existing test sends no token |
| Token generation/rotation      | ❌ Missing | No token lifecycle management                                |
| Rate limiting                  | ❌ Missing | Unlimited auth attempts allowed                              |
| Non-MCP route auth             | ❌ Missing | All other API routes are unprotected                         |

## Gaps & Recommendations

1. **Use timing-safe token comparison.** Replace `authHeader !== \`Bearer ${expectedToken}\``with`crypto.timingSafeEqual()` to prevent timing side-channel attacks. This is a security best practice for any token comparison.

2. **Add `securitySchemes` to OpenAPI spec.** Define a `BearerAuth` security scheme in `components.securitySchemes` and add `security: [{ BearerAuth: [] }]` to all MCP paths. This makes the auth requirement visible to spec consumers and generated clients.

3. **Add auth tests.** Write tests that verify:
   - 401 response when no token is sent
   - 401 response when an invalid token is sent
   - 500 response when `MCP_PAT` is not set
   - 200 response when a valid token is sent

4. **Set `MCP_PAT` in test setup.** The test bootstrap (`setup.ts`) should set `process.env.MCP_PAT` to a test token so the middleware can function during tests.

5. **Consider per-project token scoping.** The current single-global-token model means any token holder can access all MCP endpoints for all projects. Consider scoping tokens to specific projects for production use.

6. **Add rate limiting.** As noted in 6.2.1 and 6.2.2 reports, implement rate limiting on MCP routes to prevent brute-force token guessing.

## Final Verdict: ⚠️ WARN

Bearer token authentication for MCP is **implemented and functional** — all 8 MCP endpoints are protected by middleware that checks `Authorization: Bearer <token>` against the `MCP_PAT` environment variable. The design is sound: fail-closed on missing config, proper HTTP status codes, and IP logging on unauthorized attempts.

However, there are three categories of gaps:

1. **Security hardening needed:** The token comparison uses string inequality (`!==`) instead of `crypto.timingSafeEqual()`, making it theoretically vulnerable to timing attacks.

2. **Spec-code drift:** The OpenAPI spec does not declare any security requirements for MCP endpoints, violating the "API-first" principle and making auth invisible to generated clients.

3. **Test coverage is absent:** No tests verify the auth middleware behavior. The existing MCP test sends no token and the test environment doesn't set `MCP_PAT`, meaning the test is either failing silently or bypassing the middleware.

The auth mechanism works for its intended purpose (protecting MCP endpoints with a Bearer token) but needs hardening, documentation in the spec, and test coverage to be production-ready.

---

### Item 5.3.3 — Default fallback templates not seeded in migrations (D-07)

- **Status:** `WARN`
- **Report File:** [0291_5.3.3.md](./reports/0291_5.3.3.md)

**Codebase Verification (2026-06-23):** _VERIFIED EXISTENCE._

- In `artifacts/api-server/src/routes/templates.ts` (lines 58-69), the templates GET endpoint only queries project-specific templates (`eq(promptTemplatesTable.projectId, projectId)`) and directly falls back to the hardcoded `DEFAULT_PROMPTS` constant. It completely bypasses the global database-seeded templates (`projectId IS NULL`).
- The seed check in `lib/db/src/migrate.ts` checks for any rows in `promptTemplatesTable`, rather than checking for global/system-level templates specifically.

**Report Findings:**

## Findings

1. **Seed data is defined but uses a flawed check.** The `DEFAULT_PROMPT_TEMPLATES` constant exists in `migrate.ts` with appropriate content for all 3 types. However, the seeding check (`if (existing.length === 0)`) tests whether **any** row exists in the table — not whether global templates exist. If any project-specific template is created before the seed runs (e.g., during testing or manual DB manipulation), the seed is skipped entirely, leaving the global DB tier empty. ⚠️

2. **Seed is in the migration runner, not in a DDL migration file.** The seed logic lives in `migrate.ts` (the Node.js migration runner), not in a Drizzle migration SQL file under `lib/db/drizzle/`. This means:
   - The seed only runs when `migrate.ts` is explicitly invoked (via `pnpm --filter @workspace/db run migrate` or similar)
   - It does NOT run during `pnpm --filter @workspace/db run push` (which uses `drizzle-kit push` to apply DDL directly)
   - Teams using `push` for local development will never see the seed execute
   - This is the root cause of D-07: the templates are "not seeded in migrations" because they're in the wrong layer ⚠️

3. **The global DB tier in `getPromptTemplate()` is effectively dead code.** Since the seed doesn't run reliably (wrong check + wrong layer), Tier 2 of the fallback chain (`projectId IS NULL`) will always be empty in practice. The system always falls through to Tier 3 (hardcoded defaults). The code path exists but is non-functional. ⚠️

4. **Hardcoded defaults in `templates.ts` are more comprehensive than seed defaults.** The `DEFAULT_PROMPTS` constant in `templates.ts` (lines 9-46) contains detailed, well-structured prompts with JSON output format instructions. The seed defaults in `migrate.ts` (lines 9-25) are shorter and less detailed. This means the global DB tier (Tier 2), even when populated, would provide **lower quality** prompts than the hardcoded fallback (Tier 3). This is a content quality gap. ⚠️

5. **The GET endpoint in `templates.ts` doesn't query the global DB tier.** The GET `/projects/:id/templates` endpoint (lines 52-78) only queries for project-specific templates (`WHERE projectId = :id`). It falls back to hardcoded `DEFAULT_PROMPTS` for any type not found. It never queries the global DB tier (`projectId IS NULL`). This means global DB templates are only used by `getPromptTemplate()` in the generate pipeline, not by the API/UI layer. ⚠️

### Gaps Identified

**Gap 1 — Seed logic is in the wrong layer.** The seed is in `migrate.ts` (migration runner) instead of a Drizzle migration SQL file. It should be in a migration file like `lib/db/drizzle/0001_seed_default_templates.sql` to ensure it runs consistently across all deployment paths (push, migrate, CI).

**Gap 2 — Seed check is too broad.** `if (existing.length === 0)` checks for any row, not for global templates specifically. Should check `WHERE projectId IS NULL` to avoid skipping seed when project-specific templates exist.

**Gap 3 — Seed content is lower quality than hardcoded defaults.** The seed data in `migrate.ts` has shorter, less detailed prompts than the `DEFAULT_PROMPTS` constant in `templates.ts`. If the global DB tier is populated, it would provide worse prompts than the hardcoded fallback.

**Gap 4 — GET endpoint doesn't use global DB tier.** The templates API endpoint only queries project-specific templates and falls back to hardcoded defaults, completely bypassing the global DB tier.

## Round 2 — Code Quality & Security Review

**Seed logic quality:**

- The `DEFAULT_PROMPT_TEMPLATES` constant is properly typed with `as const`. ✅
- The insert maps fields correctly (`templateType`, `systemPrompt`, `isActive`). ✅
- No `projectId` in the seed data → defaults to `NULL` → global templates. ✅
- The advisory lock (lines 42-43) ensures seed runs exclusively. ✅

**Flawed guard condition:**

```typescript
const existing = await db.select().from(promptTemplatesTable).limit(1);
if (existing.length === 0) { ... }
```

This should be:

```typescript
const existing = await db.select().from(promptTemplatesTable)
  .where(isNull(promptTemplatesTable.projectId)).limit(1);
if (existing.length === 0) { ... }
```

**Content quality comparison:**

| Aspect                      | `templates.ts` DEFAULT_PROMPTS (Tier 3)   | `migrate.ts` DEFAULT_PROMPT_TEMPLATES (Tier 2) |
| --------------------------- | ----------------------------------------- | ---------------------------------------------- |
| l1_tagger length            | ~500 chars, detailed categories           | ~120 chars, basic                              |
| l2_extractor length         | ~900 chars, JSON schema, confidence guide | ~130 chars, basic                              |
| l3_generator length         | ~200 chars, detailed focus areas          | ~150 chars, basic                              |
| Output format instructions  | Explicit JSON-only instruction            | None                                           |
| Confidence scoring guidance | Detailed (1.0/0.7/0.4 scale)              | None                                           |

The seed data would produce **lower quality LLM outputs** than the hardcoded fallback.

**Security:**

- No injection risk: seed data is a static constant, not user input. ✅
- No access control concern: seed runs at migration time with DB admin privileges. ✅

## Round 3 — Integration & Completeness Review

**End-to-end flow for template resolution:**

```
User creates project → No templates in DB
  → GET /projects/:id/templates → falls back to hardcoded DEFAULT_PROMPTS ✅
  → Generate pipeline → getPromptTemplate() → Tier 1 (empty) → Tier 2 (empty) → Tier 3 (hardcoded) ✅
  → Result: Works, but only because Tier 3 exists

Admin seeds global templates via migration → migrate.ts runs
  → Tier 2 now has data (if migrate.ts is used, not push)
  → GET /projects/:id/templates → STILL uses hardcoded (doesn't query Tier 2) ⚠️
  → Generate pipeline → getPromptTemplate() → Tier 2 now works ✅
  → Result: Partial — generate pipeline benefits, API/UI does not

Admin customizes global templates via DB
  → No API endpoint exists to update global templates (projectId = NULL) ⚠️
  → Only project-specific templates can be edited via PUT/DELETE
  → Result: Global templates are not manageable through the UI
```

**Test coverage:**

- Zero tests for the seed logic in `migrate.ts`
- Zero tests for the `getPromptTemplate()` fallback chain
- Zero tests for the global DB tier query path
- No factory for `promptTemplatesTable` in `factories.ts`

**Deployment paths:**

| Path                               | Seed runs?                | Global templates available?           |
| ---------------------------------- | ------------------------- | ------------------------------------- |
| `drizzle-kit push`                 | ❌ No                     | ❌ No — Tier 2 always empty           |
| `migrate.ts` via CLI               | ✅ Yes (if no rows exist) | ⚠️ Yes, but lower quality than Tier 3 |
| `drizzle-kit generate` + `migrate` | ✅ Yes                    | ⚠️ Yes, but lower quality than Tier 3 |

## Summary

| Aspect                                                                  | Status | Details                                                                        |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `prompt_templates` table supports global templates (nullable projectId) | ✅     | Schema correctly supports inheritance model                                    |
| Seed data is defined in `migrate.ts`                                    | ✅     | 3 template types with appropriate types                                        |
| Seed runs in DDL migration                                              | ❌     | Seed is in `migrate.ts` runner, not a Drizzle migration file                   |
| Seed check is correct                                                   | ❌     | Checks for any row, not global templates specifically                          |
| Seed content matches hardcoded defaults                                 | ❌     | Seed prompts are shorter and less detailed than `templates.ts` DEFAULT_PROMPTS |
| GET endpoint uses global DB tier                                        | ❌     | Only queries project-specific, falls back to hardcoded                         |
| Generate pipeline uses global DB tier                                   | ✅     | Tier 2 query exists but is non-functional (empty)                              |
| Global templates manageable via UI                                      | ❌     | No API endpoint for `projectId = NULL` templates                               |
| Test coverage                                                           | ❌     | Zero tests for seed logic or fallback chain                                    |

## Gaps & Recommendations

1. **Move seed to a Drizzle migration file.** Create `lib/db/drizzle/0001_seed_default_prompt_templates.sql` (or similar) with `INSERT INTO prompt_templates (template_type, system_prompt, is_active) VALUES ... ON CONFLICT DO NOTHING`. This ensures the seed runs on both `push` and `migrate` paths.

2. **Fix the seed guard condition.** Change the check from `if (existing.length === 0)` to check specifically for global templates: `WHERE projectId IS NULL`.

3. **Align seed content with hardcoded defaults.** Use the same detailed prompts from `templates.ts` DEFAULT_PROMPTS as the seed data, or better yet, import the constant from a shared module to avoid duplication.

4. **Update the GET endpoint to query the global DB tier.** The GET `/projects/:id/templates` endpoint should check Tier 2 (global DB templates) before falling back to hardcoded defaults. This would make global template customization visible in the UI.

5. **Add an API endpoint for global template management.** Currently, there's no way to create/update global templates (`projectId = NULL`) through the API. Add `PUT /templates/:type` (without project scope) for global template management.

6. **Add tests.** Test the seed logic, the `getPromptTemplate()` fallback chain (all 3 tiers), and the global template query path.

## Final Verdict: ⚠️ WARN

The `prompt_templates` table schema correctly supports global default templates (nullable `projectId`), and the generate pipeline's `getPromptTemplate()` function has a properly structured 3-tier fallback chain. However, **default fallback templates are not reliably seeded in migrations** (D-07). The seed logic lives in the wrong layer (`migrate.ts` runner instead of a Drizzle migration file), uses an overly broad guard condition, and contains lower-quality prompt content than the hardcoded fallback. As a result, the global DB tier (Tier 2) is effectively non-functional: it's always empty when using `drizzle-kit push` (the standard local dev workflow), and even when populated, its prompts are lower quality than the hardcoded Tier 3 fallback. The system works in practice because Tier 3 (hardcoded `DEFAULT_PROMPTS`) provides comprehensive fallback, but the global DB tier — which is the foundation of the template inheritance model — is dead code. This is a known, documented gap (D-07, 🟡 Medium priority).

---

## III. Other WARN Items Summary

These items represent minor gaps, missing tests, or warnings. Below is a structured summary of their findings.

### Item 1.1.4 — Test factories for DB state creation (factories.ts)

- **Status:** `WARN`
- **Report File:** [0209_1.1.4.md](./reports/0209_1.1.4.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                                                                                                                                    |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 🔴 High   | 13 of 19 tables (68%) lack factories — l1_tags, review_tasks, correction_examples, pull_requests, project_integrations, notifications, subscriptions, llm_configs, prompt_templates, node_links, job_queue, error_reports, commit_l2_links |
| 2   | 🟡 Medium | No `L1TagFactory` — L1 tags are a core knowledge graph tier and needed for testing the generate pipeline, intent router, and review system                                                                                                 |
| 3   | 🟡 Medium | No `ReviewTaskFactory` — blocks testing of the review system (Milestone 5) which depends on review_tasks with enum values (anchor/correct/validate/merge, pending/approved/rejected/deferred)                                              |
| 4   | 🟡 Medium | `DocumentFactory.build()` requires `projectId` but schema allows null — cannot create misc pool documents (ADR-012)                                                                                                                        |
| 5   | 🟡 Medium | `DocumentFactory` doesn't handle `contentHash` or `affiliatedAt` fields — tests for document deduplication and affiliation flows must manually set these                                                                                   |
| 6   | 🟢 Low    | `any` type used for `client` parameter in `getDb()` helper and all factory `create()` methods — bypasses TypeScript type checking                                                                                                          |
| 7   | 🟢 Low    | Inconsistent parameter signatures between `build()` (explicit required params) and `create()` (everything in overrides)                                                                                                                    |
| 8   | 🟢 Low    | No unit tests for the factories themselves — no `*.unit.test.ts` files exist anywhere in the project                                                                                                                                       |
| 9   | 🟢 Low    | `job_queue.ts` uses `$inferInsert` instead of Zod-inferred type — inconsistent with all other schemas                                                                                                                                      |
| 10  | 🟢 Low    | Global `faker.seed(123)` means all tests share the same faker sequence — could cause ordering-dependent behavior                                                                                                                           |

## Recommendations

1. **Add factories for all 13 missing tables.** Priority order based on testing needs:
   - **High priority:** `L1TagFactory`, `ReviewTaskFactory`, `NodeLinkFactory` — needed for core feature tests
   - **Medium priority:** `CorrectionExampleFactory`, `PullRequestFactory`, `ProjectIntegrationFactory`, `NotificationFactory`, `SubscriptionFactory`, `LlmConfigFactory`, `PromptTemplateFactory` — needed for Milestone 5/6 feature tests
   - **Low priority:** `JobQueueFactory`, `ErrorReportFactory`, `CommitL2LinkFactory` — needed for metabolism and DLQ tests

2. **Fix DocumentFactory to support misc pool documents.** Make `projectId` optional in `build()`:

   ```typescript
   build: (overrides?: Partial<InsertDocument>): InsertDocument => ({
     projectId: null,
     filename: faker.system.fileName(),
     ...
   })
   ```

3. **Add `contentHash` generation to DocumentFactory.** Use a hash of the content or a random hex string.

4. **Type the `client` parameter properly.** Replace `any` with the `DbClient` type from `lib/db/src/index.ts`.

5. **Consider aligning `create()` signatures with `build()`** — extract required FK params as explicit parameters rather than burying them in overrides.

6. **Add unit tests for factories** to verify that `build()` produces valid insert objects and `create()` correctly inserts into the database.

## Overall Verdict

**⚠️ WARN** — The existing 6 factories are well-designed and correctly implemented, following a clean `build()`/`create()` pattern with override support and transaction compatibility. They integrate properly with `withRollback()` and the Vitest test infrastructure. However, the coverage is significantly incomplete: only 6 of 19 tables (31.6%) have factories. The missing factories for `l1_tags`, `review_tasks`, `node_links`, and other core tables create a substantial barrier to writing comprehensive integration tests. The `DocumentFactory` also doesn't support the misc pool use case (nullable `projectId`) or the `contentHash` field. These gaps should be addressed to achieve the design spec's goal of convenient DB state creation for all test scenarios.

---

### Item 1.2.1 — ️ Git ingestion via child_process.spawn streaming

- **Status:** `WARN`
- **Report File:** [0210_1.2.1.md](./reports/0210_1.2.1.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                                                                                                                                                                           |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🟡 Medium | Noise commits (merge, bump, chore) are stored with `valid=false` instead of being skipped, contrary to the design's "signal/filter" intent. scoreCommit returns `valid: false` but processIngestion still inserts. (ingestion-pipeline.ts:89-97)                                  |
| 2   | 🟡 Medium | `lastGitIngestedAt` cursor is updated redundantly in both `processIngestion` (unconditionally, ingestion-pipeline.ts:104-106) and the route handler (conditionally, ingest.ts:80-85). The unconditional update in the pipeline means full-mode ingestion also updates the cursor. |
| 3   | 🟡 Medium | No tests exist for the git ingestion path — no unit tests for `LocalGitClient`, no integration tests for the ingest endpoint, no tests for incremental mode.                                                                                                                      |
| 4   | 🟡 Medium | All diffs are buffered in memory before processing (ingest.ts:60-71). For 500 commits with large diffs, this could cause OOM.                                                                                                                                                     |
| 5   | 🟢 Low    | `getDiff()` silently swallows errors by resolving with empty string instead of rejecting (git-client.ts:165-168). Spawn errors (e.g., git not found) are invisible.                                                                                                               |
| 6   | 🟢 Low    | `getCommits()` doesn't capture stderr — git log error messages are lost (git-client.ts:49).                                                                                                                                                                                       |
| 7   | 🟢 Low    | No timeout on spawned git processes — a hung git process blocks indefinitely.                                                                                                                                                                                                     |
| 8   | 🟢 Low    | `getCommits()` mixes `for await` async iteration with Promise constructor wrapping (git-client.ts:57-94) — a known anti-pattern.                                                                                                                                                  |
| 9   | 🟢 Low    | Diff fetching is sequential (for...of + await), which won't meet the 1000-commits-in-30s quality target for large repos.                                                                                                                                                          |

## Recommendations

1. **Skip noise commits entirely** during ingestion rather than storing them with `valid=false`. If storage is desired for audit purposes, add a separate `isNoise` boolean or filter at the DB query level. (Addresses finding #1)

2. **Remove the redundant `lastGitIngestedAt` update** from `processIngestion` (ingestion-pipeline.ts:104-106) and keep only the route handler's conditional update. Alternatively, make the pipeline's update conditional on an explicit parameter. (Addresses finding #2)

3. **Add integration tests for git ingestion:** Create a test that clones a small test repository (or mocks `child_process.spawn` output) and verifies the full ingestion flow including incremental mode. (Addresses finding #3)

4. **Stream diffs in batches** instead of buffering all diffs: process each batch of commits (with their diffs) through `processIngestion` immediately, then fetch the next batch. (Addresses finding #4)

5. **Add a timeout option** to spawned git processes and reject on timeout. (Addresses finding #7)

6. **Capture stderr** in `getCommits` and include it in error messages for better debuggability. (Addresses finding #6)

7. **Consider parallel diff fetching** with a concurrency limit (e.g., 5-10 concurrent `git show` processes) to improve throughput for large repos. (Addresses finding #9)

## Overall Verdict

**⚠️ WARN** — The Git ingestion feature is functionally implemented and correctly uses `child_process.spawn` with `readline` for streaming, matching the design specification. The OpenAPI contract is properly defined and aligned with the route handler. However, the feature has notable gaps: (1) noise commits are stored rather than filtered, (2) the `lastGitIngestedAt` cursor has a redundant update path, (3) there are zero tests for the entire git ingestion path, and (4) memory usage could be problematic for large ingestions due to full diff buffering. The issues are addressable and do not require architectural changes.

---

### Item 1.2.2 — ️ SVN ingestion via svn log --xml, svn diff

- **Status:** `WARN`
- **Report File:** [0211_1.2.2.md](./reports/0211_1.2.2.md)

**Report Findings:**

## Findings Summary

| #   | Severity   | Category      | Finding                                                                                                               |
| --- | ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 Missing | Architecture  | No `VcsIngestAdapter` interface or `SvnIngestAdapter` class — violates POP coding rule from §8.3                      |
| 2   | 🟡 Minor   | Security      | URL validation rejects `svn+ssh://` despite OpenAPI spec advertising it as valid                                      |
| 3   | 🟡 Medium  | Reliability   | SVN ingestion has no transaction wrapper; partial failures leave inconsistent state                                   |
| 4   | 🟡 Minor   | Consistency   | SVN stores diff concatenated into `message` (unlike Git); actual commit message is lost when total exceeds 4000 chars |
| 5   | 🟡 Minor   | Security      | Password passed as CLI argument (visible in process listing)                                                          |
| 6   | 🟡 Minor   | Documentation | OpenAPI spec missing 400, 500, 502 response codes for the SVN ingest endpoint                                         |
| 7   | 🟡 Minor   | Code Quality  | Redundant Zod parsing of `mode` field (parsed twice by different schemas)                                             |
| 8   | 🟡 Medium  | Testing       | Zero test coverage for SVN ingestion (`svn-client.ts`, ingest route, `processIngestion` SVN path)                     |
| 9   | 🟢 Info    | Code Quality  | Raw Zod error returned as `details` in 400 response could leak schema internals                                       |

---

## Overall Verdict

**⚠️ WARN**

The SVN ingestion feature is functionally implemented and correctly follows the core design: streaming `svn log --xml` via spawn, `svn diff` via execFile, incremental cursor via `lastSvnRevision`, batch processing, and signal/noise filtering via `scoreCommit()`. Security is generally sound with no shell injection vulnerabilities.

However, the feature deviates from the project's mandatory POP architecture pattern (no adapter interface/implementation), has inconsistent transaction handling compared to Git, stores diffs inside the message field, blocks valid `svn+ssh://` URLs, and has zero test coverage. These issues collectively warrant a ⚠️ WARN rating rather than a clean pass.

---

### Item 1.2.3 — ️ Document upload and parsing (isolated via child_process.fork)

- **Status:** `WARN`
- **Report File:** [0212_1.2.3.md](./reports/0212_1.2.3.md)

**Report Findings:**

## Findings

**[R1.1] ✅ Fork isolation correctly implemented for PDF/DOCX/PPTX.**
`document-parser.ts` (lines 33–78) creates a forked `parser-worker.js` with `--max-old-space-size=512` memory limit, a 60-second `setTimeout` with `SIGKILL` fallback, and random temp file paths using `crypto.randomBytes(8)`. This matches the design requirement for "hard OS-level memory/timeout boundaries" in §8.7 of the crosscutting concepts document.

**[R1.2] ✅ Magic byte validation in route handler.**
`routes/documents.ts` (lines 111–124) checks PDF magic bytes (`25504446`) and ZIP-based Office magic bytes (`504B0304`) before proceeding. This matches §8.7 security requirements.

**[R1.3] ✅ contentHash computation.**
`routes/documents.ts` (line 126) calls `computeHashFromStream(filePath)` to compute SHA-256 hashes. The `hash.ts` utility uses a streaming hash approach.

**[R1.4] ✅ Upload middleware enforces whitelist.**
`middlewares/upload.ts` checks both MIME types and file extensions against allowed sets. Max file size: 10MB.

**[R1.5] ✅ Database schema has required fields.**
The `documents` table includes `contentHash`, `affiliatedAt`, `validityStatus`, `status`, `uploadedBy`, and `docType` columns as expected.

### Gaps

**[R1.6] ⚠️ POST `/documents` endpoint missing from OpenAPI spec.**
The documents route defines `POST /documents` (line 91) for file upload, but the OpenAPI spec (`openapi.yaml`) only defines:

- `GET /projects/{id}/documents` (operationId: `listDocuments`)
- `GET /documents/misc` (operationId: `listMiscDocuments`)
- `POST /documents/{id}/affiliate` (operationId: `affiliateDocument`)
- `POST /documents` is **absent**.

This violates the API-First principle (§4.3): "Never hand-write API types... Always edit `openapi.yaml` → run codegen."

---

## Round 2 — Code Quality & Security Review

### Critical Bug: Memory Storage vs. Disk Read Mismatch

**[R2.1] ❌ BUG — multer `memoryStorage()` with disk-based reads.**
`middlewares/upload.ts` (line 16) uses `multer.memoryStorage()`, which stores uploaded files **in memory** as a `Buffer` on `req.file.buffer`. `req.file.path` will be `undefined`.

However, `routes/documents.ts` (lines 108, 111, 126, 127, 129) calls:

```typescript
const filePath = req.file.path; // undefined with memoryStorage
const fileBuffer = await fs.promises.readFile(filePath); // THROWS
const contentHash = await computeHashFromStream(filePath); // THROWS
const rawContent = await fs.promises.readFile(filePath, "utf-8"); // THROWS
```

This will throw `ENOENT` at runtime when `req.file.path` is undefined. The server should either:

- Switch to `multer.diskStorage()` (writing to disk), OR
- Use `req.file.buffer` directly (available with `memoryStorage()`).

### Design Gap: Raw Binary Content Stored for Binary Formats

**[R2.2] ⚠️ Binary content stored as document text for PDF/DOCX/PPTX.**
`routes/documents.ts` line 127 reads all file types as `utf-8` text:

```typescript
const rawContent = await fs.promises.readFile(filePath, "utf-8");
```

For PDF, DOCX, and PPTX files, this produces garbled binary output — not the extracted plain text. The `extractText()` function from `document-parser.ts` exists and is specifically designed to parse these formats using forked workers, but it is **never called** in the upload route.

When a user uploads a PDF, the uploaded document record will contain binary garbage in the `content` column instead of the actual text content.

### Security: Default User ID

**[R2.3] ⚠️ Hardcoded fallback user ID.**
`routes/documents.ts` line 95:

```typescript
const uploadedBy = (req as any).user?.id || 1;
```

The hardcoded fallback to user `1` means unauthenticated uploads are silently attributed to an arbitrary user. If auth middleware is not yet implemented, this should either reject unauthenticated requests or use `null` for `uploadedBy`.

### Security: TOCTOU Race in Quota Check

**[R2.4] ℹ️ Non-atomic quota check.**
Lines 98–105 check `COUNT(*) >= 1000` before inserting. Two concurrent requests could both read `999` and both proceed to insert, exceeding the 1000-document limit. For a v1 system with low concurrency this is acceptable, but should be hardened with a database constraint or advisory lock in the future.

### Code Quality Issues

**[R2.5] ℹ️ `extractText()` is never called.**
The `extractText()` function in `document-parser.ts` is exported but only used in unit test contexts (if at all). The documents route imports `detectDocType` but not `extractText`. The PDF/DOCX/PPTX parsing pipeline exists but is disconnected from the upload flow.

**[R2.6] ℹ️ `parser-worker.js` uses CommonJS `require()` in an ESM project.**
The worker file uses `require('fs')`, `require('pdf-parse')`, etc. While this works for a forked child process, it's inconsistent with the ESM module system used everywhere else. This is a minor style concern.

**[R2.7] ℹ️ Temp file cleanup race in `parseInWorker`.**
The `exit` event handler (lines 68–74) can fire after the `message` handler has already resolved the promise and called `worker.kill()`. The `reject` in the `exit` handler would be a no-op (promise already settled), but the `fs.existsSync` + `fs.unlinkSync` in both handlers could race. This is benign but untidy.

---

## Round 3 — Integration & Completeness Review

### Missing Integration

**[R3.1] ❌ No tests for document upload or parsing.**
There are zero test files covering:

- File upload endpoint (`POST /documents`)
- Document type detection (`detectDocType`)
- Text extraction (`extractText`, `parseInWorker`)
- Magic byte validation
- Quota enforcement
- Content hash computation
- The `parser-worker.js` child process

The test directory contains only `mcp-list-projects.test.ts` and `generate.test.ts`.

**[R3.2] ⚠️ Upload flow is not end-to-end functional.**
Due to the `memoryStorage()` vs. disk-read mismatch ([R2.1]), the `POST /documents` endpoint will crash at runtime. The feature is not usable in its current state.

**[R3.3] ⚠️ Document content extraction is disconnected.**
Even if the upload bug is fixed, the route stores raw file bytes as content instead of calling `extractText()` for binary formats. The knowledge graph cannot meaningfully index PDF/DOCX content without text extraction.

**[R3.4] ✅ Build artifact parsing works inline.**
`build-artifact-parser.ts` correctly handles `.map`, `.fv`, `.fd`, and `.log` files with structured parsing. This is called synchronously (not forked), which is acceptable since build artifacts are text-based and parsing is lightweight.

**[R3.5] ✅ Misc pool and affiliation flow is implemented.**
The `GET /documents/misc` and `POST /documents/:id/affiliate` endpoints are implemented and functional (assuming auth middleware is added).

---

## Summary of Findings

| ID   | Severity    | Finding                                                |
| ---- | ----------- | ------------------------------------------------------ |
| R2.1 | ❌ Critical | `multer.memoryStorage()` + disk reads = runtime crash  |
| R2.2 | ⚠️ High     | Binary content stored as text for PDF/DOCX/PPTX        |
| R3.2 | ⚠️ High     | Upload endpoint non-functional due to R2.1             |
| R3.3 | ⚠️ High     | `extractText()` never called; parsed text never stored |
| R1.6 | ⚠️ Medium   | POST `/documents` missing from OpenAPI spec            |
| R2.3 | ⚠️ Medium   | Hardcoded fallback `uploadedBy = 1`                    |
| R3.1 | ⚠️ Medium   | No tests for document upload/parsing                   |
| R2.4 | ℹ️ Low      | TOCTOU race in quota check                             |
| R2.5 | ℹ️ Low      | `extractText()` exported but unused                    |
| R2.6 | ℹ️ Low      | CJS `require()` in ESM project (worker only)           |
| R2.7 | ℹ️ Low      | Temp file cleanup race in worker lifecycle             |

---

## Recommendations

1. **Fix the storage mismatch (R2.1):** Either switch `upload.ts` to `multer.diskStorage({ dest: os.tmpdir() })` or refactor `documents.ts` to use `req.file.buffer` directly. The buffer approach is simpler and avoids disk I/O.

2. **Call `extractText()` in the upload route (R2.2, R3.3):** After reading the file buffer, call `extractText(buffer, docType, filename)` and store the returned plain text in the `content` column instead of raw bytes.

3. **Add POST `/documents` to OpenAPI spec (R1.6):** Define the endpoint in `openapi.yaml` and run Orval codegen.

4. **Add tests (R3.1):** Write integration tests for the upload endpoint covering: successful upload, magic byte rejection, file type rejection, quota enforcement, and content extraction.

5. **Fix `uploadedBy` fallback (R2.3):** Either reject unauthenticated requests or set `uploadedBy` to `null` until auth middleware is implemented.

---

## Verdict: ⚠️ WARN

The document parsing isolation architecture is well-designed and correctly implemented in `document-parser.ts` and `parser-worker.js`. However, the upload route (`documents.ts`) has a critical bug (`memoryStorage()` with disk reads) that makes the endpoint non-functional, and the text extraction pipeline (`extractText()`) is never invoked during upload. The feature is partially implemented but not usable end-to-end.

---

### Item 1.2.4 — ️ Build artifact parser

- **Status:** `WARN`
- **Report File:** [0213_1.2.4.md](./reports/0213_1.2.4.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                                                     |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 High   | Dedicated endpoint (`POST /projects/:id/ingest/build-artifact`) is non-functional — crashes because `req.file.path` is undefined with `memoryStorage()`     |
| 2   | 🔴 High   | Dedicated endpoint bypasses `extractBuildArtifactText()`, storing raw content instead of structured Markdown                                                |
| 3   | 🟡 Medium | Redundant `.log` handling workaround in `ingest.ts:228-229` instead of fixing `detectDocType()` at the source (though `detectDocType()` already handles it) |
| 4   | 🟡 Medium | Dedicated endpoint doesn't verify project existence (returns generic 500 instead of 404)                                                                    |
| 5   | 🟡 Medium | No unit tests for any of the 4 parser functions or `detectSubtype()`                                                                                        |
| 6   | 🟢 Low    | EDK2 map format not implemented (only GCC + MSVC)                                                                                                           |
| 7   | 🟢 Low    | No input validation (empty string content) in parser functions                                                                                              |
| 8   | 🟢 Low    | OpenAPI spec not updated for the dedicated endpoint                                                                                                         |

## Recommendations

1. **Fix the dedicated endpoint** — Change `ingest.ts:369-370` to use `req.file.buffer` instead of `req.file.path`, and route content through `extractBuildArtifactText()`.
2. **Remove redundant `.log` workaround** — Remove lines 228-229 in `ingest.ts` since `detectDocType()` already handles `.log`.
3. **Add unit tests** — Create `build-artifact-parser.unit.test.ts` covering all 4 subtypes with sample data.
4. **Add project existence check** — The dedicated endpoint should verify the project exists (return 404) before processing.
5. **Implement EDK2 map format** — Add the GUID table parser described in the implementation plan.

## Overall Verdict

**⚠️ WARN** — The main integration path (document upload → `extractText()` → `build-artifact-parser` → structured Markdown) is correctly implemented and well-structured. However, the dedicated build-artifact endpoint is non-functional due to the `memoryStorage()` mismatch and bypasses structured parsing entirely. Additionally, there are zero tests for the parser, and minor gaps exist in format coverage and input validation.

---

### Item 1.2.5 — ️ scoreCommit() signal/noise filter

- **Status:** `WARN`
- **Report File:** [0214_1.2.5.md](./reports/0214_1.2.5.md)

**Report Findings:**

## Findings Summary

### 🔴 Critical Issues

None.

### 🟡 Medium Issues

| #   | Severity  | Issue                                                                                                                                                                             | Location                               |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | 🟡 Medium | `github_webhooks.ts` `ingestPrCommits()` computes `scoreCommit()` result but ignores it — `valid: true` hardcoded. Noise PR commits (merge, dependabot, ci) enter the pipeline.   | `github_webhooks.ts:57-64`             |
| 2   | 🟡 Medium | Noise commits are stored with `valid: false` instead of being skipped. Wastes DB space, triggers misleading notifications. Design says "commits below the threshold are skipped." | `ingestion-pipeline.ts:89-97, 135-147` |
| 3   | 🟡 Low    | No unit tests for `scoreCommit()` despite complex pattern matching and scoring arithmetic.                                                                                        | No test files found                    |

### 🟢 Low / Informational

| #   | Severity | Finding                                                                                                                    |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🟢 Info  | Noise pattern list could be extended to cover `style:`, `docs:`, `test:`, `[automated]`, and `github-actions[bot]` commits |
| 2   | 🟢 Info  | `score` variable in `github_webhooks.ts:57` is dead code — should trigger dead-code linting warnings                       |

---

## Recommendations

1. **Fix `github_webhooks.ts` `ingestPrCommits()`** to respect the `scoreCommit()` result:

   ```typescript
   const { valid } = scoreCommit(c.commit.message);
   // ... then use: valid: valid  (instead of valid: true)
   ```

2. **Skip noise commits in `ingestion-pipeline.ts`** to match the design spec ("commits below the threshold are skipped"):

   ```typescript
   const { valid, score } = scoreCommit(c.message, c.diff);
   if (!valid) {
     skipped++;
     continue;
   }
   ```

3. **Add unit tests for `scoreCommit()`** covering all noise patterns, signal patterns, edge cases, boundary scores, and diff bonus logic.

4. **Consider extending noise patterns** for additional common noise prefixes (`style:`, `docs:`, `test:`, `[automated]`).

---

## Overall Verdict

**⚠️ WARN**

The `scoreCommit()` function itself is well-implemented — it correctly identifies noise vs. signal using regex patterns and a scoring algorithm. The architectural duplication issue from the original design debt has been resolved. However, there are two medium-severity issues that prevent the feature from fully meeting the design specification: (1) the GitHub webhook path ignores the scoring result entirely, allowing all PR commits through regardless of content, and (2) noise commits are stored with `valid: false` rather than being skipped as the design specifies. The generate pipeline's `valid: true` filter partially mitigates the impact for Git/SVN paths, but the webhook path issue means noisy PR commits will be processed by the LLM pipeline.

---

### Item 1.2.6 — ️ Incremental ingestion batching via cursor columns

- **Status:** `WARN`
- **Report File:** [0215_1.2.6.md](./reports/0215_1.2.6.md)

**Report Findings:**

## Findings Summary

| #   | Severity | Finding                                                                                     |
| --- | -------- | ------------------------------------------------------------------------------------------- |
| 1   | Medium   | Dual cursor update: `processIngestion()` and route handler both update `lastGitIngestedAt`  |
| 2   | Medium   | Incremental generate uses `desc` ordering instead of `asc` as specified in design           |
| 3   | Low      | `processIngestion` cursor uses `new Date()` instead of actual commit timestamp              |
| 4   | Low      | OpenAPI `IngestStatusResponse.projectId` typed as `string` instead of `integer`             |
| 5   | Low      | Generate response missing `mode` and `unprocessedRemaining` fields                          |
| 6   | Low      | No dedicated integration tests for incremental ingestion flows                              |
| 7   | Info     | `processIngestion` fetches all existing hashes per batch — could be slow for large projects |

---

## Overall Verdict

**⚠️ WARN**

The incremental ingestion feature is substantially implemented and functional end-to-end. All major components (DB schema, Git/SVN routes, generate pipeline, status endpoint, OpenAPI spec, frontend UI) are in place. However, there are two medium-severity issues — the dual cursor update and the incorrect sort ordering in incremental generate — that could lead to subtle bugs in production. The remaining issues are low-severity and can be addressed in a follow-up cleanup pass.

---

### Item 1.3.1 — ️ 4-way LLM-based intent classification (w/ Regex pre-filter)

- **Status:** `WARN`
- **Report File:** [0216_1.3.1.md](./reports/0216_1.3.1.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                                      |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🟡 Medium | `directLookupHandler` checks `validityStatus !== 'active'` but schema uses `'valid'`/`'pending'`/`'orphaned'` — filter is effectively broken |
| 2   | 🟡 Medium | N+1 project lookup queries in vector search handler                                                                                          |
| 3   | 🟡 Medium | No authentication on `POST /search` REST endpoint                                                                                            |
| 4   | 🟡 Low    | `escapeLike` is dead code (duplicate of `sanitizeLikeInput`)                                                                                 |
| 5   | 🟡 Low    | `isSingleWord` fast-path bypasses `#attach`/file-ext pre-filter                                                                              |
| 6   | 🟡 Low    | Graph traversal only follows out-links, not in-links                                                                                         |
| 7   | 🟡 Low    | `search.ts` catch block has no error logging                                                                                                 |
| 8   | 🟡 Low    | `search.ts` missing `includePending` parameter support                                                                                       |
| 9   | 🟢 Info   | Hybrid search uses flat boost instead of compounding boost per ADR-007                                                                       |
| 10  | 🟢 Info   | Graph fast-path fetches all L1/L2 names (O(N) not O(1))                                                                                      |
| 11  | 🔴 High   | Zero tests for intent router — no unit tests, no integration tests, no fast-path assertions per ADR-007                                      |

---

## Recommendations

1. **Fix validityStatus filter (Issue 1)**: Change `'active'` to `'valid'` in `directLookupHandler` at lines 500 and 535. This is a functional bug that causes orphaned nodes to be returned in search results.

2. **Add tests (Issue 11)**: This is the most critical gap. Create:
   - `intent-router.unit.test.ts`: Unit tests for `calculateTemporalDecay`, `sanitizeQuery`, `sanitizeLikeInput`, `classifyIntent` (mocked), `cosineSimilarity`
   - `search.integration.test.ts`: Integration tests with MSW for the fast-path assertion (0 LLM calls) and fallback assertion (1 LLM call) as required by ADR-007

3. **Add auth to REST search endpoint (Issue 3)**: Either add auth middleware or document that this endpoint is intentionally unauthenticated.

4. **Batch project lookups (Issue 2)**: Replace N+1 queries with a single `WHERE id IN (...)` query or a join.

5. **Remove dead code (Issue 4)**: Remove the unused `escapeLike` function.

6. **Fix pre-filter ordering (Issue 5)**: Move the `#attach`/file-ext check before the `isSingleWord` check, or integrate both checks.

7. **Add in-link traversal (Issue 6)**: Extend `graphTraversalHandler` to also follow in-links for complete dependency analysis.

---

## Overall Verdict

**⚠️ WARN**

The 4-way intent classification system is substantially implemented and architecturally sound. All four search strategies (vector, graph, direct, hybrid) are implemented, the O(1) fast-path arbitration pipeline is present, temporal decay is correctly applied, and both REST and MCP endpoints are wired up. The code is well-structured with good type definitions, input sanitization, and graceful fallbacks.

However, there is one functional bug (the `validityStatus !== 'active'` check that never matches), and the most significant gap is the complete absence of tests — the ADR-007 explicitly requires fast-path and fallback assertions that are not implemented. The N+1 query issue and missing auth on the REST search endpoint are additional concerns that should be addressed.

---

### Item 1.3.2 — ️ WARN Vector search: cosine similarity over JSONB embeddings

- **Status:** `WARN`
- **Report File:** [0217_1.3.2.md](./reports/0217_1.3.2.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                       |
| --- | --------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | 🟡 Medium | Schema uses `text("embedding")` instead of `jsonb("embedding")` as specified in design                        |
| 2   | 🟡 Medium | `vector-search.ts` is dead code — never called, incompatible with schema, has `validityStatus = 'active'` bug |
| 3   | 🟡 Medium | In-app cosine similarity computation doesn't scale — fetches ALL rows and computes in JS                      |
| 4   | 🟡 Medium | No integration tests for vector search (no fast-path or fallback assertions per ADR-007)                      |
| 5   | 🟡 Low    | Duplicate `calculateTemporalDecay` implementations with different decay rates                                 |
| 6   | 🟡 Low    | `parseEmbedding` called on every comparison without caching                                                   |
| 7   | 🟡 Low    | `generateEmbedding` silently truncates input to 8192 chars                                                    |
| 8   | 🟢 Info   | `vector-search.ts` constructs raw SQL vector string (potential risk if input source changes)                  |
| 9   | 🟢 Info   | N+1 project lookup queries in vector search handler                                                           |

---

## Recommendations

1. **Fix schema to use `jsonb` (Issue 1)**: Change `text("embedding")` to `jsonb("embedding")` in both `l3_nodes.ts` and `l2_nodes.ts` to match the design spec. This enables JSONB indexing and querying capabilities.

2. **Decide on vector search strategy (Issues 2, 3)**: Choose one approach:
   - **Option A**: Remove `vector-search.ts` and optimize the in-app approach (add pre-filtering, caching, batch project lookups)
   - **Option B**: Fix and integrate `vector-search.ts` — requires adding pgvector extension, changing column type to `vector`, fixing the validityStatus bug, and aligning decay rates

3. **Add integration tests (Issue 4)**: Create integration tests that:
   - Seed the database with factories containing embeddings
   - Test vector search with known similarity expectations
   - Test the fast-path assertion (0 LLM calls for exact matches)
   - Test the fallback assertion (1 LLM call for below-threshold queries)

4. **Consolidate decay functions (Issue 5)**: Remove the duplicate `decay.ts` or make it the canonical implementation used everywhere.

5. **Cache parsed embeddings (Issue 6)**: Pre-parse embeddings once before the scoring loop instead of parsing on every comparison.

6. **Add truncation warning (Issue 7)**: Log a debug message when `generateEmbedding` truncates input.

---

## Overall Verdict

**⚠️ WARN**

The vector search feature is functionally implemented and works correctly for small datasets. The core math (cosine similarity, temporal decay) is well-tested with unit tests, the embedding generation pipeline is complete, and the graceful fallback to LIKE search is a good resilience pattern.

However, there are significant gaps:

- The schema uses `text` instead of `jsonb` as specified in the design
- There are two conflicting vector search implementations (one active but unscalable, one potentially scalable but dead code with bugs)
- The in-app cosine similarity computation will not scale to the stated 100K node capacity
- Integration tests for vector search are completely absent, including the ADR-007 required fast-path and fallback assertions

---

### Item 1.3.3 — ️ WARN Graph search: node_links traversal

- **Status:** `WARN`
- **Report File:** [0218_1.3.3.md](./reports/0218_1.3.3.md)

**Report Findings:**

## Findings Summary

### Issues

| #   | Severity | Finding                                                                                                                   |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | No `validityStatus` filter on L3 nodes in `graphTraversalHandler` — may expose orphaned/pending nodes                     |
| 2   | Medium   | No database indexes on `node_links.sourceNodeId` and `node_links.targetNodeId` — performance will degrade with graph size |
| 3   | Medium   | No unit or integration tests for `graphTraversalHandler` — core routing logic is untested                                 |
| 4   | Low      | "Neighbor Infection" (multi-hop traversal) described in ADR-007 is not implemented — only 1-hop out-links                 |
| 5   | Low      | No link type filtering in graph traversal — all `linkType` values are treated equally                                     |
| 6   | Low      | No inbound link traversal in `graphTraversalHandler` — only out-links are followed                                        |
| 7   | Low      | O(1) fast-path is actually O(n) — queries all L1/L2 names on every request with no caching                                |
| 8   | Low      | Code duplication between `graphTraversalHandler` and MCP endpoints (`get_dependencies`, `impact_analysis`)                |
| 9   | Low      | No temporal decay applied to graph traversal results — static scores may misrepresent stale knowledge                     |
| 10  | Info     | No input validation on `moduleName` parameter — empty string would match all L2 nodes                                     |

### Recommendations

1. **Add `validityStatus` filter** to the L3 query in `graphTraversalHandler` (consistent with `vectorSearchHandler`).
2. **Add database indexes** on `node_linksTable.sourceNodeId` and `node_linksTable.targetNodeId`.
3. **Write unit tests** for `graphTraversalHandler` covering: seed node found/not found, with/without out-links, with/without L3 nodes, project-scoped queries.
4. **Consider implementing multi-hop traversal** with a configurable depth limit to fulfill the "Neighbor Infection" design.
5. **Extract shared graph logic** between `graphTraversalHandler` and MCP endpoints into a reusable function.
6. **Add temporal decay** to graph traversal scores for consistency with other search strategies.

---

## Overall Verdict

**⚠️ WARN** — The graph traversal feature is implemented and functional for the basic 1-hop case, and integrates correctly with the intent router and MCP. However, it lacks test coverage, doesn't filter L3 nodes by validity status, doesn't implement the multi-hop "Neighbor Infection" described in the design, and has no database indexes for the `node_links` table. The feature works for direct dependency lookups but is incomplete for broader graph analysis.

---

### Item 1.3.4 — ️ WARN Direct search: full-text search on l3_nodes.content

- **Status:** `WARN`
- **Report File:** [0220_1.3.4.md](./reports/0220_1.3.4.md)

**Report Findings:**

## Findings Summary

| #   | Severity    | Finding                                                                                                                                          |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 🔴 Critical | `validityStatus !== 'active'` bug on lines 500 and 535 — direct search always returns empty results because schema uses `'valid'` not `'active'` |
| 2   | 🟡 Medium   | No unit tests for `directLookupHandler` — the critical bug would have been caught by basic tests                                                 |
| 3   | 🟡 Medium   | No integration tests for direct search — ADR-007 fast-path assertion not implemented                                                             |
| 4   | 🟡 Low      | ILIKE used instead of true PostgreSQL FTS (`to_tsvector`/`to_tsquery`)                                                                           |
| 5   | 🟡 Low      | N+1 project lookup queries in commit hash path                                                                                                   |
| 6   | 🟡 Low      | `projectName` always null in direct search results                                                                                               |
| 7   | 🟢 Info     | No index on `introducedInCommit` column for hash lookups                                                                                         |

---

## Recommendations

1. **Fix the `validityStatus` bug immediately (Issue 1)**: Change `'active'` to `'valid'` on both lines 500 and 535 of `intent-router.ts`. This is a one-character fix that restores the direct search feature to working order.

2. **Add unit tests for `directLookupHandler` (Issue 2)**: Create tests covering:
   - Commit hash lookup with valid/invalid hashes
   - Content/title ILIKE search
   - `includePending = false` filtering (should only return `valid` nodes)
   - `includePending = true` filtering (should return `valid` + `pending` nodes)
   - Empty result handling

3. **Add integration tests (Issue 3)**: Create integration tests that:
   - Seed the database with factories containing L3 nodes with known content
   - Trigger exact-match queries and assert 0 LLM calls (fast-path assertion per ADR-007)
   - Verify the direct search returns expected results

4. **Decide on FTS strategy (Issue 4)**: Either:
   - Update the design spec to reflect ILIKE-based search (simpler)
   - Implement true FTS with `to_tsvector`/`to_tsquery` and a GIN index (more powerful)

5. **Batch project lookups (Issue 5)**: Use a JOIN or batch query instead of N+1 lookups in the commit hash path.

6. **Resolve project names (Issue 6)**: Either use a JOIN (like vector search) or a separate query to populate `projectName` in direct search results.

---

## Overall Verdict

**⚠️ WARN**

The direct search feature is architecturally well-designed with clean separation of concerns, proper input sanitization, and correct integration into the intent routing pipeline. The commit hash lookup and content search paths are logically sound, and the single-word fast-path optimization is a good token-saving measure.

However, there is a **critical data-loss bug** that makes the feature non-functional in production: the `validityStatus` filter checks for `'active'` instead of `'valid'`, causing the direct search to always return empty results when `includePending = false` (the default). This bug exists in both the commit hash path (line 500) and the content search path (line 535).

Additionally, there are no unit or integration tests for the direct search handler, which means this bug went undetected. The ADR-007 required fast-path integration test (asserting 0 LLM calls) is also missing.

The use of ILIKE instead of true PostgreSQL FTS is a known and acknowledged limitation that is acceptable for v1 but should be addressed in a future iteration.

---

### Item 1.3.5 — ️ WARN Hybrid search: vector + graph merge and re-rank

- **Status:** `WARN`
- **Report File:** [0228_1.3.5.md](./reports/0228_1.3.5.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                                       |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ⚠️ Medium | No dedicated tests for hybrid search (unit or integration). ADR-007 mandates integration tests with MSW assertions.                           |
| 2   | ⚠️ Medium | No temporal decay applied to graph traversal results in the hybrid merge. Graph-only results use fixed scores regardless of `lastVerifiedAt`. |
| 3   | ⚠️ Low    | `hybridSearch` is not exported, limiting direct testability.                                                                                  |
| 4   | ⚠️ Low    | Score ranges are not normalized between vector ([0,1]) and graph ([0.8, 1.0]) results, making the merged score difficult to interpret.        |
| 5   | ℹ️ Info   | Top-3 L2 seed heuristic for graph traversal is not documented in the design spec but is a reasonable implementation choice.                   |
| 6   | ℹ️ Info   | Performance: up to ~15 DB queries per hybrid search in the worst case. Acceptable for current scale.                                          |

## Recommendations

1. **Add integration tests** for the hybrid search path that verify: (a) the merge produces results from both vector and graph sources, (b) intersection nodes receive a scoring boost, (c) temporal decay is applied consistently.
2. **Apply temporal decay** to graph traversal results before merging, or at minimum document the intentional asymmetry.
3. **Consider normalizing scores** to [0, 1] in the final merged output so API consumers can interpret confidence.
4. **Document the top-3 heuristic** in ADR-007 or as a code comment, explaining why 3 was chosen and what happens when fewer than 3 L2 nodes are returned.

---

## Overall Verdict

**⚠️ WARN**

The hybrid search implementation is functionally correct and matches the design spec's core requirement (vector + graph merge with scoring boost). The code is clean and well-integrated into the routing pipeline. However, the absence of any tests for the hybrid path (despite ADR-007 mandating them), the missing temporal decay on graph results, and the unnormalized score ranges warrant a WARN verdict. The feature works but needs test coverage and minor consistency fixes.

---

### Item 1.4.1 — ️ WARN Asynchronous metabolism mechanism (ADR-008)

- **Status:** `WARN`
- **Report File:** [0219_1.4.1.md](./reports/0219_1.4.1.md)

**Report Findings:**

## Findings

### Issues

1. **[ARCH-1] In-memory mutex instead of distributed Postgres lock** — The ADR-008 explicitly requires `FOR UPDATE SKIP LOCKED` with `locked_at` for multi-instance safety. The current `let isMetabolismRunning = false` boolean only works for a single process. This is a design-deviation that will cause race conditions if the API server is ever scaled horizontally.

2. **[ARCH-2] `job_queue` table is dead code** — The schema exists with all required columns but is never used. The metabolism worker directly queries domain tables (`correction_examples`, `l3_nodes`) instead of pulling from a job queue. The ADR's state machine (PENDING → ACTIVE → COMPLETED/FAILED → DLQ) is not implemented.

3. **[ARCH-3] No dead letter queue** — Tasks that fail during distillation are not retried or moved to a DLQ. The ADR mandates 3 retries before DLQ transition. Currently, failed LLM calls are logged but the correction may still be marked as processed.

4. **[BUG-1] Corrections silently marked as processed** — If the LLM returns a falsy guardrail (empty/null), the correction is still added to `processedIds` and marked as processed, with no distillation output created. This data loss means the correction is wasted.

5. **[BUG-2] No limit on merge gate query** — The query for pending L3 nodes has no `.limit()`, risking memory pressure with large backlogs.

6. **[SEC-1] Client tick endpoint unauthenticated** — `GET /api/metabolism-tick` has no authentication, allowing any caller to trigger expensive LLM operations.

7. **[TEST-1] Zero test coverage** — No tests exist for the metabolism feature. The ADR's mandatory DLQ routing proof and mutex lock proof are both missing.

8. **[SPEC-1] Missing OpenAPI definitions** — The metabolism endpoints are not in `openapi.yaml`, violating the project's API-first convention.

### Recommendations

1. **Replace the in-memory mutex** with Postgres `FOR UPDATE SKIP LOCKED` on the `job_queue` table, as the ADR specifies. This enables multi-instance deployments and provides the zombie-reaper recovery via `locked_at`.

2. **Implement the job queue state machine** — Use `job_queue` table for the metabolism worker. Insert jobs when corrections are created or L3 nodes need merge-gate checking. The worker should pull from `job_queue` with proper locking.

3. **Add DLQ support** — Add a `retryCount` column to `job_queue` (or use the existing schema with a retry counter). After 3 failures, transition to a `dead_letter` status.

4. **Fix the distillation guardrail falsy-value bug** — Only add `correction.id` to `processedIds` if a non-empty guardrail was actually produced and inserted.

5. **Add `.limit()` to the merge gate query** — Process at most N nodes per tick (e.g., 50) to bound execution time.

6. **Add authentication to the client tick endpoint** — At minimum, require the same `x-docuvia-token` used for other API endpoints.

7. **Write the ADR-mandated tests** — DLQ routing proof and mutex lock proof as specified in ADR-008.

8. **Add metabolism endpoints to `openapi.yaml`** and run Orval codegen.

---

## Overall Verdict

⚠️ WARN — The core metabolism mechanism is implemented and functional: the client heartbeat tick, admin cron tick, merge gate fallback, and distillation job all exist and work. The generate pipeline has proper optimistic locking. However, there are significant architectural deviations from ADR-008 (in-memory mutex instead of distributed Postgres lock, dead-code job queue table, no DLQ, no zombie-reaper), one data-loss bug in the distillation logic, no test coverage, and missing OpenAPI definitions. The feature is operational for single-instance deployments but not ready for production multi-instance scaling.

---

### Item 2.2.2 — ️ Package.json ecosystem marker parsing (WIP — needs completion)

- **Status:** `WARN`
- **Report File:** [0229_2.2.2.md](./reports/0229_2.2.2.md)

**Report Findings:**

## Findings Summary

| #   | Finding                                                                                       | Severity | Category                       |
| --- | --------------------------------------------------------------------------------------------- | -------- | ------------------------------ |
| 1   | `ManifestSchema` missing `ecosystems` field — data written but never read                     | Medium   | Design/Implementation Mismatch |
| 2   | Skeleton YAML files (l1_tags.yaml, l2_modules.yaml, l3_router.yaml) not generated during init | High     | Missing Implementation         |
| 3   | `.gitignore` not read during init (incomplete ADR-001 implementation)                         | Low      | Design Gap                     |
| 4   | Path traversal check logic is incorrect (comma-joined paths)                                  | Medium   | Bug                            |
| 5   | Inline `require()` calls inconsistent with ES module imports                                  | Low      | Code Style                     |
| 6   | Mixed filesystem APIs (`fs/promises` vs `vscode.workspace.fs`)                                | Low      | Code Style                     |
| 7   | Hardcoded `config.yaml` values never consumed at runtime                                      | Low      | Dead Code                      |
| 8   | Snapshot initialization commented out                                                         | Medium   | Incomplete Feature             |
| 9   | Ecosystem data has no UI consumer                                                             | Medium   | Integration Gap                |
| 10  | No tests for `detectEcosystem` or `initProject`                                               | Medium   | Testing Gap                    |

---

## Recommendations

1. **Add `.gitignore` filtering** to `detectEcosystem` to match ADR-001.
2. **Generate skeleton YAML files** (`l1_tags.yaml`, `l2_modules.yaml`, `l3_router.yaml`) during `initProject` using `writeIfAbsent`.
3. **Add `ecosystems` field** to `ManifestSchema` and display ecosystem info in the tree view or dashboard.
4. **Fix path traversal check** to validate against each workspace folder individually.
5. **Unify filesystem API usage** — prefer `vscode.workspace.fs` throughout.
6. **Add unit tests** for `detectEcosystem` covering all marker file combinations.
7. **Either implement or remove** `config.yaml` — dead configuration is confusing.

---

## Overall Verdict

**⚠️ WARN**

The ecosystem marker detection (`detectEcosystem`) is implemented and functional for the core use case — checking for the existence of 7 ecosystem marker files across 5 programming languages. However, the ecosystem data is silently lost during manifest parsing because the `ManifestSchema` doesn't include the field. More critically, the `initProject` flow does not generate the required skeleton YAML files (`l1_tags.yaml`, `l2_modules.yaml`, `l3_router.yaml`), leaving the Knowledge Graph empty after initialization. The path traversal check has a logic bug (comma-joined paths), and there are no tests for this feature. The item is partially implemented but has significant gaps.

---

### Item 2.2.3 — ️ WARN .docuvia/ directory creation with manifest.yaml, config.yaml, .snapshot-ref

- **Status:** `WARN`
- **Report File:** [0230_2.2.3.md](./reports/0230_2.2.3.md)

**Report Findings:**

## Findings Summary

| #   | Severity | Finding                                                                                                                                                                             |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | `manifest.yaml` fields (`name`, `version`, `ecosystems`) don't match `ManifestSchema` (`project_id`, `modules`). The manifest won't populate `manifestModules` needed for CodeLens. |
| 2   | Medium   | `config.yaml` fields (`similarity_threshold`, `chunk_size`) don't match `GlobalConfigSchema` (`server_url`, `chunking_strategy`). No code reads project-level `config.yaml`.        |
| 3   | Medium   | Test (`phase1.test.ts`) doesn't assert the three files this item is about (`manifest.yaml`, `config.yaml`, `.snapshot-ref`).                                                        |
| 4   | Medium   | `acceptL1Tags` creates `.docuvia/` without `manifest.yaml`/`config.yaml`/`.snapshot-ref`, creating an inconsistent state if explore is run before init.                             |
| 5   | Low      | Dynamic `require()` usage in `initProject()` inconsistent with ESM imports.                                                                                                         |
| 5   | Low      | Weak path traversal check using comma-joined workspace paths.                                                                                                                       |
| 6   | Low      | Overwrite flow doesn't clean stale files from `.docuvia/`.                                                                                                                          |
| 7   | Low      | `.snapshot-ref` is never read by code — it's developer-facing only.                                                                                                                 |
| 8   | Info     | `initProject` doesn't write `l1_tags.yaml` — by design, it's created via the `/explore` → `acceptL1Tags` flow. After init, tree shows placeholder "No L1 tags found".               |

---

## Overall Verdict

## ⚠️ WARN

The three required files (`manifest.yaml`, `config.yaml`, `.snapshot-ref`) are created by `initProject()` and the directory scaffolding works end-to-end. However, there are significant schema mismatches: the fields written to `manifest.yaml` and `config.yaml` don't align with the TypeScript `Zod` schemas defined in `types.ts`, and no code consumes the project-level `config.yaml`. The test coverage doesn't verify the specific deliverables of this item. The core functionality works, but the data contracts are inconsistent.

---

### Item 3.1.1 — ️ WARN correction_examples summary logic

- **Status:** `WARN`
- **Report File:** [0231_3.1.1.md](./reports/0231_3.1.1.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                      |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 High   | L1 tag corrections are not stored in `correction_examples` — feedback loop broken for L1                                     |
| 2   | 🔴 High   | L3 corrections are never injected as few-shot examples — `getRecentCorrections()` only called for `l2_node`                  |
| 3   | 🟡 Medium | `CorrectionExampleFactory` is imported but not defined in `factories.ts` — blocks test coverage                              |
| 4   | 🟡 Medium | L3 correction examples may have `null` projectId when L2 lookup fails, making them invisible to `getRecentCorrections()`     |
| 5   | 🟡 Medium | Distillation job processes corrections individually rather than in batches — doesn't match design spec for pattern detection |
| 6   | 🟢 Low    | No error handling around `correction_examples` insertion in `review_tasks.ts`                                                |
| 7   | 🟢 Low    | Hardcoded `gpt-4o-mini` model in distillation job ignores project LLM config                                                 |
| 8   | 🟢 Low    | No database index on `(projectId, entityType, createdAt)` for `correction_examples`                                          |

---

## Recommendations

1. **Fix L1 tag correction capture**: Add `correction_examples` insertion in `review_tasks.ts:173-180` for L1 tags (similar to the L2/L3 paths).
2. **Use L3 corrections for few-shot**: Call `getRecentCorrections(projectId, "l3_node")` in the L3 generation path and pass them to the LLM prompt.
3. **Define `CorrectionExampleFactory`**: Add the missing factory in `factories.ts` to enable test coverage.
4. **Add error handling**: Wrap `correction_examples` insertion in try/catch to prevent insertion failures from crashing the review resolution.
5. **Batch distillation**: Process corrections in a single LLM call to detect patterns across corrections, as the design spec intends.
6. **Add database index**: Add an index on `correction_examples(projectId, entityType, createdAt)` for query performance.

---

## Overall Verdict

**⚠️ WARN**

The core correction_examples summary logic is implemented and functional for the L2 node path. The review → capture → distillation → prompt template pipeline works end-to-end for L2 corrections. However, there are significant gaps: L1 tag corrections are not captured at all, L3 corrections are stored but never used for few-shot, the `CorrectionExampleFactory` is missing (blocking tests), and the distillation job doesn't batch corrections for pattern detection as the design specifies. The feature is partially implemented with actionable gaps to address.

---

### Item 3.1.2 — ️ WARN Few-shot injection into generate pipeline

- **Status:** `WARN`
- **Report File:** [0232_3.1.2.md](./reports/0232_3.1.2.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                      |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 High   | L3 corrections are never injected as few-shot examples — `getRecentCorrections()` only called for `l2_node`                  |
| 2   | 🔴 High   | Few-shot injection is completely skipped in path-rule mode (mature projects)                                                 |
| 3   | 🟡 Medium | No test coverage for few-shot injection (no tests for `getRecentCorrections()`, `buildFewShotSection()`, or end-to-end flow) |
| 4   | 🟡 Medium | No content length truncation in `buildFewShotSection()` — long corrections could blow context window                         |
| 5   | 🟡 Medium | `CorrectionExampleFactory` not defined in `factories.ts` — blocks test authoring for correction-related flows                |
| 6   | 🟢 Low    | No database index on `(projectId, entityType, createdAt)` for `correction_examples`                                          |
| 7   | 🟢 Low    | O(1) fast-path pre-injection (ADR-006 Stage 4) not implemented — guardrails are only injected via full LLM calls             |

---

## Recommendations

1. **Inject L3 corrections as few-shot**: Call `getRecentCorrections(projectId, "l3_node")` and pass the result to the L3 generation path. Since L3 nodes are currently generated inside `generateL2Nodes()`, consider adding a separate L3 generation step that uses L3-specific few-shot examples.

2. **Activate few-shot in path-rule mode**: Even in path-rule mode, few-shot examples could be used for L3 generation or for validating/refining the deterministic assignments. Consider adding a few-shot section to the path-rule branch.

3. **Add content truncation**: Add a max length (e.g., 200 characters) to `c.original` and `c.corrected` in `buildFewShotSection()` to prevent context window overflow:

   ```typescript
   const truncate = (s: string, max = 200) => (s.length > max ? s.slice(0, max) + "..." : s);
   ```

4. **Add test coverage**: Create tests that:
   - Populate `correction_examples` records before triggering generate
   - Verify the few-shot section appears in the LLM prompt (via MSW request inspection)
   - Test `buildFewShotSection` with edge cases (empty, long content, special characters)

5. **Define `CorrectionExampleFactory`**: Add the missing factory in `factories.ts` to enable test authoring.

6. **Add database index**: Add an index on `correction_examples(projectId, entityType, createdAt)` for query performance.

---

## Overall Verdict

**⚠️ WARN**

The few-shot injection into the generate pipeline is implemented and functional for the L2 correction path in bootstrap mode. The `getRecentCorrections()` and `buildFewShotSection()` functions are well-structured and correctly integrated into the `generateL2Nodes()` flow. However, there are significant gaps: (1) L3 corrections are never injected as few-shot examples, (2) the entire few-shot mechanism is bypassed in path-rule mode (which is the steady-state for mature projects), and (3) there is zero test coverage for this feature. The feature is partially implemented and works for its narrow target scenario (L2 corrections during bootstrap), but the broader self-evolution feedback loop described in ADR-006 is incomplete.

---

### Item 3.2.2 — ️ WARN Decay application on knowledge query results

- **Status:** `WARN`
- **Report File:** [0234_3.2.2.md](./reports/0234_3.2.2.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                                                                                                                     |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ⚠️ Medium | Temporal decay is only applied in the vector+embedding path. Graph traversal, direct lookup, vector fallback, hybrid search graph portion, and the single-word fast-circuit all use fixed scores with no age-based ranking. |
| 2   | ⚠️ Medium | Hybrid search merge can produce counter-intuitive rankings — non-decayed graph results receive a +0.5 boost that can push them above decayed vector results.                                                                |
| 3   | ⚠️ Low    | The feedback loop (`POST /search/feedback`) refreshes `lastVerifiedAt`, but this has no effect on future rankings for graph/direct queries since those handlers don't read the field.                                       |
| 4   | ⚠️ Low    | No integration tests verify decay behavior in end-to-end query flows for any handler.                                                                                                                                       |
| 5   | ℹ️ Info   | No shared utility function for applying decay — the logic is duplicated (where present) rather than centralized.                                                                                                            |

## Recommendations

1. **Apply decay universally**: Add temporal decay to `graphTraversalHandler()` and `directLookupHandler()` by reading `lastVerifiedAt ?? createdAt` from each node and multiplying the fixed score by the decay factor. This fulfills the design spec's intent that "knowledge untouched naturally sinks to the bottom" across all query strategies.

2. **Fix the vector fallback path**: When `generateEmbedding()` returns null and the handler falls back to SQL LIKE, apply decay to the fixed scores (0.9, 0.8) based on each node's `lastVerifiedAt`.

3. **Fix hybrid search merge**: Either (a) apply decay to graph results before merging, or (b) normalize scores so decayed vector results and non-decayed graph results are comparable. The current +0.5 boost for intersection nodes is arbitrary and can produce misleading rankings.

4. **Add integration tests**: Seed the database with nodes having different `lastVerifiedAt` values and verify that query results from all handlers (vector, graph, direct, hybrid) are correctly ranked by decay.

5. **Consider a shared decay utility**: Create a function like `applyDecayToResults()` that all handlers call before returning, ensuring consistent behavior and reducing duplication.

---

## Overall Verdict

**⚠️ WARN**

The mathematical foundation of temporal decay (item 3.2.1) is correct and well-tested. However, the **application of decay to knowledge query results** (item 3.2.2) is incomplete. Decay is only applied in the vector search path when embeddings are available (1 of 6 query paths). The graph traversal handler, direct lookup handler, vector fallback path, hybrid search graph portion, and single-word fast-circuit all return results with fixed scores that ignore node age. This means the design spec's core promise — "knowledge untouched naturally sinks to the bottom" — is only fulfilled for a subset of queries. The feedback loop is correctly implemented but its impact is limited since most query paths don't consume `lastVerifiedAt`. The feature works as designed for the primary vector+embedding path but needs expansion to cover all query strategies.

---

### Item 3.3.1 — ️ WARN Regex pre-filters skipping LLM latency

- **Status:** `WARN`
- **Report File:** [0235_3.3.1.md](./reports/0235_3.3.1.md)

**Report Findings:**

## Findings

1. **✅ Design-implementation alignment:** The three-layer fast-path architecture matches the ADR-007 routing funnel design. The `#attach`/file extension check and L1/L2 name matching are correctly implemented.

2. **✅ Additional single-word fast-path:** The single-word short-circuit (Layer 1) is a reasonable optimization not explicitly in ADR-007 but consistent with the design philosophy of prioritizing cheap lookups.

3. **⚠️ O(1) claim is inaccurate for Layer 3:** The ADR-007 describes the L1/L2 check as O(1), but the implementation loads ALL L1 tags and ALL L2 nodes into memory and iterates through them. This is O(N) where N = number of tags + nodes. For large knowledge graphs, this could be significant. The design doc itself acknowledges this should be a fast cache check, but the implementation does a full table scan.

4. **⚠️ Single-word path bypasses `#attach`/extension filter:** A query like `auth.ts` (single word, >3 chars) would enter Layer 1 first. If no DB results are found, it falls through to Layer 2 where the `.ts` extension would match. This is acceptable behavior but means the single-word path adds a DB query overhead before the regex filter runs.

---

## Round 2 — Code Quality & Security Review

### Critical Bug: `validityStatus` Value Mismatch

**Severity: HIGH**

In `directLookupHandler()`, lines 500 and 535:

```typescript
if (!includePending && l3.validityStatus !== "active") continue;
```

The code checks for `'active'`, but the schema defines the validity status enum as `pending | valid | orphaned` (per item 4.3.3 in the checklist, which was verified as PASS). The correct value should be `'valid'`, not `'active'`.

**Impact:** This bug means that when `includePending` is false (the default), NO L3 nodes will ever be returned by the direct lookup handler, because `validityStatus` will never equal `'active'`. The fast-path filters that route to `direct_lookup` will appear to find no results, making the fast-path effectively broken for direct lookups.

### Code Quality Issues

1. **⚠️ No unit tests for fast-path routing logic:** The unit test file (`intent-router.unit.test.ts`) only tests `escapeLike`, `calculateTemporalDecay`, and `sanitizeQuery`. It does NOT test:
   - The single-word short-circuit logic
   - The `#attach`/file extension regex matching
   - The L1/L2 term matching
   - The overall `routeQuery()` orchestration

2. **⚠️ No integration tests for LLM bypass:** ADR-007 explicitly requires integration tests that use MSW to assert "0 external HTTP requests are made to the AI server" during fast-path hits. No such tests exist. The only integration test infrastructure found is the unit test file.

3. **⚠️ `routeQuery()` function exceeds recommended length:** The function is ~127 lines (lines 614-740). The coding rules in section 8.3.5 specify a maximum of 100 lines per function. This is a minor style concern.

4. **✅ Input sanitization is present:** The `sanitizeQuery()` function strips control characters and truncates to 2000 chars. The `escapeLike()` and `sanitizeLikeInput()` functions properly escape SQL LIKE wildcards.

5. **✅ Defensive design:** The `classifyIntent()` function has proper error handling with a fallback to `vector_search` on any failure.

6. **⚠️ Inconsistent `includePending` default in MCP route:** In `mcp.ts` line 218, the `includePending` is read from `req.query.include_pending` but the POST body is parsed separately. The `includePending` is not extracted from the Zod-validated body, only from the query string. This means POST requests with `includePending` in the body will be ignored.

---

## Round 3 — Integration & Completeness Review

### Integration Coverage

1. **✅ REST API integration:** The `POST /search` endpoint (`search.ts` line 22-32) correctly calls `routeQuery()` with the fast-path logic.

2. **✅ MCP integration:** Both `POST /mcp/query` (line 210-227) and `GET /mcp/search_knowledge` (line 67-83) correctly call `routeQuery()` with the fast-path logic.

3. **❌ No fast-path verification tests:** The ADR-007 "Verifiability" section explicitly requires:
   - **Fast-Path Assertion:** Integration tests that seed the DB, trigger an exact-match query, and assert 0 external HTTP requests via MSW.
   - **Fallback Assertion:** Queries below the similarity threshold must assert exactly 1 MSW-intercepted request.

   Neither assertion exists in the test suite. The only test file is `intent-router.unit.test.ts` which tests utility functions, not the routing logic.

### Completeness

1. **✅ Feature is implemented:** The regex pre-filters (`#attach`, file extensions, L1/L2 name matching) are all implemented in the code.

2. **⚠️ Performance concern with Layer 3:** The L1/L2 term matching loads all tags and nodes on every non-single-word query. For a knowledge graph with thousands of L2 nodes, this could add significant latency — partially defeating the purpose of the O(1) fast-path. A more efficient approach would be to use a database-side `ILIKE` query or maintain an in-memory trie/cache.

3. **⚠️ Missing `pg_trgm` usage:** The code comment on line 522 says "We would ideally use Postgres Full Text Search (to_tsvector/to_tsquery) but sticking to ILIKE for architectural continuity here." The ADR-007 mentions `pg_trgm` in the sequence diagram. The current implementation doesn't leverage PostgreSQL's trigram indexing, which would be more efficient for fuzzy matching.

---

## Findings Summary

| #   | Severity        | Finding                                                                                                                                                                                                     |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 **Critical** | `validityStatus` checked as `'active'` instead of `'active'` in `directLookupHandler` (lines 500, 535). This breaks the direct lookup path — no L3 nodes will ever be returned when `includePending=false`. |
| 2   | 🟡 **Medium**   | No integration tests verifying that fast-path queries skip LLM calls. ADR-007 explicitly requires MSW-based assertions.                                                                                     |
| 3   | 🟡 **Medium**   | L1/L2 term matching is O(N) not O(1) — loads all tags and nodes into memory on every query.                                                                                                                 |
| 4   | 🟡 **Medium**   | No unit tests for the `routeQuery()` orchestration or any of the three fast-path layers.                                                                                                                    |
| 5   | 🟢 **Low**      | `routeQuery()` function exceeds 100-line recommended maximum (coding rule 8.3.5).                                                                                                                           |
| 6   | 🟢 **Low**      | `includePending` in MCP `POST /mcp/query` is only read from query string, not from the validated POST body.                                                                                                 |
| 7   | 🟢 **Low**      | `pg_trgm` / full-text search not utilized despite being mentioned in ADR-007.                                                                                                                               |

---

## Recommendations

1. **Fix the critical bug:** Change `'active'` to `'valid'` on lines 500 and 535 of `intent-router.ts`. This is a one-character fix that unblocks the entire direct lookup fast-path.

2. **Add integration tests:** Create integration tests that seed the DB with L3 nodes, trigger fast-path queries (`#attach`, file extensions, single-word), and use MSW to assert 0 external LLM calls. Similarly, add fallback tests that assert exactly 1 LLM call for non-matching queries.

3. **Optimize Layer 3:** Consider using a database-side query (e.g., `WHERE query ILIKE '%' || name || '%'`) or caching architectural terms in a Set/trie to avoid loading all records on every query.

4. **Add unit tests for `routeQuery()`:** Test each fast-path layer in isolation with mocked DB and LLM dependencies.

5. **Fix `includePending` in MCP route:** Extract `includePending` from the Zod-validated body in `POST /mcp/query` instead of only from the query string.

---

## Overall Verdict

### ⚠️ WARN

The O(1) fast-path filters are **implemented** and correctly structured in the code. The `#attach`/file extension regex filter and L1/L2 name matching are present and properly integrated into both REST and MCP endpoints. However, a **critical bug** (`'active'` vs `'valid'`) in `directLookupHandler` effectively breaks the direct lookup path, and the absence of any integration tests verifying LLM bypass means the fast-path behavior is unverified. The O(1) claim for L1/L2 matching is also inaccurate (it's O(N)).

---

### Item 3.4.1 — Orphan branch writer (Centralized w/ Advisory Locks)

- **Status:** `WARN`
- **Report File:** [0237_3.4.1.md](./reports/0237_3.4.1.md)

**Report Findings:**

## Findings

1. **✅ Core orphan branch writer exists and is functional:** The `orphan-branch-writer.ts` module implements the file generation and git commit logic as specified in ADR-003.

2. **✅ Advisory lock is correctly implemented:** `pg_try_advisory_xact_lock(projectId)` is the right choice — it's transaction-scoped (auto-releases on commit/rollback), uses the projectId as the lock key (per-project serialization), and gracefully handles contention by skipping rather than blocking.

3. **✅ File structure matches design spec:** The generated file paths follow the ADR-003 structure: `{projectId}/l1_tags.yaml`, `{projectId}/l2_modules/{slug}.yaml`, `{projectId}/l3_decisions/{module-slug}/{id}-{slug}.md`.

4. **✅ Git fast-import is used correctly:** The `deleteall` command in fast-import ensures the tree is fully replaced on each write, preventing stale files from accumulating. The `inline` data mode avoids temporary file creation.

5. **⚠️ L1 tags are always empty:** `buildL1TagsYaml([])` is called with an empty array on line 103. The function never queries the `l1_tags` table. The `l1_tags.yaml` file will always contain `tags: []`. This is a gap between the design (which specifies L1 tags should be written) and the implementation.

6. **⚠️ No 3-way merge support:** ADR-004 states: "the API Server performs a standard Git 3-way merge on the orphan branch. If conflicts occur, it returns 409 Conflict." The current implementation uses `git fast-import` with `deleteall`, which **overwrites** the entire tree. It does not perform a 3-way merge and cannot detect or report conflicts. This is a significant gap for concurrent client pushes.

7. **⚠️ Double advisory lock acquisition:** The `sync.ts` route acquires `pg_try_advisory_xact_lock` on lines 29-36, then calls `writeKnowledgeToOrphanBranch()` which also acquires the same lock on lines 73-81. Since `pg_try_advisory_xact_lock` is transaction-scoped and the same transaction is used (the `db.transaction()` call in sync.ts), the second lock attempt within the same transaction will succeed (Postgres advisory locks are reentrant within the same session). However, this is redundant and could be confusing. The lock in `orphan-branch-writer.ts` is only useful when the function is called standalone (not from sync.ts).

8. **⚠️ `generate.ts` does NOT call orphan branch writer:** The `POST /projects/:id/generate` endpoint creates L1/L2/L3 nodes in PostgreSQL but does NOT call `writeKnowledgeToOrphanBranch()`. This means the orphan branch is only updated when `POST /sync/push` is called, not when the generate pipeline runs. The generate pipeline is the primary way knowledge is created, so the orphan branch will be stale unless sync is explicitly called.

---

## Round 2 — Code Quality & Security Review

### Security Findings

1. **🔴 Command injection risk in `buildFastImportData`:** The `fastImportData` string is constructed from user-controlled data (L2 node names, L3 titles/content, commit hashes) and passed to `git fast-import` via `printf '%s' ${JSON.stringify(fastImportData)}`. While `JSON.stringify` provides some escaping, the `filePath` in the fast-import stream is not escaped — it's derived from `slugify()` which restricts to `[a-z0-9-]`, so file paths are safe. However, the **content** of the files is embedded directly in the fast-import stream. If an L3 node's content contains the string `data N` followed by carefully crafted bytes, it could theoretically manipulate the fast-import stream. In practice, this is low-risk because the content is embedded after a `data N` length prefix, and `git fast-import` is lenient. But the safer approach would be to use `--batch-mode` or write to a temporary file.

2. **⚠️ No input sanitization on L2/L3 content:** The `buildL2ModuleYaml` and `buildL3DecisionMd` functions escape double quotes (`\"`) but do not sanitize against YAML injection (e.g., `description: "!!python/object/apply:os.system ['rm -rf /']`). Since the output is YAML frontmatter in Markdown files, this is low-risk, but proper YAML serialization (using a library like `js-yaml`) would be safer than string concatenation.

3. **✅ No SQL injection risk:** All database queries use parameterized Drizzle ORM queries. The `projectId` is validated as `z.number().int().positive()` in the sync route.

4. **✅ Graceful degradation:** The function handles missing git CLI (lines 95-100), empty L2 nodes (lines 89-92), and lock contention (lines 78-81) without throwing unhandled exceptions.

### Code Quality Findings

1. **✅ Defensive design:** Early returns for lock contention, missing git, and empty nodes. Try/catch around the main logic with proper error logging.

2. **✅ Structured logging:** Uses the project's pino logger with redact configuration. Log messages include the projectId for traceability.

3. **⚠️ `buildL1TagsYaml` is a no-op:** The function is always called with an empty array. Either the L1 tags should be queried from the database, or the function should be removed.

4. **⚠️ `slugify` is duplicated:** The `slugify` function is defined locally in `orphan-branch-writer.ts`. If other modules need slugification, this should be a shared utility.

5. **⚠️ No unit tests for `orphan-branch-writer.ts`:** There are zero tests for this module. The ADR-004 "Verifiability" section requires: "Outbox Sync Guarantee: API server integration tests MUST use `withRollback(...)` to insert a pending Git synchronization event into the Outbox table. A worker tick MUST assert the `git` command execution (via mocked `child_process` or equivalent) and the subsequent deletion/status-update of the Outbox row." No such test exists.

6. **⚠️ No integration test for `POST /sync/push`:** The sync route has no integration tests. The only integration test for the sync/generate pipeline is `generate.test.ts` which tests the generate endpoint, not the sync endpoint.

7. **⚠️ `sync.ts` has incomplete event handlers:** Line 51 says `// ... (other handlers omitted for brevity)` — the `DELETE_L3`, `CREATE_L2`, and `UPDATE_L2` event types defined in the schema (line 14) are not implemented. Only `CREATE_L3` and `UPDATE_L3` have handlers.

---

## Round 3 — Integration & Completeness Review

### Integration Coverage

1. **✅ Route is mounted:** The sync router is imported and mounted in `routes/index.ts` (line 21: `router.use(syncRouter)`). The `POST /sync/push` endpoint is accessible.

2. **✅ Orphan branch writer is called from sync:** The `writeKnowledgeToOrphanBranch()` function is correctly imported and called within the sync route's transaction (line 55).

3. **❌ Orphan branch writer is NOT called from generate:** The `POST /projects/:id/generate` endpoint (1210 lines) creates L1/L2/L3 nodes in PostgreSQL but never calls `writeKnowledgeToOrphanBranch()`. This means the orphan branch is only updated via explicit sync calls, not via the generate pipeline. This is a significant integration gap — the generate pipeline is the primary knowledge creation path.

4. **❌ No tests for orphan branch writer:** Zero unit tests and zero integration tests for the orphan branch writer. The ADR-004 verifiability requirements are not met.

5. **❌ No tests for sync route:** Zero integration tests for `POST /sync/push`.

### Completeness

1. **✅ Core feature is implemented:** The orphan branch writer exists, generates the correct file structure, and commits to the `docuvia-knowledge` branch using `git fast-import`.

2. **✅ Advisory lock is implemented:** `pg_try_advisory_xact_lock` is correctly used for distributed concurrency protection.

3. **⚠️ L1 tags not populated:** The `l1_tags.yaml` file is always empty. The L1 tags table is never queried.

4. **⚠️ No 3-way merge:** ADR-004 requires 3-way merge with 409 Conflict on merge conflicts. The current implementation uses `fast-import` with `deleteall` which overwrites the tree. This is acceptable for the server-authoritative model but doesn't support concurrent client pushes.

5. **⚠️ Incomplete sync event handlers:** Only `CREATE_L3` and `UPDATE_L3` are handled. `DELETE_L3`, `CREATE_L2`, and `UPDATE_L2` are defined in the schema but not implemented.

6. **⚠️ No git hook template:** ADR-008 and the implementation plan specify a `post-push` git hook template (`githook-template.sh`) that triggers `docuvia sync`. This file does not exist in the codebase.

7. **⚠️ No `docuvia sync` CLI:** The `docuvia sync` CLI command (item 3.4.3) is marked as ✅ in the checklist but the roadmap analysis noted it as "not yet implemented." The orphan branch writer depends on this CLI being available for the sync flow to work end-to-end.

### Performance Considerations

1. **✅ `git fast-import` is efficient:** Using `fast-import` with `deleteall` is an efficient way to atomically replace the tree. It avoids the overhead of a working tree checkout.

2. **⚠️ Full tree rewrite on every sync:** The `deleteall` approach rewrites ALL files for the project, even if only one L3 node changed. For large knowledge graphs, this could generate large git objects. An incremental approach (only writing changed files) would be more efficient.

3. **⚠️ All L2/L3 nodes loaded into memory:** The function loads all L2 nodes and all their L3 nodes into memory simultaneously. For projects with thousands of nodes, this could cause memory pressure.

---

## Findings Summary

| #   | Severity      | Finding                                                                                                                                |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🟡 **Medium** | `generate.ts` does NOT call `writeKnowledgeToOrphanBranch()` — the primary knowledge creation path doesn't update the orphan branch.   |
| 2   | 🟡 **Medium** | No 3-way merge support — ADR-004 requires 3-way merge with 409 Conflict on conflicts, but `fast-import deleteall` overwrites the tree. |
| 3   | 🟡 **Medium** | No tests for orphan branch writer — zero unit tests and zero integration tests. ADR-004 verifiability requirements unmet.              |
| 4   | 🟡 **Medium** | No integration tests for `POST /sync/push` — the sync route is completely untested.                                                    |
| 5   | 🟡 **Medium** | Incomplete sync event handlers — `DELETE_L3`, `CREATE_L2`, `UPDATE_L2` are defined in the schema but not implemented.                  |
| 6   | 🟢 **Low**    | L1 tags always empty — `buildL1TagsYaml([])` never queries the database.                                                               |
| 7   | 🟢 **Low**    | Double advisory lock acquisition when called from `sync.ts` — redundant but harmless due to reentrancy.                                |
| 8   | 🟢 **Low**    | No git hook template — `githook-template.sh` specified in the implementation plan does not exist.                                      |
| 9   | 🟢 **Low**    | Full tree rewrite on every sync — `deleteall` rewrites all files even for single-node changes.                                         |
| 10  | 🟢 **Info**   | `slugify` function is local — should be a shared utility if needed elsewhere.                                                          |
| 11  | 🟢 **Info**   | Command injection risk in fast-import stream is low due to `slugify` restrictions on file paths, but content is not sanitized.         |

---

## Recommendations

1. **Call orphan branch writer from generate pipeline:** Add `await writeKnowledgeToOrphanBranch(projectId)` to the success path of `POST /projects/:id/generate` (after line 1156 in `generate.ts`). This ensures the orphan branch is updated whenever knowledge is generated.

2. **Implement 3-way merge or document the simplification:** Either implement the 3-way merge as specified in ADR-004 (using `git fetch` + `git merge` on the orphan branch), or update the ADR to document that the server-authoritative model uses `fast-import deleteall` instead of merging.

3. **Add integration tests for sync route:** Create tests that seed L2/L3 nodes, call `POST /sync/push`, and verify that the orphan branch is updated. Use a temporary git repository for the test to avoid polluting the project repo.

4. **Add unit tests for `orphan-branch-writer.ts`:** Test the file generation logic (`buildL2ModuleYaml`, `buildL3DecisionMd`, `buildFastImportData`) in isolation with mocked database and git.

5. **Implement missing sync event handlers:** Add handlers for `DELETE_L3`, `CREATE_L2`, and `UPDATE_L2` in `sync.ts`.

6. **Query L1 tags from database:** Replace `buildL1TagsYaml([])` with an actual query to the `l1_tags` table.

7. **Create git hook template:** Add `artifacts/api-server/src/lib/githook-template.sh` as specified in the implementation plan.

---

## Overall Verdict

### ⚠️ WARN

The orphan branch writer is **implemented** and correctly structured. The core functionality — generating YAML/Markdown files from L2/L3 knowledge and committing them to the `docuvia-knowledge` orphan branch via `git fast-import` — is present and works as designed. The advisory lock (`pg_try_advisory_xact_lock`) is correctly implemented for distributed concurrency protection, matching the ADR-004 specification.

However, there are significant gaps:

1. **The generate pipeline doesn't call the orphan branch writer** — this is the most critical gap, as the primary knowledge creation path (generate) doesn't update the orphan branch. The orphan branch is only updated when `POST /sync/push` is explicitly called.
2. **No tests exist** for the orphan branch writer or the sync route, leaving the entire feature unverified.
3. **ADR-004's 3-way merge requirement is not implemented** — the current `fast-import deleteall` approach overwrites rather than merges.
4. **L1 tags are never written** to the orphan branch (always empty).
5. **Sync event handlers are incomplete** — 3 of 5 event types are unimplemented.

The feature is functional for the server-authoritative single-writer model but is not yet complete for the full distributed sync workflow described in the ADRs.

---

### Item 3.4.2 — Bidirectional sync between Client and Server

- **Status:** `WARN`
- **Report File:** [0238_3.4.2.md](./reports/0238_3.4.2.md)

**Report Findings:**

## Findings

1. **✅ Pull path is fully implemented:** The client can pull the knowledge snapshot from the server via `GET /projects/{id}/graph`. The 3-tier fallback (server → local → git) is correctly implemented in `KnowledgeStore.load()`.

2. **✅ Server-side sync route exists:** `POST /sync/push` is implemented, mounted, and functional. It accepts events, applies them to the database, and writes to the orphan branch.

3. **❌ Client → Server push is never triggered:** The `CentralServerClient.sync()` method exists but is **never called** from any code path in the extension. There is no automatic or manual mechanism to push local changes to the server. The bidirectional sync is therefore **half-implemented** — only the pull direction works.

4. **❌ No `docuvia sync` command:** There is no VS Code command (e.g., `docuvia.sync`) that would allow the user to manually trigger a sync. The `docuvia.addDecision` command handler is commented out (line 160-161: `// await addDecision(context, store);`).

5. **❌ No automatic sync on knowledge change:** When the `TaskRunner` writes extraction results to `.docuvia/` files (in `writeExtractionResults`), it calls `this.store.load()` to reload the local snapshot, but it does NOT call `centralClient.sync()` to push changes to the server. Local changes stay local.

6. **⚠️ `GET /projects/:id/graph` returns empty L1 tags:** The graph endpoint hardcodes `l1Tags: []` (line 180). The L1 tags are never queried from the database. This means the client always receives an empty L1 tag list when pulling from the server.

7. **⚠️ `POST /sync/push` has incomplete event handlers:** Only `CREATE_L3` and `UPDATE_L3` are implemented. `DELETE_L3`, `CREATE_L2`, and `UPDATE_L2` are defined in the schema but have no handlers (line 51: `// ... (other handlers omitted for brevity)`).

8. **⚠️ No WebSocket or SSE for server push:** ADR-004's sequence diagram shows a Sync ACK response, but there is no mechanism for the server to proactively push updates to the client. The client must poll or manually reload. This is acceptable for v1 but limits real-time sync.

---

## Round 2 — Code Quality & Security Review

### Security Findings

1. **✅ Bearer token auth on pull:** `pullSnapshot()` sends the token via `x-docuvia-token` header. The token is stored in VS Code's `SecretStorage` via `CredentialManager`.

2. **✅ Token auth on push:** `sync()` sends the token via `x-docuvia-token` header.

3. **✅ Zod validation on server routes:** Both `POST /sync/push` and `GET /projects/:id/graph` validate their inputs with Zod schemas.

4. **⚠️ No HMAC or signature on sync payload:** Unlike GitHub webhooks (which use HMAC-SHA256), the sync endpoint relies solely on the bearer token for authentication. This is acceptable for a bearer-token model but means any token holder can push arbitrary events.

5. **⚠️ No rate limiting on sync endpoint:** The sync route has no rate limiting. An attacker with a valid token could flood the endpoint with events, each of which triggers `writeKnowledgeToOrphanBranch()` (which runs `git fast-import`).

6. **✅ Advisory lock prevents split-brain:** The `pg_try_advisory_xact_lock` in both `sync.ts` and `orphan-branch-writer.ts` prevents concurrent writes to the same project.

### Code Quality Findings

1. **✅ Clean interface design:** The `IDocuviaClient` interface in `KnowledgeStore.ts` (lines 15-18) decouples the store from the concrete `CentralServerClient`, enabling testing with mock clients.

2. **✅ 3-tier fallback is well-structured:** The cascading fallback (server → local → git) with try/catch at each level is a good defensive pattern.

3. **✅ Mock server support:** Both `pullSnapshot()` and `sync()` support `DOCUVIA_MOCK_SERVER=1` environment variable for testing.

4. **⚠️ `sync()` method signature mismatch with server:** The client's `sync()` method sends `{ projectId, pushedBranch, pushedCommits }` but the server's `POST /sync/push` expects `{ projectId: number, events: [...] }`. The client sends branch/commits while the server expects a CQRS outbox event format. **These are incompatible** — even if the client called `sync()`, the server would reject the payload as invalid (the server expects `events` array, not `pushedBranch`/`pushedCommits`).

5. **⚠️ No tests for bidirectional sync:** There are no unit tests for `CentralServerClient.sync()` or `CentralServerClient.pullSnapshot()`. There are no integration tests for the sync route. The only integration tests are `generate.test.ts` and `mcp-list-projects.test.ts`.

6. **⚠️ `KnowledgeStore.load()` doesn't push after pull:** After successfully pulling from the server, the store doesn't check whether there are local changes that should be pushed back. A true bidirectional sync would reconcile local and remote state.

---

## Round 3 — Integration & Completeness Review

### Integration Coverage

1. **✅ Pull path is integrated:** `KnowledgeStore.load()` is called from `extension.ts` on activation (line 45: `await store.load()`), from `docuvia.refreshKnowledgeGraph` command (line 147), and from `TaskRunner` after writing extraction results (line 299). The pull path works end-to-end.

2. **✅ Server graph endpoint is mounted:** `GET /projects/:id/graph` is defined in `projects.ts` which is mounted in `routes/index.ts`.

3. **✅ Sync route is mounted:** `POST /sync/push` is defined in `sync.ts` which is mounted in `routes/index.ts`.

4. **❌ Push path is NOT integrated:** `CentralServerClient.sync()` is defined but never invoked. There is no code path that triggers a push from client to server.

5. **❌ No reconciliation logic:** There is no logic to detect conflicts between local and remote state, no merge strategy, and no conflict resolution UI.

6. **❌ No sync status indicator:** The extension has no way to show the user whether local changes have been synced to the server.

### Completeness

| Component                                | Status                              |
| ---------------------------------------- | ----------------------------------- |
| Client pull from server (`pullSnapshot`) | ✅ Implemented and integrated       |
| Client push to server (`sync` method)    | ✅ Implemented but **never called** |
| Server receive push (`POST /sync/push`)  | ✅ Implemented and mounted          |
| Server write to orphan branch on sync    | ✅ Implemented                      |
| Client fallback to local `.docuvia/`     | ✅ Implemented                      |
| Client fallback to git orphan branch     | ✅ Implemented                      |
| Automatic sync trigger                   | ❌ Not implemented                  |
| Manual sync command                      | ❌ Not implemented                  |
| Sync conflict detection                  | ❌ Not implemented                  |
| Sync status UI                           | ❌ Not implemented                  |
| Bidirectional sync tests                 | ❌ Not implemented                  |
| L1 tags in graph endpoint                | ❌ Always empty                     |
| Complete sync event handlers             | ❌ 3 of 5 event types unimplemented |

### Performance Considerations

1. **✅ `pullSnapshot` fetches full snapshot:** The `GET /projects/:id/graph` endpoint returns the entire knowledge graph in one request. This is efficient for small-to-medium graphs but could be slow for very large projects.

2. **⚠️ No incremental sync:** The client always pulls the full snapshot. There is no delta-based sync that would only fetch changes since the last sync.

3. **⚠️ `KnowledgeStore.load()` blocks on server:** If the server is slow or unreachable, the `await this._client.pullSnapshot()` call will block the entire load process before falling back to local. A timeout or parallel approach would be more resilient.

---

## Findings Summary

| #   | Severity      | Finding                                                                                                                                                                                         |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 **High**   | `CentralServerClient.sync()` is **never called** — the client-to-server push path is completely disconnected. Bidirectional sync is half-implemented (pull only).                               |
| 2   | 🔴 **High**   | **Payload format mismatch:** Client sends `{ projectId, pushedBranch, pushedCommits }` but server expects `{ projectId, events: [...] }`. Even if called, the sync would fail with a 400 error. |
| 3   | 🟡 **Medium** | No automatic or manual sync trigger — no `docuvia.sync` command, no auto-sync on file change, no periodic sync.                                                                                 |
| 4   | 🟡 **Medium** | `GET /projects/:id/graph` returns `l1Tags: []` always — L1 tags are never queried from the database.                                                                                            |
| 5   | 🟡 **Medium** | Incomplete sync event handlers — `DELETE_L3`, `CREATE_L2`, `UPDATE_L2` are defined in the schema but not implemented.                                                                           |
| 6   | 🟡 **Medium** | No tests for bidirectional sync — zero unit tests for `CentralServerClient.sync()` and zero integration tests for `POST /sync/push`.                                                            |
| 7   | 🟢 **Low**    | No WebSocket/SSE for server-to-client push — the client must poll or manually reload.                                                                                                           |
| 8   | 🟢 **Low**    | No sync conflict detection or resolution — if local and remote diverge, there is no reconciliation.                                                                                             |
| 9   | 🟢 **Low**    | No sync status indicator in the UI — users cannot see whether their local changes are synced.                                                                                                   |
| 10  | 🟢 **Info**   | No incremental sync — the full snapshot is always pulled, even for small changes.                                                                                                               |

---

## Recommendations

1. **Connect the sync call:** Add a call to `centralClient.sync()` in the appropriate place — either in `TaskRunner.writeExtractionResults()` after writing local changes, or as a periodic background task, or as a new `docuvia.sync` command. This is the single most important fix.

2. **Fix the payload format:** Update `CentralServerClient.sync()` to send the CQRS outbox format (`{ projectId, events: [...] }`) that `POST /sync/push` expects, or update the server to accept the current client format. The two must agree.

3. **Add a `docuvia.sync` command:** Register a `docuvia.sync` command in `extension.ts` that calls `centralClient.sync()` with the appropriate parameters, allowing users to manually trigger sync.

4. **Query L1 tags in graph endpoint:** Update `GET /projects/:id/graph` in `projects.ts` to query the `l1_tags` table and return actual L1 tags instead of an empty array.

5. **Implement missing sync event handlers:** Add handlers for `DELETE_L3`, `CREATE_L2`, and `UPDATE_L2` in `sync.ts`.

6. **Add integration tests for sync:** Create tests that verify the full bidirectional sync flow — client pushes events, server processes them, client pulls the updated snapshot.

7. **Add sync conflict detection:** Implement a mechanism to detect when local and remote state have diverged and provide a resolution strategy (e.g., last-write-wins, manual merge, or 3-way merge).

8. **Add sync status indicator:** Show the sync status in the VS Code status bar (e.g., "Synced", "Local changes pending", "Sync failed").

---

## Overall Verdict

### ⚠️ WARN

The **server-to-client pull path** is fully implemented and well-architected. The `KnowledgeStore.load()` method correctly implements a 3-tier fallback (server API → local files → git orphan branch), and the `GET /projects/:id/graph` endpoint returns the knowledge snapshot as designed.

The **client-to-server push path** is **not functional**. While both the client's `CentralServerClient.sync()` method and the server's `POST /sync/push` route exist, they are **never connected**:

1. `sync()` is never called from any code path in the extension
2. The payload format of `sync()` (`{ projectId, pushedBranch, pushedCommits }`) is **incompatible** with what the server expects (`{ projectId, events: [...] }`)
3. There is no user-facing sync command or automatic sync trigger

Additionally, the `GET /projects/:id/graph` endpoint always returns empty L1 tags, and 3 of 5 sync event types are unimplemented.

The bidirectional sync is **architecturally designed but not operationally functional**. The pull direction works; the direction is disconnected and would fail even if connected due to the payload format mismatch.

---

### Item 3.4.3 — docuvia sync CLI (not yet implemented)

- **Status:** `WARN`
- **Report File:** [0239_3.4.3.md](./reports/0239_3.4.3.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                               |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 High   | CLI calls wrong server endpoint (`/projects/:id/sync` instead of `/sync/push`) and sends no payload. The sync flow is non-functional. |
| 2   | 🔴 High   | `POST /projects/:id/sync` is a stub — only logs activity, does not process commits, update validity, or write to orphan branch.       |
| 3   | 🔴 High   | `CentralServerClient.sync()` calls `POST /sync` which does not exist on the server. The client-to-server push path is disconnected.   |
| 4   | 🟡 Medium | CLI does not accept `--branch`/`--commits` flags that the githook template passes.                                                    |
| 5   | 🟡 Medium | CLI does not read `.docuvia/config.yaml` or `.docuvia/.snapshot-ref` as specified.                                                    |
| 6   | 🟡 Medium | CLI does not run `git fetch origin docuvia-knowledge` after sync.                                                                     |
| 7   | 🟡 Medium | `scripts/package.json` has no `bin` entry — CLI is not installable as a command.                                                      |
| 8   | 🟡 Medium | No `docuvia.sync` VS Code command registered for manual sync triggering.                                                              |
| 9   | 🟢 Low    | No tests for CLI functionality.                                                                                                       |
| 10  | 🟢 Low    | `cli.ts` uses `process.exit()` directly, making it untestable without mocks.                                                          |

---

## Recommendations

1. **Fix CLI interface:** Update `scripts/src/cli.ts` to accept `--branch` and `--commits` flags matching the githook template.
2. **Fix CLI server target:** Change the CLI to call `POST /sync/push` with the correct CQRS outbox payload format: `{ projectId, events }`.
3. **Implement server sync logic:** Either replace the `POST /projects/:id/sync` stub with actual sync logic (process commits, update validity, trigger generation, write to orphan branch) or route it to the existing `POST /sync/push` handler.
4. **Add `POST /sync` route:** Either add a `POST /sync` endpoint that wraps `POST /sync/push`, or update `CentralServerClient.sync()` to call `POST /sync/push` directly.
5. **Add `git fetch` step:** After successful sync response, run `git fetch origin docuvia-knowledge` and update `.docuvia/.snapshot-ref`.
6. **Add `bin` entry to `scripts/package.json`:** Make the CLI installable as the `docuvia` command.
7. **Register `docuvia.sync` VS Code command:** Allow users to manually trigger sync from the command palette.
8. **Add tests:** Write integration tests for the CLI and the sync endpoint.

---

## Overall Verdict

**⚠️ WARN** — The `docuvia sync` CLI is scaffolded but has critical gaps preventing end-to-end operation. The CLI exists as a source file but is not installable, calls the wrong server endpoint with no payload, and the server's sync endpoint is a stub. The correctly-designed `POST /sync/push` CQRS endpoint exists on the server but is never called by anything. The githook template references CLI flags that don't exist. Core functionality (reading config, pushing deltas, fetching orphan branch) is missing. The item is partially implemented but not functional.

---

### Item 3.4.4 — VS Code KnowledgeStore rewrite to read from orphan branch ref

- **Status:** `WARN`
- **Report File:** [0240_3.4.4.md](./reports/0240_3.4.4.md)

**Report Findings:**

## Findings

**F1 — File path format mismatch between writer and reader** 🔴 High

The orphan branch writer (`orphan-branch-writer.ts:107–119`) creates files at:

```
{projectId}/l2_modules/{l2Slug}.yaml
{projectId}/l3_decisions/{l2Slug}/{l3Id}-{l3Slug}.md
```

The KnowledgeStore reader (`KnowledgeStore.ts:306, 318`) expects:

```
l2_modules/*.yaml         (flat — correct)
l3_decisions/*.md         (flat — WRONG, misses nested l2Slug/ subdirectory)
```

L3 decision files are nested under `{l2Slug}/` subdirectories by the writer but the reader only finds flat `*.md` files. **In practice, `_loadFromGit` will find zero L3 decision files from the orphan branch**, because `git ls-tree` will return paths like `l3_decisions/auth/login-flow/42-login-flow.md` which don't match the flat `l3_decisions/*.md` filter.

**F2 — L1 tags YAML format mismatch** 🟡 Medium

The orphan branch writer's `buildL1TagsYaml()` (`orphan-branch-writer.ts:18–22`) produces:

```yaml
tags:
  - name: ...
```

The KnowledgeStore reader (`KnowledgeStore.ts:302–303`) expects `project_name:` in the YAML to extract the project name via regex `/^project_name:\s*"?([^"\n]+)"?/m`. The writer's output has no `project_name:` field, so the project name will always fall back to `path.basename(workspaceRoot)`.

Additionally, `parseTags()` (parser.ts:18–34) handles both array and object-with-`tags`-key formats, so the `tags:` key-only format will parse correctly for tag data — but the project name extraction will fail.

**F3 — Git fallback is third priority, not a true "rewrite"** 🟡 Medium

The item description says "KnowledgeStore rewrite to read from orphan branch ref." The current implementation treats the orphan branch as a last-resort fallback (tier 3), not as a primary or co-equal data source. The local `.docuvia/` directory takes precedence. This means:

- If `.docuvia/` exists with stale data, the orphan branch data is never used.
- The orphan branch is only reached when both server AND local files are empty/missing.

This is a reasonable degradation order but doesn't match the spirit of "rewrite to read from orphan branch ref" — the orphan branch should be a first-class source.

**F4 — No orphan branch fetch/prune logic** 🟢 Low

The `_loadFromGit` method assumes the `docuvia-knowledge` branch exists locally. There is no `git fetch` to pull the branch from a remote, no check for branch existence, and no error handling for "branch not found" vs "other git error." If the branch doesn't exist locally, `git ls-tree` will fail silently (`.catch(() => '')`) and the fallback returns empty results.

---

## Round 2 — Code Quality & Security Review

### Code Quality

**F5 — `_loadFromGit` blob parsing is fragile** 🟡 Medium

The `readGitBlobs` method (KnowledgeStore.ts:348–425) manually parses `git cat-file --batch` output by scanning for newlines and reading fixed-size blobs. This is correct for the batch protocol but has no protection against:

- Binary data in blobs (unlikely for YAML/MD, but no guard)
- Unexpected `missing` entries for individual files (handled at line 399, but only skips — doesn't log)
- Buffer offset misalignment if any file is `missing` — the offset advancement at line 411 (`offset += size + 1`) still works because `missing` entries have no blob data to skip

**F6 — No input validation on `projectId` in git commands** 🟢 Low

The `projectId` (a number from `manifest.project_id`) is interpolated into git command arguments at line 421: `` `${GIT_KNOWLEDGE_BRANCH}:${projectId}/${file}` ``. Since `projectId` is a number from the manifest (not user-controlled string), injection risk is minimal. However, no explicit validation ensures it's a positive integer.

**F7 — Error handling is silent** 🟢 Low

All three fallback tiers catch errors and log to the output channel, but never surface errors to the user. If all three tiers fail, the user sees an empty knowledge graph with no indication of what went wrong. The output channel logs are helpful for debugging but not visible by default.

### Security

No significant security concerns. The git commands use `execFile` (not `shell`), preventing command injection. The `projectId` is a numeric value from a local manifest file.

---

## Round 3 — Integration & Completeness Review

### Integration Coverage

| Integration Point                                               | Status           | Notes                                                  |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| `KnowledgeStore.load()` → `_loadFromGit()`                      | ✅ Wired         | Called as tier 3 fallback                              |
| `KnowledgeGraphTreeProvider` → `KnowledgeStore`                 | ✅ Wired         | Subscribes to `onDidLoad` event                        |
| `TaskRunner.writeExtractionResults()` → `KnowledgeStore.load()` | ✅ Wired         | Reloads after extraction                               |
| `KnowledgeStore.startWatcher()` → `KnowledgeStore.load()`       | ✅ Wired         | FileSystemWatcher triggers reload                      |
| Server `generate.ts` → `writeKnowledgeToOrphanBranch()`         | ❌ **Not wired** | Generate pipeline does NOT trigger orphan branch write |
| `POST /sync/push` → `writeKnowledgeToOrphanBranch()`            | ✅ Wired         | Sync outbox handler triggers write                     |

**F8 — Generate pipeline doesn't write to orphan branch** 🔴 High

The `generate.ts` route (1210 lines) handles L1/L2/L3 node creation, review task generation, noise detection, and cross-project links — but never calls `writeKnowledgeToOrphanBranch()`. This means the orphan branch is only updated when `POST /sync/push` is called, which (per 3.4.3 findings) is never invoked from the CLI or any automated trigger. **The orphan branch will remain empty/stale after normal generate operations**, making the KnowledgeStore's git fallback useless in practice.

**F9 — No tests for `_loadFromGit`** 🟡 Medium

There are no unit or integration tests for the `_loadFromGit` method, `readGitBlobs`, or the three-tier fallback logic. The git fallback path is entirely untested.

**F10 — `docuvia-knowledge` branch constant is duplicated** 🟢 Low

`GIT_KNOWLEDGE_BRANCH = 'docuvia-knowledge'` is defined in `KnowledgeStore.ts:12` and `orphan-branch-writer.ts:123`. A shared constant would prevent drift.

### Performance

The `git cat-file --batch` approach is efficient for bulk reads. The `git ls-tree` call is a single subprocess. No performance concerns.

---

## Findings Summary

| #   | Severity  | Finding                                                                                                 |
| --- | --------- | ------------------------------------------------------------------------------------------------------- |
| F1  | 🔴 High   | L3 decision file path mismatch: writer nests under `{l2Slug}/`, reader expects flat `l3_decisions/*.md` |
| F2  | 🟡 Medium | L1 tags YAML from writer lacks `project_name:` field; project name falls back to directory basename     |
| F3  | 🟡 Medium | Orphan branch is tier-3 fallback, not a primary source; local `.docuvia/` takes precedence              |
| F4  | 🟢 Low    | No `git fetch` to ensure orphan branch exists locally                                                   |
| F5  | 🟡 Medium | Manual `git cat-file --batch` parsing is correct but fragile                                            |
| F6  | 🟢 Low    | No explicit validation of `projectId` before git command interpolation                                  |
| F7  | 🟢 Low    | Silent error handling — user sees empty graph with no diagnostic UI                                     |
| F8  | 🔴 High   | `generate.ts` never calls `writeKnowledgeToOrphanBranch()` — orphan branch stays empty after generation |
| F9  | 🟡 Medium | Zero test coverage for git fallback path                                                                |
| F10 | 🟢 Low    | Branch name constant duplicated across client and server                                                |

## Recommendations

1. **Fix L3 path mismatch** (F1): Update `_loadFromGit` to handle nested `l3_decisions/{l2Slug}/*.md` paths, OR flatten the orphan branch writer's L3 output to `l3_decisions/{id}-{slug}.md`.
2. **Add `project_name` to writer's L1 YAML** (F2): Include `project_name:` in the `buildL1TagsYaml` output.
3. **Wire generate → orphan branch** (F8): Add `await writeKnowledgeToOrphanBranch(projectId)` to the generate pipeline's completion path.
4. **Add `git fetch` before read** (F4): Before `git ls-tree`, run `git fetch origin docuvia-knowledge` to ensure the branch exists locally.
5. **Add tests** (F9): Create integration tests for `_loadFromGit` using a test git repository with an orphan branch.
6. **Reconsider fallback priority** (F3): Consider making the orphan branch a co-equal source with `.docuvia/`, or add a configuration option to control priority.

---

## Overall Verdict

**⚠️ WARN** — The KnowledgeStore has been rewritten with a git orphan branch fallback (`_loadFromGit`), fulfilling the basic intent of item 3.4.4. However, two critical issues prevent it from working correctly:

1. **L3 decision file paths are incompatible** between the server writer and client reader (F1) — the reader will find zero L3 decisions from the orphan branch.
2. **The generate pipeline never writes to the orphan branch** (F8) — so the branch remains empty after normal operations, making the fallback read meaningless.

Additionally, the orphan branch is buried as a tier-3 fallback behind both server API and local `.docuvia/` reads, and there are no tests for the git fallback path. The feature exists architecturally but is non-functional end-to-end.

---

### Item 3.5.1 — git merge-base lookup for un-indexed commits

- **Status:** `WARN`
- **Report File:** [0241_3.5.1.md](./reports/0241_3.5.1.md)

**Report Findings:**

## Findings

**F1 — `getProjectedCommits()` is never called from the ingest route** 🔴 High

The ingest route (`ingest.ts:55`) calls:

```typescript
const commits = await client.getCommits(limit, since);
```

This uses `getCommits()` directly — which accepts an optional `revisionRange` parameter but receives none. The `getProjectedCommits()` method exists but is **dead code**: no route, CLI command, or internal caller invokes it. The merge-base lookup is implemented but completely disconnected from the ingestion pipeline.

**F2 — Incremental mode uses `since` date, not merge-base** 🟡 Medium

The ingest route's "incremental" mode (line 54) uses `project.lastGitIngestedAt` as a `--since` date filter:

```typescript
const since =
  mode === "incremental" && project.lastGitIngestedAt ? project.lastGitIngestedAt : undefined;
const commits = await client.getCommits(limit, since);
```

This is a different incremental strategy than merge-base projection. The `--since` date filter works for linear history but does not handle:

- Feature branches that diverge from main (will miss commits older than the branch point that haven't been ingested)
- Force-pushed or rebased branches (may re-ingest commits with different SHAs)
- Squashed commits (the original commits are lost)

The merge-base approach from the design spec is the correct solution for these cases, but it's not wired in.

**F3 — Temporal range anchor columns exist but are never populated** 🟡 Medium

The `l3_nodes` table schema defines `introducedInCommit` and `verifiedUntilCommit` columns (l3_nodes.ts:35–36), which are the Temporal Range Anchors from ADR-004. However, the ingestion pipeline (`ingestion-pipeline.ts:90–97`) never sets these columns when inserting commits or L3 nodes. The `processIngestion` function for git commits only inserts `projectId`, `hash`, `message`, `author`, `valid`, and `vcsType`.

Without populating these columns, the "temporal delta projection" (item 3.5.2) cannot function — there is no anchor to project deltas from.

**F4 — `getCurrentBranchName()` is implemented but unused** 🟢 Low

The `LocalGitClient` has a `getCurrentBranchName()` method (lines 117–128) that returns the current branch name. This could be used to populate the `commits.branchName` column (schema item 4.3.7), but it is never called during ingestion.

---

## Round 2 — Code Quality & Security Review

### Code Quality

**F5 — `getProjectedCommits` fallback behavior is correct** ✅

The try/catch around `git merge-base` properly handles the case where no common ancestor exists (e.g., detached HEAD, unrelated histories). Falling back to full repository analysis is the right behavior per the completion action plan.

**F6 — `getCommits` revision range parameter is well-designed** ✅

The `getCommits()` method accepts an optional `revisionRange` parameter that gets appended to the `git log` args. This is a clean design that allows `getProjectedCommits` to reuse the same log-parsing logic.

**F7 — No input validation on `baseRef` parameter** 🟢 Low

The `baseRef` parameter in `getProjectedCommits` defaults to `"origin/main"` and is passed directly to `git merge-base`. Since this is an internal API (not user-facing) with a safe default, the risk is minimal. However, if a caller passes a malicious ref name containing shell metacharacters, `execFileAsync` (which does not use a shell) safely handles this.

### Security

No security concerns. The `execFileAsync` calls use `child_process.execFile` (not `shell`), preventing command injection. All parameters are either hardcoded defaults or numeric project IDs.

---

## Round 3 — Integration & Completeness Review

### Integration Coverage

| Integration Point                               | Status               | Notes                                                 |
| ----------------------------------------------- | -------------------- | ----------------------------------------------------- |
| `LocalGitClient.getProjectedCommits()`          | ✅ Implemented       | Correct merge-base logic with fallback                |
| `ingest.ts` → `getProjectedCommits()`           | ❌ **Not wired**     | Ingest route calls `getCommits()` directly            |
| `ingest.ts` incremental mode                    | ⚠️ Partial           | Uses `--since` date, not merge-base                   |
| `ingestion-pipeline.ts` → temporal anchors      | ❌ **Not populated** | `introducedInCommit`, `verifiedUntilCommit` never set |
| `getCurrentBranchName()` → `commits.branchName` | ❌ **Not wired**     | Method exists but never called                        |
| Tests for `getProjectedCommits`                 | ❌ **None**          | Zero test coverage                                    |

**F8 — No tests for merge-base logic** 🟡 Medium

There are no unit or integration tests for `getProjectedCommits()`, the merge-base fallback, or the revision range behavior. The feature is entirely untested.

**F9 — `getProjectedCommits` is not exposed in any API endpoint** 🟡 Medium

No REST API endpoint or internal service calls `getProjectedCommits()`. The only git ingestion endpoint (`POST /projects/:id/ingest/git`) uses `getCommits()` directly. There is no way for a client to trigger merge-base-projected ingestion.

### Performance

The `git merge-base` command is a fast O(1) git operation. The `getProjectedCommits` method adds negligible overhead. The performance benefit of projection (only ingesting delta commits) is significant for large repositories but is unrealized since the method is not called.

---

## Findings Summary

| #   | Severity  | Finding                                                                                                             |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| F1  | 🔴 High   | `getProjectedCommits()` is dead code — never called from ingest route or any other component                        |
| F2  | 🟡 Medium | Incremental mode uses `--since` date filter instead of merge-base; doesn't handle branch divergence                 |
| F3  | 🟡 Medium | Temporal range anchor columns (`introducedInCommit`, `verifiedUntilCommit`) exist in schema but are never populated |
| F4  | 🟢 Low    | `getCurrentBranchName()` implemented but never called; `commits.branchName` never set                               |
| F5  | ✅ Good   | Merge-base fallback behavior (catch → full analysis) is correct                                                     |
| F6  | ✅ Good   | `getCommits` revision range parameter design is clean                                                               |
| F7  | 🟢 Low    | No input validation on `baseRef` (low risk — internal API with safe default)                                        |
| F8  | 🟡 Medium | Zero test coverage for merge-base logic                                                                             |
| F9  | 🟡 Medium | No API endpoint exposes merge-base-projected ingestion                                                              |

## Recommendations

1. **Wire `getProjectedCommits` into the ingest route** (F1): Change `ingest.ts:55` to call `client.getProjectedCommits(limit)` when the mode is not incremental, or add a new mode (e.g., `mode: "projected"`) that uses merge-base.
2. **Populate temporal anchors during ingestion** (F3): When processing commits, set `introducedInCommit` on L3 nodes to the commit SHA, and update `verifiedUntilCommit` on existing L3 nodes that are still valid in the new commit.
3. **Set `branchName` during ingestion** (F4): Call `getCurrentBranchName()` after clone and store it in the `commits.branchName` column.
4. **Add tests** (F8): Create unit tests for `getProjectedCommits` using a test git repository with known merge-base relationships.
5. **Consider merge-base for incremental mode** (F2): The `--since` date approach works for linear history but fails for feature branches. Consider using merge-base as the primary incremental strategy.

---

## Overall Verdict

**⚠️ WARN** — The `git merge-base` lookup is correctly implemented in `LocalGitClient.getProjectedCommits()` with proper fallback behavior. However, the method is **completely disconnected from the ingestion pipeline**: the ingest route calls `getCommits()` directly, bypassing the merge-base projection entirely. Additionally, the temporal range anchor columns exist in the database schema but are never populated during ingestion, and there are zero tests for the merge-base logic. The feature exists as dead code — architecturally present but operationally non-functional.

---

### Item 3.5.2 — Temporal delta projection

- **Status:** `WARN`
- **Report File:** [0254_3.5.2.md](./reports/0254_3.5.2.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                                                                        |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 High   | `getProjectedCommits()` is dead code — never called by any route or service. The merge-base projection is completely disconnected from the ingestion pipeline. |
| 2   | 🟡 Medium | Temporal anchor columns (`introducedInCommit`, `verifiedUntilCommit`) exist in schema but are never populated during ingestion.                                |
| 3   | 🟡 Medium | `commits.branchName` column exists in schema but `getCurrentBranchName()` is never called during ingestion.                                                    |
| 4   | 🟡 Medium | Incremental mode uses `--since` date filter instead of merge-base; doesn't handle branch divergence, force-pushes, or squashed commits.                        |
| 5   | 🟡 Medium | Zero test coverage for merge-base logic, temporal anchor population, or branch name tracking.                                                                  |

## Recommendations

1. **Wire `getProjectedCommits` into ingest route**: Change `ingest.ts:55` to call `client.getProjectedCommits(limit)` when mode is `"full"`, or add a new mode (e.g., `mode: "projected"`) that uses merge-base. This is the highest-priority fix.

2. **Populate temporal anchors during ingestion**: In `processIngestion()`, set `introducedInCommit` to the commit hash for each L3 node generated from that commit. Set `verifiedUntilCommit` when a node is invalidated by a later commit.

3. **Call `getCurrentBranchName()` during ingestion**: Store the branch name in `commits.branchName` to enable merge-gate tracking (item 4.3.8).

4. **Add tests**: Create unit tests for `getProjectedCommits` using a test git repository with known merge-base relationships. Create integration tests that verify temporal anchor population.

5. **Consider merge-base for incremental mode**: The `--since` date approach is fragile. Consider using merge-base as the primary incremental strategy, with `--since` as a fallback.

---

## Overall Verdict

**⚠️ WARN** — The temporal delta projection is partially implemented. The `getProjectedCommits()` algorithm in `git-client.ts` is correctly implemented with proper merge-base logic and fallback behavior, but it is **completely disconnected from the ingestion pipeline** — the ingest route calls `getCommits()` directly, bypassing merge-base projection entirely. Additionally, the temporal range anchor columns (`introducedInCommit`, `verifiedUntilCommit`) and `commits.branchName` column exist in the database schema but are never populated during ingestion. There are zero tests for any of this functionality. The feature exists as dead code and dead schema — the architecture is sound but the integration wiring is missing.

---

### Item 2.3.2 — Per-workspace .docuvia/ isolation

- **Status:** `WARN`
- **Report File:** [0243_2.3.2.md](./reports/0243_2.3.2.md)

**Report Findings:**

## Findings Summary

| #   | Severity  | Finding                                                                                                     |
| --- | --------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | 🟡 Medium | Path traversal check in `initProject()` uses `path.relative` on comma-joined paths — semantically incorrect |
| 2   | 🟡 Medium | `initProject` QuickPick filters out initialized folders, making re-init from palette impossible             |
| 3   | 🟢 Low    | `acceptL1Tags` doesn't validate `workspaceRoot` against known workspace folders                             |
| 4   | 🟢 Low    | No multi-root workspace E2E/integration tests for per-workspace isolation                                   |
| 5   | 🟢 Low    | `load()` clears all snapshots even when only one workspace changed (minor perf issue)                       |

## Recommendations

1. **Fix path traversal check** (`extension.ts:471`): Replace with `folders.some(f => targetRoot === f.uri.fsPath || targetRoot.startsWith(f.uri.fsPath + path.sep))`.
2. **Allow re-init from palette**: Add an "All folders" option to the QuickPick or remove the `uninitialized` filter, letting the overwrite guard handle already-initialized workspaces.
3. **Add workspace root validation to `acceptL1Tags`**: Check that `explicitRoot` matches a folder in `vscode.workspace.workspaceFolders` before writing.
4. **Add multi-root integration test**: Create a test that opens two workspace folders, initializes both, and verifies each `.docuvia/` is independent.
5. **Optimize `load()` for single-workspace changes**: Add an optional `workspaceRoot` parameter to `load()` so callers can reload a single root without clearing all snapshots.

---

## Overall Verdict

⚠️ **WARN** — Per-workspace `.docuvia/` isolation is architecturally sound and functionally working. The KnowledgeStore maintains per-root snapshots, per-root FileSystemWatchers, and per-root `.docuvia/` directories. All major operations (init, explore, extract, acceptL1Tags, auto-categorize) correctly resolve and use the workspace root. The critical BUG A-3 (acceptL1Tags writing to wrong workspace) has been fixed. However, there are notable gaps: a semantically broken path traversal check, no multi-root test coverage, and the `initProject` palette path blocking re-initialization of already-initialized workspaces. These are not blockers but represent real quality and security gaps that should be addressed.

---

### Item 4.1.1 — Cosine similarity ≥ 0.85 dedup check before L3 insert

- **Status:** `WARN`
- **Report File:** [0246_4.1.1.md](./reports/0246_4.1.1.md)

**Report Findings:**

## Summary

| Aspect                           | Status     | Details                                                           |
| -------------------------------- | ---------- | ----------------------------------------------------------------- |
| Schema supports dedup            | ✅ Yes     | embedding (text) + occurrenceCount (int) columns                  |
| Threshold 0.85 in schema         | ✅ Yes     | llm_configs.similarityThreshold default 0.85                      |
| Cosine similarity implementation | ✅ Yes     | Pure in-memory in embedding.ts:30-42                              |
| Dedup in generate pipeline       | ✅ Yes     | Full implementation at generate.ts:956-1055                       |
| Dedup in REST API                | ❌ No      | l3_nodes.ts:26-50 is direct insert, no dedup                      |
| Configurable threshold           | ⚠️ Partial | Configurable in generate.ts; hardcoded in detectCrossProjectLinks |
| Unit tests for cosine sim        | ✅ Yes     | 6 edge-case tests                                                 |
| Integration tests for dedup      | ❌ No      | Generate test only covers happy-path creation                     |
| Threshold boundary test          | ❌ No      | No test verifies 0.85 gating behavior                             |

## Gaps & Recommendations

1. **CRITICAL: REST API bypass** — The `POST /api/l2-nodes/:id/l3-nodes` endpoint creates L3 nodes without any dedup. Either add dedup logic to this endpoint or document that it is intentionally a raw bypass.

2. **Test coverage for dedup branch** — No tests verify the ≥0.85 similarity gating. Need at least:
   - Test: similar embeddings (≥0.85) → occurrenceCount increment instead of new insert
   - Test: dissimilar embeddings (<0.85) → new L3 node created
   - Test: configurable threshold is respected

3. **Hardcoded threshold in detectCrossProjectLinks** — Should use the configurable threshold from `llm_configs` rather than a local constant.

4. **No pgvector index** — Embeddings stored as text JSON, similarity computed in-memory. This is acceptable for small datasets but will not scale. Consider migrating to pgvector `vector(1536)` with an IVFFlat index for production use.

---

### Item 2.5.1 — maxFileSizeKBWarning in extension.ts

- **Status:** `WARN`
- **Report File:** [0247_2.5.1.md](./reports/0247_2.5.1.md)

**Report Findings:**

## Summary

| Aspect                      | Status | Details                                                            |
| --------------------------- | ------ | ------------------------------------------------------------------ |
| Design spec clarity         | ✅ Yes | Clear, consistent across 4 documents                               |
| package.json registration   | ✅ Yes | Properly registered with correct type/default/description          |
| extension.ts implementation | ✅ Yes | Full implementation at lines 223–232                               |
| Config key correctness      | ✅ Yes | `extraction.maxFileSizeKBWarning` matches spec                     |
| Default value correctness   | ✅ Yes | 50 KB matches spec                                                 |
| Warning UX consistency      | ✅ Yes | Same pattern as line count warning                                 |
| Gate ordering               | ✅ Yes | Include patterns → lines → KB → dispatch                           |
| Stale conflict notes        | ⚠️ Yes | `run-extraction.md` and `settings.md` have outdated conflict notes |
| Unit tests                  | ❌ No  | No tests for `runExtraction` handler                               |
| Integration tests           | ❌ No  | No tests for KB gate behavior                                      |

## Gaps & Recommendations

1. **Remove stale conflict notes** — Both `artifacts/vscode-client/design/command-palette/run-extraction.md` (line 49) and `artifacts/vscode-client/design/configuration/settings.md` (line 44) claim the KB check is unimplemented and the setting is missing from `package.json`. Both claims are now false. These conflict notes should be removed to avoid confusion.

2. **Add unit tests for `runExtraction` gates** — The KB size gate, line count gate, and include pattern gate are all untested. At minimum:
   - Test: file exceeding `maxFileSizeKBWarning` triggers warning
   - Test: file under `maxFileSizeKBWarning` proceeds without warning
   - Test: user cancelling the warning aborts extraction
   - Test: custom `maxFileSizeKBWarning` config value is respected

3. **Consider edge case: empty file** — A 0-byte file would compute `fileSizeKB = 0` and skip the warning. This is correct behavior but worth documenting.

---

### Item 2.5.2 — Chunking configs for extraction

- **Status:** `WARN`
- **Report File:** [0248_2.5.2.md](./reports/0248_2.5.2.md)

**Report Findings:**

## Summary

| Aspect                              | Status | Details                                                               |
| ----------------------------------- | ------ | --------------------------------------------------------------------- |
| Design spec clarity                 | ✅ Yes | Clear across `settings.md`, `run-extraction.md`, ADR-009              |
| `GlobalConfigSchema` definition     | ✅ Yes | `chunking_strategy: z.enum(['line', 'ast']).default('line')`          |
| Config parsing & validation         | ✅ Yes | `parseGlobalConfig()` with Zod, graceful fallback                     |
| Config loading at activation        | ✅ Yes | `extension.ts:28-38` reads `~/.docuvia/config.yaml`                   |
| Config injection into TaskRunner    | ✅ Yes | Passed via constructor                                                |
| `chunkContent()` strategy branching | ✅ Yes | Reads `globalConfig.chunking_strategy`, branches on `'ast'`           |
| Line-based chunking correctness     | ✅ Yes | Accumulates lines until `CHUNK_SIZE` (4000) exceeded                  |
| AST fallback behavior               | ✅ Yes | Logs warning, falls back to line chunking (by design)                 |
| Chunk processing integration        | ✅ Yes | Sequential, cancellable, with per-chunk error handling                |
| `CHUNK_SIZE` configurability        | ❌ No  | Hardcoded constant, not exposed in config                             |
| AST chunking implementation         | ❌ No  | Explicitly marked as TODO                                             |
| Unit tests                          | ❌ No  | No tests for `chunkContent()`, `parseGlobalConfig()`, or `TaskRunner` |
| Integration tests                   | ❌ No  | No tests for the chunking pipeline                                    |

## Gaps & Recommendations

1. **BUG B-2 is partially stale** — The `user-journeys.md` BUG B-2 says "TaskRunner completely ignores this config value." This is no longer accurate. The code at `TaskRunner.ts:406` does read `globalConfig.chunking_strategy` and branches on it. The AST branch falls through to line chunking by design, but the config value is not ignored. The bug note should be updated to reflect the current state: AST chunking is not implemented but the config value is read.

2. **Make `CHUNK_SIZE` configurable** — Currently hardcoded at 4000 characters. Consider adding a `chunk_size` field to `GlobalConfigSchema` so users can tune the chunk size for their LLM's context window. The `run-extraction.md` design spec already references `CHUNK_SIZE = 4000` as a named constant, making it a natural candidate for configuration.

3. **Add unit tests for `chunkContent()`** — The chunking logic is a pure function with clear inputs/outputs and should be straightforward to test:
   - Empty content → `[]`
   - Content under `CHUNK_SIZE` → single chunk
   - Content at `CHUNK_SIZE` boundary → single chunk
   - Content exceeding `CHUNK_SIZE` → multiple chunks, each ≤ 4000 chars
   - Very long single line → single chunk (document this behavior)
   - `'ast'` strategy → same output as `'line'` + log message

4. **Add unit tests for `parseGlobalConfig()`** — Test with valid config, invalid `chunking_strategy` value, missing file (empty string), and malformed YAML.

5. **Consider implementing AST chunking** — The `'ast'` strategy has been marked as TODO since initial implementation. Using `tree-sitter` or similar would provide syntax-aware chunking that respects function/class boundaries, improving extraction quality for large files.

6. **Edge case: very long single line** — A single line exceeding 4000 characters will be placed in one chunk that exceeds `CHUNK_SIZE`. Consider whether lines should be split at character boundaries or whether this is acceptable (the LM API may handle truncation).

## Overall Verdict

⚠️ **WARN** — The chunking configs for extraction are substantially implemented. The `chunking_strategy` field is properly defined in the global config schema, parsed, validated, and passed to `TaskRunner`. The `chunkContent()` method correctly implements line-based chunking with a 4000-character limit and gracefully handles the unimplemented `'ast'` strategy. The chunking pipeline integrates properly with the async extraction flow, including cancellation support and per-chunk error handling. However, `CHUNK_SIZE` is hardcoded (not configurable), AST chunking remains unimplemented (known TODO), and there is zero test coverage for the chunking logic or config parsing.

---

### Item 4.1.2 — occurrenceCount increment on match

- **Status:** `WARN`
- **Report File:** [0249_4.1.2.md](./reports/0249_4.1.2.md)

**Report Findings:**

## Summary

| Aspect                                | Status | Details                                                 |
| ------------------------------------- | ------ | ------------------------------------------------------- |
| Schema column definition              | ✅ Yes | `integer NOT NULL DEFAULT 1` in Drizzle + migration SQL |
| Increment in generate pipeline        | ✅ Yes | `generate.ts:990-995` — read current, +1, write back    |
| New node starts at 1                  | ✅ Yes | `generate.ts:1029` sets `occurrenceCount: 1`            |
| Orphan branch serialization           | ✅ Yes | `orphan-branch-writer.ts:62` writes `occurrence_count`  |
| Intent-router ordering                | ✅ Yes | `intent-router.ts:457` orders by `occurrenceCount DESC` |
| Atomic increment / concurrency safety | ⚠️ No  | Read-then-write without transaction or advisory lock    |
| REST API dedup bypass                 | ❌ No  | `POST /l2-nodes/:id/l3-nodes` has no increment logic    |
| Test coverage for increment           | ❌ No  | Zero tests for occurrenceCount increment behavior       |

## Gaps & Recommendations

1. **Concurrency risk (MEDIUM):** The read-then-write pattern at `generate.ts:990-995` is not atomic. If two generate requests process similar L3 candidates concurrently, both could read the same `occurrenceCount` value and both write `n+1`, losing one increment. Consider using `SET occurrenceCount = occurrenceCount + 1` (atomic SQL increment) or wrapping in a serializable transaction with the mutex from 1.4.2.

2. **Test coverage (HIGH):** No tests verify the occurrenceCount increment path. Need at least:
   - Test: second similar embedding (≥0.85) → existing node's `occurrenceCount` increments, no new row created
   - Test: condensation threshold is reached → condensation logic fires
   - Test: `occurrenceCount` defaults to 1 on new insert

3. **REST API bypass (MEDIUM):** Same gap identified in 4.1.1 — the `POST /api/l2-nodes/:id/l3-nodes` endpoint creates L3 nodes without dedup or occurrenceCount management. If this endpoint is used directly (not via the generate pipeline), the occurrenceCount feature is completely bypassed.

4. **Positive signal:** The occurrenceCount is correctly used as a quality signal throughout the system — orphan branch sync, intent-router ordering, and condensation triggering all consume it properly. The increment-on-match design from ADR-009 is faithfully implemented in the generate pipeline.

---

### Item 4.1.3 — Temporal Range Anchors for L3 nodes (replaced JSONB)

- **Status:** `WARN`
- **Report File:** [0251_4.1.3.md](./reports/0251_4.1.3.md)

**Report Findings:**

## Summary

| Aspect                    | Status             | Notes                                                          |
| ------------------------- | ------------------ | -------------------------------------------------------------- |
| Drizzle schema definition | ✅ Complete        | Both columns defined as nullable text                          |
| Database migration        | ❌ Missing         | `source_commits` JSONB still present; anchor columns not in DB |
| Drizzle snapshot          | ❌ Out of sync     | Snapshot doesn't include new columns                           |
| Population on insert      | ❌ Not implemented | All 3 insertion paths only set deprecated `commitHash`         |
| Query/read usage          | ⚠️ Partial         | Read by intent-router and export, but always null              |
| OpenAPI spec              | ❌ Not exposed     | `L3Node` and `L3NodeInput` schemas lack anchor fields          |
| Test coverage             | ❌ None            | No tests verify anchor population                              |
| ADR-004 compliance        | ⚠️ Partial         | Design in schema, not in logic                                 |

## Recommendation

**WARN** — The Temporal Range Anchors are architecturally designed and present in the Drizzle TypeScript schema, but the implementation is not yet functional. The columns are never populated, never exposed in the API contract, and the database migration has not been updated. To complete this item:

1. Create a Drizzle migration to add `introduced_in_commit` and `verified_until_commit` columns to the actual database
2. Update all L3 insertion points to set `introducedInCommit = commitHash` at creation time
3. Add logic to update `verifiedUntilCommit` when L3 nodes are invalidated
4. Expose both fields in the OpenAPI `L3Node` and `L3NodeInput` schemas
5. Add test factories and integration tests that verify anchor population

---

### Item 4.1.4 — ️ AI condensation run at occurrence threshold (default: 30)

- **Status:** `WARN`
- **Report File:** [0252_4.1.4.md](./reports/0252_4.1.4.md)

**Report Findings:**

## Summary

| Aspect                                        | Status     | Details                                                                           |
| --------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| Condensation threshold config (default 30)    | ✅ Yes     | `llm_configs.condensationThreshold` with correct default                          |
| Condensation review config (default false)    | ✅ Yes     | `llm_configs.condensationReviewRequired` with correct default                     |
| Threshold sourced from DB with fallback       | ✅ Yes     | `generate.ts:577–578`                                                             |
| Trigger condition (`>= threshold`)            | ✅ Yes     | `generate.ts:998`                                                                 |
| Content update on successful condensation     | ✅ Yes     | `generate.ts:1000–1004`                                                           |
| Review task creation gated by config          | ✅ Yes     | `generate.ts:1006–1015`                                                           |
| Condensation function (`condenseL3Node`)      | ⚠️ Partial | Logic is well-structured but references missing `sourceCommits` column            |
| **`sourceCommits` data available at runtime** | **❌ NO**  | Column missing from Drizzle schema → always `undefined` → function returns `null` |
| Repeated condensation trigger protection      | ❌ No      | Every increment past threshold re-triggers AI synthesis                           |
| Schema consistency (migration vs Drizzle)     | ⚠️ Drift   | Migration SQL and Drizzle schema define different column sets                     |
| Test coverage for condensation                | ❌ No      | Zero tests for condensation path                                                  |
| Batching within condensation                  | ✅ Yes     | 20 commits per batch, chained synthesis                                           |
| Error handling in condensation                | ✅ Yes     | Inner re-throw + outer catch returning null                                       |
| Rate limit protection                         | ✅ Yes     | 500ms sleep between batches                                                       |

## Gaps & Recommendations

1. **CRITICAL: `sourceCommits` column missing from Drizzle schema** — The condensation function reads `node.sourceCommits` but the `l3_nodes.ts` Drizzle schema does not define this column, so `db.select()` never returns it. The condensation path is **dead code** at runtime. Fix options:
   - **Option A:** Add `sourceCommits: jsonb("source_commits")` back to the Drizzle schema to match the migration SQL. This is the simplest fix and restores the ADR-009 design.
   - **Option B:** Rewrite `condenseL3Node` to derive commit hashes from the `commits` table (joining via `commit_l2_links` on the L2 parent, or using `introducedInCommit` as a starting point). This aligns with the temporal anchor migration but requires more complex query logic.
   - **Option C:** Add a new migration that adds `source_commits` to the DB AND adds it to the Drizzle schema, then backfills from existing data.

2. **HIGH: Repeated condensation trigger** — No guard against re-triggering. Once `occurrenceCount` hits 30, every subsequent occurrence (31, 32, 33...) will re-run the full AI condensation, burning tokens unnecessarily. Add one of:
   - Reset `occurrenceCount` to 0 after condensation
   - Add a `lastCondensedAt` timestamp and skip if already condensed
   - Trigger on `===` instead of `>=` (simplest but means threshold+1 through threshold+19 are "wasted")

3. **HIGH: Schema drift between migration SQL and Drizzle schema** — The migration has `source_commits` but not temporal anchors; Drizzle schema has temporal anchors but not `source_commits`. A proper migration file should reconcile these. Recommend adding a Drizzle migration that:
   - Adds `introduced_in_commit text` and `verified_until_commit text` columns to the DB
   - Optionally drops `source_commits` if the temporal anchor approach is intentional
   - Updates the Drizzle snapshot accordingly

4. **MEDIUM: Partial batch failure handling** — The `throw e` on line 169 aborts the entire condensation if one batch fails. Consider allowing partial synthesis (skip failed batch, continue with next) to maximize value from successful batches.

5. **MEDIUM: No test coverage** — Need at least:
   - Test: `occurrenceCount` reaches condensation threshold → `condenseL3Node` is called
   - Test: `occurrenceCount` below threshold → condensation not triggered
   - Test: `condensationReviewRequired = true` → review task created
   - Test: `condensationReviewRequired = false` → no review task
   - Test: condensation returns null → content not updated
   - Test: condensation returns content → content updated in DB

---

### Item 4.1.5 — l3_nodes schema: occurrenceCount, sourceCommits, validityStatus columns

- **Status:** `WARN`
- **Report File:** [0255_4.1.5.md](./reports/0255_4.1.5.md)

**Report Findings:**

## Summary

| Aspect                                     | Status        | Details                                                                      |
| ------------------------------------------ | ------------- | ---------------------------------------------------------------------------- |
| `occurrenceCount` column in Drizzle schema | ✅ Yes        | `integer NOT NULL DEFAULT 1` — `l3_nodes.ts:34`                              |
| `occurrenceCount` column in migration SQL  | ✅ Yes        | `integer DEFAULT 1 NOT NULL` — line 84                                       |
| `occurrenceCount` column in snapshot       | ✅ Yes        | Confirmed in `0000_snapshot.json`                                            |
| `occurrenceCount` write path (insert)      | ✅ Yes        | `generate.ts:1029` sets `occurrenceCount: 1`                                 |
| `occurrenceCount` write path (increment)   | ✅ Yes        | `generate.ts:990–995`                                                        |
| `occurrenceCount` read path (ordering)     | ✅ Yes        | `intent-router.ts:457`                                                       |
| `validityStatus` column in Drizzle schema  | ✅ Yes        | `text NOT NULL DEFAULT 'pending'` — `l3_nodes.ts:37`                         |
| `validityStatus` column in migration SQL   | ✅ Yes        | `text DEFAULT 'pending' NOT NULL` — line 86                                  |
| `validityStatus` column in snapshot        | ✅ Yes        | Confirmed in `0000_snapshot.json`                                            |
| `validityStatus` write path                | ✅ Yes        | `generate.ts:1030` sets `"pending"` on insert                                |
| `validityStatus` read path (filter)        | ✅ Yes        | `intent-router.ts` filters on `"valid"` / `"pending"`                        |
| `sourceCommits` column in Drizzle schema   | ❌ **No**     | Missing — replaced by temporal anchors                                       |
| `sourceCommits` column in migration SQL    | ✅ Yes        | `jsonb` — line 85                                                            |
| `sourceCommits` column in snapshot         | ✅ Yes        | Confirmed in `0000_snapshot.json`                                            |
| `sourceCommits` write path                 | ❌ **No**     | No code writes to this column                                                |
| `sourceCommits` read path                  | ❌ **Broken** | `generate.ts:123,126` reads it but Drizzle never returns it                  |
| Schema consistency (3 sources)             | ⚠️ **Drift**  | Migration/snapshot have `sourceCommits`; Drizzle schema has temporal anchors |

## Gaps & Recommendations

1. **CRITICAL: `sourceCommits` column missing from Drizzle schema** — The `condenseL3Node()` function in `generate.ts` reads `node.sourceCommits` but the Drizzle schema doesn't define this column, making the condensation path dead code at runtime. The column exists in the DB (per migration SQL) but is invisible to the ORM. Fix options:
   - **Option A:** Add `sourceCommits: jsonb("source_commits")` to the Drizzle schema to restore ORM visibility. Simplest fix.
   - **Option B:** Remove `source_commits` from the migration SQL and snapshot (if the temporal anchor approach is intentional), and rewrite `condenseL3Node` to derive commit data from `introducedInCommit` or via a join through `commit_l2_links`.

2. **HIGH: Schema drift between migration SQL and Drizzle schema** — The migration has `source_commits` but not temporal anchors; the Drizzle schema has temporal anchors but not `source_commits`. A proper Drizzle migration should reconcile these. Recommend adding a migration that either:
   - Adds `introduced_in_commit` and `verified_until_commit` to the DB and drops `source_commits`, OR
   - Adds `source_commits` to the Drizzle schema and backfills from existing data.

3. **MEDIUM: No code writes to `sourceCommits`** — Even if the column were added to the Drizzle schema, no INSERT or UPDATE statement ever populates it. The `generate.ts` insert path (lines 1019–1032) does not include `sourceCommits` in the `.values()` call. If this column is needed for condensation, the write path must be added.

4. **LOW: `commitHash` deprecation comment is misleading** — The comment at `l3_nodes.ts:26` says "superseded by sourceCommits[0] (v2)" but `sourceCommits` doesn't exist in the schema. This should be updated to reference `introducedInCommit` or the comment should be removed.

---

### Item 4.2.1 — Progressive batch mode (commits in groups of 20)

- **Status:** `WARN`
- **Report File:** [0256_4.2.1.md](./reports/0256_4.2.1.md)

**Report Findings:**

## Summary

| Aspect                                                               | Status         | Details                                                             |
| -------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| Batch loop (groups of 20)                                            | ✅ Implemented | `generate.ts:864-887`, `BATCH_SIZE = 20`                            |
| Previous L2 names passed for self-correction                         | ✅ Implemented | `generate.ts:246-249`, `previousBatchSection`                       |
| Bootstrap vs. path-rule branching                                    | ✅ Implemented | `generate.ts:765-887`, `allBootstrapConfirmed` check                |
| Schema columns (pathPatterns, isBootstrapConfirmed, reindexRequired) | ✅ Implemented | `l2_nodes.ts:22-24`                                                 |
| Confirm-bootstrap endpoint                                           | ✅ Implemented | `l2_nodes.ts:33-156` + OpenAPI spec                                 |
| Config.yaml writing on confirmation                                  | ✅ Implemented | `l2_nodes.ts:135-148`                                               |
| Cross-batch deduplication (code-level)                               | ⚠️ Gap         | Only LLM-level soft constraint via `previousL2Names`; no hard dedup |
| Rate limiting between batches                                        | ⚠️ Gap         | No sleep/delay between batch LLM calls (unlike `condenseL3Node`)    |
| `reindexRequired` flag usage                                         | ⚠️ Gap         | Column exists but is never set by the generate pipeline             |
| Test coverage for bootstrap batch mode                               | ⚠️ Gap         | No tests exercise the batch loop or bootstrap branching             |

## Gaps & Recommendations

1. **Add code-level cross-batch deduplication** in the bootstrap loop (`generate.ts:880-884`): before pushing to `l2Input`, check if a module name already exists in the accumulated results from previous batches. This provides a hard guarantee beyond the LLM-level soft constraint.

2. **Add rate limiting between batch LLM calls** in the bootstrap loop (`generate.ts:885`): add a configurable delay (e.g., 500ms) between batches to prevent 429 errors, matching the pattern already used in `condenseL3Node()`.

3. **Implement `reindexRequired` flag logic** (`generate.ts`): when bootstrap is confirmed and path patterns are saved, existing `commit_l2_links` rows should be flagged for reindexing so the next generate run can retroactively correct L2 assignments using the new path rules.

4. **Add integration tests for bootstrap batch mode**: create a test with >20 commits that verifies the batch loop executes multiple iterations, `previousL2Names` grows across batches, and the bootstrap vs. path-rule branching works correctly. Also add a test for the `confirm-bootstrap` endpoint.

---

### Item 4.2.2 — ️ WARN AI self-correction across batches

- **Status:** `WARN`
- **Report File:** [0257_4.2.2.md](./reports/0257_4.2.2.md)

**Report Findings:**

## Summary

| Aspect                                 | Status         | Details                                                                           |
| -------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `previousL2Names` passed to each batch | ✅ Implemented | `generate.ts:878`, accumulated across batches (lines 880–883)                     |
| `previousBatchSection` in LLM prompt   | ✅ Implemented | `generate.ts:246-249`, injected into user message                                 |
| Few-shot corrections in prompt         | ✅ Implemented | `generate.ts:245`, `buildFewShotSection()` (lines 106–117)                        |
| `getRecentCorrections()` queries DB    | ✅ Implemented | `generate.ts:88-104`, fetches 5 most recent L2 corrections                        |
| Case-insensitive dedup                 | ⚠️ Gap         | Line 881 uses case-sensitive `includes()` — "AuthModule" ≠ "authmodule"           |
| LLM response validation                | ⚠️ Gap         | No validation that returned objects have `name` field; `undefined` names possible |
| Rate limiting between batches          | ⚠️ Gap         | No delay between batch LLM calls                                                  |
| Retry logic for failed batches         | ⚠️ Gap         | Single batch failure aborts entire bootstrap                                      |
| Test coverage for self-correction      | ⚠️ Gap         | No tests with >20 commits; no tests verify `previousBatchSection`                 |
| Strong self-correction prompt language | ⚠️ Gap         | "maintain consistency" is a soft suggestion, not a hard requirement               |
| Self-correction quality metrics        | ⚠️ Gap         | No visibility into cross-batch consistency for human reviewers                    |

## Gaps & Recommendations

1. **Add case-insensitive deduplication** in the bootstrap loop (`generate.ts:881`): normalize module names to lowercase before comparing and storing in `previousL2Names`. Consider also normalizing hyphens/underscores.

2. **Validate LLM response structure** in `generateL2Nodes()` (`generate.ts:267-272`): after parsing, filter out any items missing a `name` field and log a warning. This prevents `undefined` from polluting `previousL2Names`.

3. **Add rate limiting and retry logic** to the bootstrap loop (`generate.ts:869-886`): add a configurable delay (e.g., 500ms) between batches and retry up to 3 times on transient failures (429, 500), matching the pattern already used in `condenseL3Node()`.

4. **Strengthen the self-correction prompt instruction** (`generate.ts:248`): change "maintain consistency with these names" to a more explicit directive like "You MUST use these exact module names when the same component appears. Do NOT create duplicate or renamed variants."

5. **Add integration tests for self-correction**: create a test with >20 commits that verifies:
   - `previousL2Names` grows across batches
   - The `previousBatchSection` appears in batch 2+'s prompt
   - Duplicate module names are deduplicated
   - Few-shot corrections are included in all batch prompts

6. **Add cross-batch consistency metrics** to the confirm-bootstrap response (`l2_nodes.ts`): report how many modules were discovered, how many were renamed/merged across batches, and flag potential duplicates for human review.

---

### Item 4.2.3 — L2 module map confirmation UI

- **Status:** `WARN`
- **Report File:** [0258_4.2.3.md](./reports/0258_4.2.3.md)

**Report Findings:**

## Summary

| Aspect                              | Status         | Details                                                                                    |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| Confirmation UI component exists    | ✅ Implemented | `L2BootstrapReview.tsx` — 243 lines, full approve/reject/edit UI                           |
| Integrated into project detail page | ✅ Implemented | Conditional tab in `[id].tsx` (lines 569–575), badge with unconfirmed count                |
| Backend confirm endpoint            | ✅ Implemented | `POST /projects/:id/l2-nodes/confirm-bootstrap` — approval, rejection, config.yaml writing |
| Grouping by L1 tags                 | ✅ Implemented | `groupedNodes` memoized map (lines 45–61)                                                  |
| Path pattern editing                | ✅ Implemented | Comma-separated input per module (lines 222–230)                                           |
| Approve All shortcut                | ✅ Implemented | `handleApproveAll` (lines 83–89)                                                           |
| Empty/no-modules state              | ✅ Implemented | Friendly message when no unconfirmed nodes (lines 74–81)                                   |
| Module detail (commits, L3 count)   | ⚠️ Gap         | No visibility into which commits contributed or L3 impact                                  |
| Rejection warning/confirmation      | ⚠️ Gap         | No explanation of rejection consequences                                                   |
| Glob pattern comma handling         | ⚠️ Bug         | Comma-containing globs like `src/{a,b}/**` will be incorrectly split                       |
| Client-side validation              | ⚠️ Gap         | No validation of path patterns, no "review all" check                                      |
| Audit log for confirmation          | ⚠️ Gap         | No `activity_log` entry on bootstrap confirmation                                          |
| Test coverage (UI + endpoint)       | ⚠️ Gap         | No unit or integration tests for confirmation flow                                         |
| VS Code extension confirmation UI   | ⚠️ Gap         | Only in web frontend; VS Code users must switch to confirm                                 |
| Batch submit state reset            | ⚠️ Gap         | Local state not cleared after successful submission                                        |
| Config write error handling         | ⚠️ Gap         | Failed `.docuvia/config.yaml` write doesn't fail the request                               |

## Gaps & Recommendations

1. **Add module detail to confirmation cards** (`L2BootstrapReview.tsx`): Show commit count and L3 node count for each module. Consider linking to a detail view or showing a preview of contributing commits. This gives the reviewer context to make informed decisions.

2. **Add rejection confirmation dialog** (`L2BootstrapReview.tsx`): Before submitting with rejections, show a confirmation dialog explaining that rejected modules' commits will be moved to "Uncategorized."

3. **Fix comma-containing glob handling** (`L2BootstrapReview.tsx:224-229`): Instead of comma-separated input, use one input per path pattern with an "Add Pattern" button, or usenewline-separated values. This prevents splitting globs that contain commas.

4. **Add client-side validation** (`L2BootstrapReview.tsx:91-119`):
   - Require non-empty path patterns for approved modules
   - Warn if not all modules have been decided
   - Validate glob syntax before submission

5. **Add activity log entry** (`l2_nodes.ts:151`): After successful confirmation, insert into `activity_log` with type `bootstrap_confirmed` describing how many modules were approved/rejected.

6. **Add tests**:
   - Unit tests for `L2BootstrapReview.tsx` covering approve, reject, approve-all, submit with mixed decisions
   - Integration test for `POST /projects/:id/l2-nodes/confirm-bootstrap` covering approval, rejection, commit reassignment, and config.yaml writing

7. **Add VS Code extension confirmation UI**: Implement a QuickPick or Webview panel in the VS Code extension that provides equivalent L2 module map confirmation, so VS Code-only users don't need to switch to the web frontend.

8. **Reset local state on success** (`L2BootstrapReview.tsx:32-34`): In the `onSuccess` callback, call `setDecisions({})` and `setPathEdits({})` to clear the form after successful submission.

---

### Item 4.2.4 — Path pattern storage in .docuvia/config.yaml

- **Status:** `WARN`
- **Report File:** [0259_4.2.4.md](./reports/0259_4.2.4.md)

**Report Findings:**

## Summary

| Aspect                               | Status         | Details                                                                     |
| ------------------------------------ | -------------- | --------------------------------------------------------------------------- |
| config.yaml writing logic exists     | ✅ Implemented | `l2_nodes.ts:98-149` — queries confirmed nodes, sorts by depth, writes YAML |
| Glob specificity sorting             | ✅ Implemented | Depth-based sorting, most specific patterns first (lines 111–133)           |
| YAML structure matches ADR-010       | ✅ Implemented | `modules:` array with `{id, name, pathPatterns}`                            |
| Path patterns stored in DB           | ✅ Implemented | `l2NodesTable.pathPatterns` JSONB column                                    |
| Generate pipeline uses path patterns | ✅ Implemented | `generate.ts:766-797` — path-rule mode when all bootstrap confirmed         |
| Human-readable format                | ✅ Implemented | YAML with clear structure, editable without AI                              |
| repoUrl as filesystem path           | ⚠️ Bug         | Remote URLs cause invalid filesystem paths                                  |
| Transaction safety (DB + file)       | ⚠️ Gap         | Partial failure leaves DB committed but config.yaml unwritten               |
| Config write error handling          | ⚠️ Gap         | Write failure returns 500 after DB changes are already applied              |
| Path pattern validation              | ⚠️ Gap         | No glob syntax or sanitization validation before file write                 |
| Config.yaml is read by system        | ⚠️ Gap         | System reads from DB, not from config.yaml — file is one-way export         |
| Orphan branch integration            | ⚠️ Gap         | config.yaml not written to orphan branch, not versioned in git              |
| Glob sorting code duplication        | ⚠️ Risk        | Same algorithm in `l2_nodes.ts` and `generate.ts`                           |
| Comma-separated glob parsing         | ⚠️ Bug         | Globs containing commas (e.g., `src/{a,b}/**`) split incorrectly            |
| Test coverage                        | ⚠️ Gap         | No tests for config.yaml writing, sorting, or edge cases                    |

## Gaps & Recommendations

1. **Fix `repoUrl` handling for config.yaml writing** (`l2_nodes.ts:143`): Use a local working directory path instead of `repoUrl`. The server should maintain a working copy of each project repo, or the config.yaml should be written to the orphan branch via the orphan branch writer.

2. **Wrap DB + file write in a transaction** (`l2_nodes.ts:33-156`): Either make the file write part of a compensating transaction pattern, or write the config.yaml first and roll back on failure. At minimum, if the file write fails, revert the DB changes.

3. **Add path pattern validation** (`l2_nodes.ts:48-56`): Validate that path patterns are non-empty and contain valid glob syntax before writing to config.yaml. Consider using a glob validation library.

4. **Integrate config.yaml writing with the orphan branch** (`l2_nodes.ts:143-148`): Use the orphan branch writer to commit the config.yaml to the `docuvia-knowledge` branch, making it versioned and fetchable by other developers.

5. **Make config.yaml the source of truth** OR **remove the fiction that it is**: Either update the generate pipeline to read path patterns from config.yaml (making it a true config file), or document clearly that the DB is the source of truth and config.yaml is a read-only export.

6. **Extract glob sorting into a shared utility**: Create a shared module for `getStaticDepth` and `getMaxDepth` to avoid duplication between `l2_nodes.ts` and `generate.ts`.

7. **Fix comma-separated glob parsing** (`L2BootstrapReview.tsx:224-229`): Use one input per path pattern with an "Add Pattern" button, or use newline-separated values instead of comma-separated.

8. **Add tests**: Integration tests for the confirm-bootstrap endpoint that verify config.yaml content, sorting order, and error handling for invalid repo paths.

---

### Item 4.2.5 — Deterministic commit-to-module assignment via glob matching

- **Status:** `WARN`
- **Report File:** [0260_4.2.5.md](./reports/0260_4.2.5.md)

**Report Findings:**

## Summary

| Aspect                                 | Status         | Details                                                                                                                      |
| -------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Path-rule mode implemented             | ✅ Implemented | `generate.ts:771-863` — glob-to-RegExp matching when all bootstrap confirmed                                                 |
| Glob specificity sorting               | ✅ Implemented | Depth-based sorting, most specific patterns first (`getStaticDepth`)                                                         |
| Deterministic first-match wins         | ✅ Implemented | Sorted array + `break` on first match (line 839)                                                                             |
| Fallback to sys-uncategorized          | ✅ Implemented | Unmatched commits assigned to sys node (line 844)                                                                            |
| commit_l2_links junction table used    | ✅ Implemented | `commitL2LinksTable.insert()` with `.onConflictDoNothing()` (lines 852–858)                                                  |
| Custom globToRegExp correctness        | ⚠️ Bug         | `**` (zero directories) not handled; character classes escaped; `{a,b}` not handled; works "by accident" for simple patterns |
| StartsWith path matching in L3 scoring | ⚠️ Bug         | `generate.ts:472` — `sourceFile.startsWith(p)` doesn't handle glob wildcards; W3 score is effectively useless                |
| Server/client glob consistency         | ⚠️ Gap         | Server uses custom RegExp; VS Code client uses `minimatch` — same pattern can match differently                              |
| Pattern validation                     | ⚠️ Gap         | No glob syntax validation before DB storage or RegExp conversion                                                             |
| Equal-depth pattern disambiguation     | ⚠️ Gap         | No tiebreaker for patterns with same static depth                                                                            |
| Test coverage                          | ⚠️ Gap         | Zero tests for glob matching, specificity scoring, path-rule mode, or edge cases                                             |
| Orphan branch integration              | ⚠️ Gap         | Path-rule assignments only in DB, not in git-isomorphic knowledge graph                                                      |
| Glob sorting code duplication          | ⚠️ Risk        | Same algorithm in `l2_nodes.ts` and `generate.ts`                                                                            |
| Mixed-era code in generate.ts          | ⚠️ Tech Debt   | L3 scoring W3 path check is vestigial and incompatible with glob patterns                                                    |

## Gaps & Recommendations

1. **Replace custom `globToRegExp` with `minimatch` or `picomatch`** (`generate.ts:799–803`): The custom glob-to-RegExp function has subtle bugs with `**` (zero directories), character classes, and brace expansion. Use the same `minimatch` library already used by the VS Code client for consistency. This also fixes the server/client inconsistency (Finding 9).

2. **Remove or fix the W3 `startsWith` path matching** (`generate.ts:470–474`): The `sourceFile.startsWith(p)` check is incompatible with glob patterns. Either remove the W3 path score entirely (since path-rule mode handles L2 assignment before L3 scoring), or convert it to use the same glob matching as path-rule mode.

3. **Add glob pattern validation** (`l2_nodes.ts:48–56`): Validate path patterns are syntactically valid globs before storing in the database. Reject or warn on invalid patterns at the API level.

4. **Add tiebreaker for equal-depth patterns** (`generate.ts:795–797`): When two patterns have the same static depth, add a secondary sort key (e.g., pattern length, module ID, or alphabetical) to ensure fully deterministic ordering.

5. **Extract glob sorting into a shared utility**: Create a shared module for `getStaticDepth`, `getMaxDepth`, and `globToRegExp` to eliminate duplication between `l2_nodes.ts` and `generate.ts`.

6. **Add comprehensive tests**: Unit tests for `globToRegExp` (or the replacement library), `getStaticDepth`, specificity sorting, and the full path-rule mode assignment loop with overlapping patterns, edge cases, and the sys-uncategorized fallback.

7. **Integrate path-rule assignments with the orphan branch**: After deterministic L2 assignment, write the results to the `docuvia-knowledge` orphan branch so VS Code clients can read them without a server connection.

8. **Document the two path-matching modes**: Clearly document that path-rule mode (bootstrap-confirmed) uses glob matching, while bootstrap mode uses AI discovery. The L3 scoring W3 path check should be documented as deprecated or removed.

---

### Item 4.3.2 — Phase 2: Merge Gate — branch merge status check

- **Status:** `WARN`
- **Report File:** [0263_4.3.2.md](./reports/0263_4.3.2.md)

**Report Findings:**

## Summary

| Aspect                       | Status       | Details                                                      |
| ---------------------------- | ------------ | ------------------------------------------------------------ |
| Webhook merge→valid          | ✅ Working   | PR merge correctly promotes L3 nodes to valid                |
| Orphaned status transition   | ❌ Missing   | Closed-without-merge doesn't set orphaned; no code path does |
| Polling fallback             | ⚠️ Dead code | Metabolism logic exists but is never auto-triggered          |
| `checkCommitInDefaultBranch` | ✅ Correct   | GitHub Compare API usage is semantically right               |
| `branchName` population      | ❌ Missing   | Column exists in schema but is never written                 |
| Default branch detection     | ⚠️ Hardcoded | Always assumes `main`; no per-project config                 |
| Test coverage                | ❌ None      | Zero tests for merge gate logic                              |
| Metabolism endpoint auth     | ⚠️ Insecure  | `/metabolism-tick` is unauthenticated                        |

## Gaps & Recommendations

1. **Set L3 nodes to `orphaned` on PR close-without-merge.** In `github_webhooks.ts:341-350`, after setting PR state to `"closed"`, fetch the PR's commit hashes and update associated L3 nodes from `pending` → `orphaned`. This is the most critical gap — without it, abandoned branches pollute the knowledge graph.

2. **Auto-trigger the metabolism polling fallback.** Add an internal scheduler (e.g., `setInterval` in `app.ts` or a cron-triggered HTTP call) to hit `/metabolism-tick` periodically (e.g., every 6 hours). Without this, the polling path is dead code.

3. **Populate `branchName` during ingestion.** In `ingest.ts` and `github_webhooks.ts`, write the branch name to `commits.branchName`. The git-client already reads it (`git-client.ts:122-123`); it just needs to be included in the `insert()` call.

4. **Make default branch configurable per project.** Add a `defaultBranch` column to `projectsTable` or read it from the GitHub API (`repository.default_branch` in the webhook payload — it's already available at `payload.repository.default_branch`).

5. **Add tests for merge gate logic.** Create integration tests that: (a) fire a PR-merged webhook and verify L3→valid, (b) fire a PR-closed webhook and verify L3→orphaned, (c) call metabolism-tick and verify pending L3 nodes are correctly promoted.

6. **Secure the `/metabolism-tick` endpoint.** Add authentication or remove the unauthenticated route in production. The admin endpoint already has token auth — the public one should too.

---

### Item 4.3.3 — L3 validity status enum: pending | valid | orphaned

- **Status:** `WARN`
- **Report File:** [0264_4.3.3.md](./reports/0264_4.3.3.md)

**Report Findings:**

## Summary

| Aspect                          | Status     | Details                                                  |
| ------------------------------- | ---------- | -------------------------------------------------------- |
| Schema column exists            | ✅ Done    | `validityStatus text` on `l3_nodes` and `commits`        |
| DB-level enum constraint        | ❌ Missing | Plain text column; no `pgEnum` defined                   |
| Default value "pending"         | ✅ Done    | `.default("pending")` on both tables                     |
| "valid" transition (webhook)    | ✅ Done    | PR merge correctly promotes L3→valid                     |
| "valid" transition (metabolism) | ✅ Done    | Metabolism promotes merged commits→valid                 |
| "orphaned" transition           | ❌ Missing | No code path ever writes "orphaned"                      |
| MCP default filter (4.3.4)      | ⚠️ Broken  | Intent is correct but `'active'` bug causes zero results |
| `include_pending` param (4.3.5) | ⚠️ Partial | Parameter exists but filter logic has `'active'` bug     |
| Export displays status          | ✅ Done    | Markdown export shows validityStatus                     |

## Gaps & Recommendations

1. **Fix the `'active'` → `"valid"` naming bug.** In `intent-router.ts:500,535` and `vector-search.ts:28`, change `'active'` to `"valid"`. This is a critical bug that silently breaks MCP queries and vector search when `includePending=false`.

2. **Add `"orphaned"` transition on PR close-without-merge.** In `github_webhooks.ts:341-350`, after setting PR state to `"closed"`, fetch the PR's commit hashes and update associated L3 nodes from `pending` → `orphaned`. This is the primary mechanism for marking abandoned knowledge.

3. **Add `"orphaned"` transition in metabolism fallback.** In `metabolism.ts`, after checking commits against the default branch, for nodes that are NOT merged AND are older than a threshold (e.g., 30 days), set `validityStatus` to `orphaned` instead of leaving them as `pending` forever.

4. **Add a `pgEnum` for `validity_status`.** Define `export const validityStatusEnum = pgEnum("validity_status", ["pending", "valid", "orphaned"])` and use it in both `l3_nodes.ts` and `commits.ts`. This ensures data integrity at the database level and is consistent with the pattern used for `l3_node_type`.

5. **Consider adding an orphaned cleanup mechanism.** For L3 nodes that have been `orphaned` for an extended period, consider automatic archival or deletion to prevent knowledge graph pollution.

---

### Item 4.3.4 — MCP query default filter: status = valid only

- **Status:** `WARN`
- **Report File:** [0265_4.3.4.md](./reports/0265_4.3.4.md)

**Report Findings:**

## Summary

| Aspect                             | Status       | Details                                               |
| ---------------------------------- | ------------ | ----------------------------------------------------- |
| MCP default `includePending=false` | ✅ Done      | Both `search_knowledge` and `query` default correctly |
| Parameter passes to `routeQuery()` | ✅ Done      | Consistent across both endpoints                      |
| Vector search filter               | ✅ Done      | Correctly filters `= "valid"`                         |
| Direct lookup filter               | ❌ Broken    | `'active'` bug — returns zero results                 |
| Graph traversal filter             | ❌ Missing   | No validityStatus filtering at all                    |
| Hybrid search filter               | ⚠️ Partial   | Vector filtered, graph not                            |
| `vector-search.ts` filter          | ❌ Broken    | `'active'` bug — returns zero results                 |
| Fast-path routing                  | ❌ Amplified | Routes to broken handlers                             |
| `get_decision_record` filter       | ❌ Missing   | No validityStatus filter                              |
| `list_projects` count              | ❌ Missing   | Counts all statuses                                   |

## Gaps & Recommendations

1. **Fix `'active'` → `"valid"` naming bug (CRITICAL).** In `intent-router.ts:500,535` and `vector-search.ts:28`, change `'active'` to `"valid"`. This is the same critical bug found in 4.3.3. Without this fix, MCP direct lookup queries always return empty results.

2. **Add `includePending` parameter to `graphTraversalHandler`.** The function signature should accept an `includePending` boolean and apply a validityStatus filter to L3 node queries. This is required for both the graph traversal strategy and hybrid search to work correctly.

3. **Add validityStatus filter to `get_decision_record` MCP endpoint.** When looking up decisions by commit hash, pending L3 nodes should be excluded by default. Add an `include_pending` query parameter with the same default-false pattern.

4. **Fix `list_projects` L3 count accuracy.** Either filter to `validityStatus = "valid"` or provide separate counts for valid vs pending nodes so MCP clients get accurate project statistics.

5. **Consider adding `include_pending` support to all MCP endpoints.** For consistency, every endpoint that returns L3 nodes should support the `include_pending` parameter with a default of `false`.

6. **The `|| false` pattern is redundant.** `req.query.include_pending === "true" || false` can be simplified to `req.query.include_pending === "true"` which already evaluates to a boolean. The `|| false` adds no value and could mask type issues.

---

### Item 4.3.5 — include_pending=true query parameter

- **Status:** `WARN`
- **Report File:** [0266_4.3.5.md](./reports/0266_4.3.5.md)

**Report Findings:**

## Summary

| Aspect                                     | Status     | Details                                                |
| ------------------------------------------ | ---------- | ------------------------------------------------------ |
| Parameter exists on primary MCP endpoints  | ✅ Done    | `search_knowledge` and `query` both support it         |
| Default value correct (`false`)            | ✅ Done    | Both default to `false` when absent                    |
| Parameter passes to `routeQuery()`         | ✅ Done    | Consistent across both endpoints                       |
| Vector search respects `include_pending`   | ✅ Done    | Correctly toggles between `=valid` and `valid+pending` |
| Direct lookup respects `include_pending`   | ❌ Broken  | `'active'` bug — handler never returns results         |
| Graph traversal respects `include_pending` | ❌ Missing | Handler doesn't accept the parameter                   |
| Hybrid search respects `include_pending`   | ⚠️ Partial | Vector filtered, graph not                             |
| Secondary MCP endpoints support it         | ❌ Missing | `get_decision_record`, `list_projects`                 |
| Web UI search supports it                  | ❌ Missing | `/search` route doesn't expose parameter               |
| VS Code extension supports it              | ❌ Missing | `vscodeQuery()` doesn't expose parameter               |

## Gaps & Recommendations

1. **Fix `'active'` → `'valid'` naming bug (CRITICAL).** In `intent-router.ts:500,535` and `vector-search.ts:28`, change `'active'` to `'valid'`. This is the same critical bug found in 4.3.3 and 4.3.4. Without this fix, `include_pending` has no effect on direct lookup queries — the handler always returns empty.

2. **Add `includePending` parameter to `graphTraversalHandler`.** The function signature must accept an `includePending` boolean and apply a `validityStatus` filter to L3 node queries. This is required for both graph traversal strategy and hybrid search to respect `include_pending`.

3. **Add `include_pending` support to `get_decision_record` MCP endpoint.** When looking up decisions by commit hash, pending L3 nodes should be excluded by default. Add the query parameter with the same default-false pattern.

4. **Add `include_pending` support to `list_projects` MCP endpoint.** Either filter to `validityStatus = "valid"` or provide separate counts for valid vs pending nodes.

5. **Expose `include_pending` on the Web UI search route.** The `/search` POST endpoint currently hardcodes the default behavior. Add an optional `include_pending` field to the request body schema.

6. **Expose `include_pending` on `vscodeQuery()`.** The VS Code extension bridge should forward `include_pending` to `routeQuery()` so extension users can also request pending nodes.

7. **The `|| false` pattern is redundant.** `req.query.include_pending === "true" || false` simplifies to `req.query.include_pending === "true"` which already evaluates to a boolean. While not a bug, it's noise that could be cleaned up during the fix pass.

---

### Item 4.3.7 — Schema: branchName column on commits

- **Status:** `WARN`
- **Report File:** [0268_4.3.7.md](./reports/0268_4.3.7.md)

**Report Findings:**

## Summary

| Aspect                                           | Status     | Details                                                |
| ------------------------------------------------ | ---------- | ------------------------------------------------------ |
| `commits.branchName` column in Drizzle schema    | ✅ Done    | `text("branch_name")`, nullable                        |
| Column in migration SQL                          | ✅ Done    | `"branch_name" text` in `0000_short_ezekiel.sql`       |
| `GitCommitData.branchName` interface field       | ✅ Done    | Defined in `git-client.ts:18`                          |
| `getCurrentBranchName()` method                  | ✅ Done    | Implemented in `git-client.ts:117-128`                 |
| `GitCommitItem` includes `branchName`            | ❌ Missing | Interface drops the field                              |
| `processIngestion` writes `branchName`           | ❌ Missing | Insert omits the column                                |
| GitHub webhook writes `branchName`               | ❌ Missing | Insert omits the column                                |
| REST API `CreateCommitBody` accepts `branchName` | ❌ Missing | Zod schema omits the field                             |
| Test factory sets `branchName`                   | ❌ Missing | Not in default build                                   |
| Downstream merge-gate impact                     | ⚠️ Low     | Current merge logic uses PR metadata, not `branchName` |
| Orphan detection (4.3.8) impact                  | ⚠️ Medium  | Cannot detect orphaned commits without branch info     |

## Gaps & Notes

1. **Data flow break at `GitCommitItem`.** The `GitCommitData` interface has `branchName`, but when `ingest.ts:62-65` maps to `GitCommitItem`, the field is dropped. This is the root cause.

2. **Fix is straightforward:** Add `branchName?: string` to `GitCommitItem`, pass it through in `ingest.ts:62`, and include it in the `tx.insert(commitsTable).values({...})` call in `ingestion-pipeline.ts:90-97`.

3. **The `getCurrentBranchName()` method is unused dead code.** It was presumably added to support this feature but the call site was never implemented. It could be called during git ingest to populate `branchName` for all commits in a batch (they all share the same branch in a clone).

4. **The REST API `CreateCommitBody` also needs updating** if manual commit creation should support branch assignment.

5. **Impact on 4.3.8:** Item 4.3.8 (Branch merge status tracking) may require `branchName` to implement proper orphan detection when a PR is closed without merging. This is a dependency to track.

## Final Verdict: WARN

The `branchName` column is correctly defined in the schema and migration SQL, and the source data is available via `GitCommitData` / `getCurrentBranchName()`. However, the data flow has a break: the `GitCommitItem` interface drops the field, and no write path (ingest pipeline, webhook, REST API) populates the column. The column is effectively unused. The fix is straightforward (wire the field through the pipeline) but until fixed, the feature is incomplete. The immediate functional impact is low because the current merge-gate uses PR metadata rather than commit-level branch tracking.

---

### Item 4.3.8 — Branch merge status tracking (GitHub webhook or polling)

- **Status:** `WARN`
- **Report File:** [0269_4.3.8.md](./reports/0269_4.3.8.md)

**Report Findings:**

## Summary

| Aspect                                    | Status     | Details                                                 |
| ----------------------------------------- | ---------- | ------------------------------------------------------- |
| Webhook merge detection (primary path)    | ✅ Done    | PR merge → L3 "valid" promotion works correctly         |
| Metabolism fallback (polling path)        | ⚠️ Partial | Logic correct but no automatic trigger mechanism        |
| `checkCommitInDefaultBranch()` API call   | ✅ Done    | Correctly uses GitHub compare API                       |
| Orphan detection (PR close without merge) | ❌ Missing | L3 nodes remain "pending" — never set to "orphaned"     |
| Metabolism "orphaned" transition          | ❌ Missing | Only promotes to "valid", no else branch                |
| `commits.branchName` populated            | ❌ Missing | Column exists but no write path (dependency from 4.3.7) |
| Hardcoded "main" default branch           | ⚠️ Low     | No per-project default branch config                    |
| Cron/scheduled trigger for metabolism     | ❌ Missing | Only manual HTTP endpoints                              |

## Gaps & Notes

1. **Metabolism scheduling gap:** The metabolism job is the only "polling" mechanism for merge status, but it has no cron trigger. In a production deployment, if nobody calls `/admin/metabolism-tick`, pending L3 nodes will never be promoted to "valid" via the fallback path (only webhook-triggered merges would work). A cron job or in-process scheduler (e.g., `setInterval`) should be configured.

2. **Orphan detection is a critical ADR-011 gap:** The `orphaned` status value exists in the schema enum but is never written. This means:
   - Abandoned feature branch commits' L3 nodes stay "pending" forever
   - They appear in queries when `include_pending=true`
   - The knowledge graph accumulates stale entries from discarded design attempts
   - This directly contradicts ADR-011's primary benefit: "Abandoned design attempts do not contaminate the canonical knowledge graph"

3. **Fixing orphan detection requires:**
   - In the webhook `closed` (not merged) handler: Find L3 nodes associated with PR commits and set `validityStatus = "orphaned"`
   - In the metabolism fallback: For commits confirmed NOT in default branch (after sufficient time), set `validityStatus = "orphaned"`
   - This depends on `commits.branchName` being populated (item 4.3.7) for proper branch-level tracking

4. **Hardcoded "main" branch in `checkCommitInDefaultBranch()`:** The function accepts a `defaultBranch` parameter (defaulting to `"main"`), but callers always use the default. The `projectsTable` does not have a `defaultBranch` column, so there's no way to configure per-project default branches. This could cause incorrect results for repos using `"master"` or other default branch names.

## Dependency Chain

```
4.3.7 (branchName populated) ──blocks──> 4.3.8 (orphan detection)
     │                                          │
     └── Schema exists but data flow broken     └── Orphan logic missing entirely
```

Even without 4.3.7 being fixed, orphan detection could be implemented at the PR level (when a PR is closed without merge, mark its L3 nodes as orphaned). The `branchName` column would be needed for more granular commit-level orphan detection (e.g., commits pushed directly to a branch without a PR).

## Final Verdict: WARN

The primary merge tracking path (GitHub webhook → PR merge → L3 "valid") is correctly implemented and functional. The fallback metabolism logic is sound but lacks an automatic trigger mechanism. The critical gap is the missing orphan detection: the "orphaned" status from ADR-011 is never written anywhere, meaning abandoned-branch knowledge nodes accumulate indefinitely. This is a medium-severity design conformance gap that undermines ADR-011's primary benefit. The fix is straightforward (add else branch in webhook handler and metabolism) but is currently entirely absent.

---

### Item 4.4.4 — Project association flow (promote to pipeline)

- **Status:** `WARN`
- **Report File:** [0273_4.4.4.md](./reports/0273_4.4.4.md)

**Report Findings:**

## Summary

| Aspect                                           | Status      | Details                                                |
| ------------------------------------------------ | ----------- | ------------------------------------------------------ |
| API endpoint sets `projectId` and `affiliatedAt` | ✅ Done     | `POST /documents/:id/affiliate`                        |
| `status` transitions to `"affiliated"`           | ✅ Done     | Explicit in UPDATE query                               |
| Zod validation on request body                   | ✅ Done     | `AffiliateBodySchema`                                  |
| Project existence check                          | ✅ Done     | Returns 404 if not found                               |
| Generate pipeline picks up affiliated docs       | ✅ Done     | Fetches all documents by `projectId`                   |
| `contentHash` dedup prevents re-processing       | ✅ Done     | In `processIngestion()`                                |
| Frontend Misc Pool tab + Associate dialog        | ✅ Done     | Full UI flow in `documents.tsx`                        |
| Generated React Query hooks                      | ✅ Done     | `useAffiliateDocument`                                 |
| OpenAPI spec documents endpoint                  | ✅ Done     | `/documents/{id}/affiliate`                            |
| Auto-trigger generate after affiliation          | ❌ Not done | No call to generate pipeline in affiliate endpoint     |
| `contentHash` check at affiliation time          | ⚠️ Deferred | Dedup happens in generate pipeline, not at affiliation |

## Gaps & Notes

1. **No auto-trigger of generate pipeline.** The affiliate endpoint only sets `projectId`/`affiliatedAt`/`status` — it does NOT call `processIngestion()` or trigger a generate run. ADR-012 says "on next run," which implies the next manual generate run. This is a design choice, not a bug, but it means the document sits idle until the user manually triggers generation. A future improvement could be an optional `?triggerGenerate=true` query parameter.

2. **`contentHash` dedup is deferred.** The affiliate endpoint does not check whether the document has already been processed for the target project. The dedup happens in `processIngestion()` during the next generate run. This is functionally correct but means the user could associate a document that was already ingested without getting immediate feedback about the duplicate.

3. **No feedback on affiliation success beyond list refresh.** After associating, the Misc Pool list refreshes (removing the document), but there is no toast/notification confirming the association or informing the user that they need to trigger a generate run to process the document.

4. **No test coverage for the affiliate endpoint.** There are no unit or integration tests for `POST /documents/:id/affiliate`. The endpoint is straightforward but should have at least a basic test verifying the `projectId` assignment and the 404 cases.

5. **Frontend routing discrepancy (minor).** The frontend `handleIngest` function (line 118-120) uses `/api/documents/ingest` for Misc Pool uploads, but the backend route is `POST /documents` (without `/ingest`). This doesn't affect the association flow but is a separate routing issue.

## Final Verdict: WARN

The project association flow is functionally complete: the API endpoint correctly sets `projectId`, `affiliatedAt`, and `status`; the generate pipeline picks up affiliated documents on the next run; `contentHash` dedup prevents re-processing; and the frontend provides a full UI for browsing the Misc Pool and associating documents with projects. The WARN status reflects two gaps: (1) no automatic generate trigger after affiliation (document sits idle until manual generate), and (2) no `contentHash` check at affiliation time for immediate duplicate feedback. Both are design choices consistent with ADR-012's "on next run" wording, but they represent a less-than-ideal user experience.

---

### Item 4.4.5 — Web UI: Misc Pool view + "Associate with Project" action

- **Status:** `WARN`
- **Report File:** [0274_4.4.5.md](./reports/0274_4.4.5.md)

**Report Findings:**

## Summary

| Aspect                                | Status     | Details                                                           |
| ------------------------------------- | ---------- | ----------------------------------------------------------------- |
| Misc Pool tab UI                      | ✅ Done    | Complete with list, count badge, empty/error/loading states       |
| "Associate with Project" button       | ✅ Done    | Per-document button with dialog                                   |
| Affiliate dialog                      | ✅ Done    | Project selector, confirm/cancel, error/loading states            |
| Backend GET /documents/misc           | ✅ Done    | Lists unaffiliated documents                                      |
| Backend POST /documents/:id/affiliate | ✅ Done    | Sets projectId, affiliatedAt, status                              |
| Generated React Query hooks           | ✅ Done    | useListMiscDocuments, useAffiliateDocument                        |
| OpenAPI spec for misc endpoints       | ✅ Done    | Both endpoints documented                                         |
| Upload to Misc Pool via Web UI        | ❌ Broken  | Frontend calls `/api/documents/ingest`, backend has no such route |
| POST /documents in OpenAPI spec       | ❌ Missing | Upload endpoint not in spec                                       |
| Test coverage                         | ❌ None    | No tests for any misc pool endpoint                               |
| Auth on affiliate endpoint            | ⚠️ Missing | No authentication middleware                                      |
| `validityStatus` value consistency    | ⚠️         | `'pending_affiliation'` not aligned with ADR-011                  |

## Gaps & Recommendations

1. **[CRITICAL] Fix misc pool upload routing.** Change `documents.tsx:120` from `/api/documents/ingest` to `/api/documents`. The backend `POST /documents` endpoint exists with `documentUpload.single("file")` middleware and correctly handles unaffiliated uploads. This is a one-line fix that unblocks the entire Misc Pool upload flow.

2. **[HIGH] Add `POST /documents` to OpenAPI spec.** The upload endpoint exists in the backend but is missing from `openapi.yaml`. Add it under the `documents` tag with `operationId: uploadDocument` and appropriate request/response schemas. Then run Orval codegen to generate the corresponding React Query hook.

3. **[MEDIUM] Add authentication to affiliate endpoint.** The `POST /documents/:id/affiliate` endpoint should require authentication and verify the caller has access to the target project.

4. **[MEDIUM] Align `validityStatus` values.** The `'pending_affiliation'` value set during upload should be reconciled with the ADR-011 validity status enum (`pending`, `valid`, `orphaned`). Consider using `status: 'unaffiliated'` (which already exists) as the sole discriminator and leaving `validityStatus` as the default `"active"`.

5. **[LOW] Add test coverage.** Write integration tests for:
   - `GET /documents/misc` — returns only unaffiliated documents
   - `POST /documents/:id/affiliate` — sets projectId, returns 404 for missing doc/project
   - `POST /documents` — uploads file, computes contentHash, sets status to unaffiliated

## Final Verdict: ⚠️ WARN

The Web UI Misc Pool view and "Associate with Project" action are **fully implemented and functional** — the tab rendering, document list, affiliate dialog, project selector, mutation handling, and query invalidation all work correctly. The backend endpoints for listing and affiliating are also complete with proper validation.

However, the verdict is **WARN** due to one critical gap: the **misc pool upload flow is broken** because the frontend calls `/api/documents/ingest` which doesn't exist on the backend. This means users cannot upload new documents to the Misc Pool via the Web UI — they can only associate existing ones. Additionally, there is no test coverage for any misc pool functionality, and the upload endpoint is missing from the OpenAPI spec.

---

### Item 5.1.1 — ️ Review task creation for all AI-generated nodes

- **Status:** `WARN`
- **Report File:** [0276_5.1.1.md](./reports/0276_5.1.1.md)

**Report Findings:**

## Summary

| Aspect                                            | Status     | Details                                   |
| ------------------------------------------------- | ---------- | ----------------------------------------- |
| Review task schema supports all entity types      | ✅ Done    | L1/L2/L3 all supported                    |
| Review task schema supports all task types        | ✅ Done    | anchor/correct/validate/merge             |
| L1 tags get review tasks                          | ✅ Done    | Immediate anchor task on creation         |
| L2 nodes get review tasks                         | ✅ Done    | Post-processing validate task             |
| L3 nodes (low confidence) get review tasks        | ✅ Done    | Conditional validate task                 |
| L3 nodes (high confidence ≥ 0.8) get review tasks | ⚠️ **Gap** | No review task created                    |
| Condensed L3 nodes get review tasks               | ✅ Done    | Conditional on condensationReviewRequired |
| Noise detection creates tasks                     | ✅ Done    | anchor/merge for L1 issues                |
| Cross-project detection creates tasks             | ✅ Done    | merge task for similar L2 nodes           |
| Deduplication prevents duplicates                 | ✅ Done    | All creation sites check first            |
| Idempotency across runs                           | ✅ Done    | Incremental mode + dedup                  |

## Final Verdict: ⚠️ WARN

Review task creation is implemented for the vast majority of AI-generated nodes:

- **L1 tags**: Every new AI-generated L1 tag gets an `anchor` review task.
- **L2 nodes**: Every new or updated AI-generated L2 node gets a `validate` review task (via post-processing loop with deduplication).
- **L3 nodes (low confidence)**: Nodes with confidence < 0.8 get a `validate` review task.
- **L3 nodes (condensed)**: Nodes that reach the condensation threshold get a `validate` review task.
- **Supplementary**: Noise detection and cross-project link detection create additional `anchor` and `merge` tasks.

**Gap**: High-confidence L3 nodes (confidence ≥ 0.8) do **not** receive a review task. This is a deviation from ADR-006 which states "All AI-generated nodes are created with `status: "pending"` in `review_tasks`." The confidence threshold at line 1045 of `generate.ts` should either be removed (to create tasks for all L3 nodes) or the design spec should be updated to document this intentional exemption.

---

### Item 5.1.2 — Review task types: anchor, merge, reject

- **Status:** `WARN`
- **Report File:** [0277_5.1.2.md](./reports/0277_5.1.2.md)

**Report Findings:**

## Summary

| Aspect                       | Status           | Details                                   |
| ---------------------------- | ---------------- | ----------------------------------------- |
| `anchor` task type defined   | ✅               | In schema, OpenAPI, Zod types             |
| `anchor` task type used      | ✅               | L1 tag creation + noise detection         |
| `merge` task type defined    | ✅               | In schema, OpenAPI, Zod types             |
| `merge` task type used       | ✅               | Cross-project links + near-duplicate tags |
| `validate` task type defined | ✅               | In schema, OpenAPI, Zod types             |
| `validate` task type used    | ✅               | L2/L3 node creation + condensation        |
| `correct` task type defined  | ✅               | In schema, OpenAPI, Zod types             |
| `correct` task type used     | ❌ **Dead code** | Never created anywhere                    |
| "Reject" as task type        | ❌ Mislabeled    | It's a resolution status, not a task type |
| UI displays task types       | ✅               | Shown in card header                      |
| Resolution handles all types | ✅               | Generic approve/reject/defer + correction |

## Final Verdict: ⚠️ WARN

The review task type system is **functionally implemented** for three of four defined types:

- **`anchor`**: Properly used for L1 tag review (new tags + noise detection).
- **`merge`**: Properly used for cross-project similarity and near-duplicate detection.
- **`validate`**: Properly used for L2/L3 node verification.

**Issues:**

1. **`correct` is dead code** — The `correct` task type is defined in the database schema, OpenAPI spec, and Zod types, but no code in the codebase ever creates a review task with `taskType: "correct"`. It should either be removed from the schema/spec or implemented. The correction capability is already built into the resolution flow generically (any task type can have a `correctedValue`), so a separate `correct` type may be unnecessary.

2. **Checklist description is imprecise** — Item 5.1.2 says "anchor, merge, reject" but "reject" is a resolution status, not a task type. The actual task types are `anchor`, `correct`, `validate`, and `merge`. The checklist description should be updated to match the actual schema, or the schema should be aligned with the intended design.

---

### Item 5.1.3 — Review resolution endpoint (POST /review_tasks/:id/resolve)

- **Status:** `WARN`
- **Report File:** [0278_5.1.3.md](./reports/0278_5.1.3.md)

**Report Findings:**

## Summary

| Aspect                      | Status | Details                                                                    |
| --------------------------- | ------ | -------------------------------------------------------------------------- |
| Endpoint exists and mounted | ✅     | `PATCH /api/review-tasks/:id`                                              |
| Zod validation              | ✅     | Params and body validated via generated types                              |
| OpenAPI spec alignment      | ✅     | Matches implementation (method + path + schema)                            |
| Frontend integration        | ✅     | `useResolveReviewTask` hook calls correct endpoint                         |
| L2 node writeback           | ✅     | Description + needsReview + correction example                             |
| L3 node writeback           | ✅     | Content updated + correction example                                       |
| L1 tag writeback            | ⚠️     | Description updated but no correction example                              |
| Activity logging            | ✅     | Records `review_resolved` event                                            |
| Design spec alignment       | ❌     | Sequence diagram uses `POST /review_tasks/:id/resolve` with `action` field |
| Backend idempotency guard   | ⚠️     | No check preventing re-resolution of already-resolved tasks                |
| `deferred` handling         | ✅     | Correctly accepted, no writeback applied                                   |

## Final Verdict: ⚠️ WARN

The review resolution endpoint is **functionally implemented** and operational:

- **`PATCH /api/review-tasks/:id`** accepts `{ status: "approved" | "rejected" | "deferred", correctedValue? }` and correctly updates the task, writes back corrections to L2/L3 nodes, creates correction examples (for L2/L3), logs the event, and returns the enriched task.

**Issues:**

1. **Design spec sequence diagram is outdated** — `06-runtime-scenarios.md` line 120 documents `POST /review_tasks/:id/resolve { action: "anchor" }` which doesn't match the actual API (`PATCH /review-tasks/{id} { status: "approved" }`). The sequence diagram should be updated to reflect the OpenAPI spec.

2. **L1 tag corrections not recorded in `correction_examples`** — When an L1 tag is approved with a corrected description, the description is written back to `l1TagsTable` but no row is inserted into `correctionExamplesTable`. This breaks the continuous improvement loop for L1 tags.

3. **No backend guard against re-resolution** — The backend does not check if a task is already resolved before processing. While the frontend prevents this by hiding action buttons for non-pending tasks, the API itself is open to re-resolution via direct calls.

---

### Item 5.1.4 — PASS Correction examples creation on review approval

- **Status:** `WARN`
- **Report File:** [0279_5.1.4.md](./reports/0279_5.1.4.md)

**Report Findings:**

## Summary

| Aspect                                | Status | Details                                                             |
| ------------------------------------- | ------ | ------------------------------------------------------------------- |
| L2 correction example creation        | ✅     | Correctly inserted on approve + correctedValue                      |
| L3 correction example creation        | ✅     | Correctly inserted on approve + correctedValue                      |
| L1 correction example creation        | ❌     | **Not implemented** — L1 tag corrections are lost                   |
| Null original content guard           | ⚠️     | Corrections where original content was empty are silently dropped   |
| Few-shot injection into L2 generation | ✅     | `getRecentCorrections()` + `buildFewShotSection()` working          |
| Few-shot injection into L1 generation | ❌     | `generateL1Tags()` does not use corrections                         |
| Distillation job                      | ✅     | Picks up unprocessed corrections, distills into prompt templates    |
| Distillation template type            | ⚠️     | Always `l3_generator` regardless of source entity type              |
| Metabolism trigger                    | ⚠️     | No built-in scheduler; requires external trigger                    |
| End-to-end loop (L2/L3)               | ✅     | Functional: correction → example → distillation → prompt → pipeline |
| End-to-end loop (L1)                  | ❌     | Broken at step 1 — corrections never captured                       |

## Final Verdict: ⚠️ WARN

Correction examples creation on review approval is **partially implemented**:

**What works:**

- When a reviewer approves an L2 or L3 review task with a `correctedValue`, a row is correctly inserted into `correction_examples` with the original content, corrected content, project ID, entity type, and entity ID.
- The generate pipeline fetches recent correction examples and injects them as few-shot prompts into the L2/L3 generation LLM call.
- The background distillation job processes unprocessed correction examples into architectural guardrails stored as prompt templates, completing the self-evolution loop.

**Issues:**

1. **L1 tag corrections are never recorded in `correction_examples`** — When an L1 tag review task is approved with a corrected description, the description is written back to `l1TagsTable` but no row is inserted into `correctionExamplesTable`. This breaks the continuous improvement loop for L1 tags. The fix would be to add a `correctionExamplesTable.insert()` call in the `l1_tag` branch at line 173 of `review_tasks.ts`.

2. **L1 tag generation does not use few-shot corrections** — `generateL1Tags()` does not accept or inject correction examples. Even if L1 corrections were captured, they would not be used during L1 generation.

3. **Null original content silently drops corrections** — The guards `if (node && node.description)` (L2) and `if (node.content)` (L3) skip creating a correction example when the original content is null/empty. This means the first correction to a newly-created node (which may have empty content) is lost.

4. **Distillation always uses `templateType: "l3_generator"`** — Corrections distilled from L2 node corrections are still stored as `l3_generator` templates, which may not be the right template type for the correction's origin.

---

### Item 5.2.1 — Review page in kg-engine

- **Status:** `WARN`
- **Report File:** [0280_5.2.1.md](./reports/0280_5.2.1.md)

**Report Findings:**

## Summary

| Aspect                  | Status | Details                                                     |
| ----------------------- | ------ | ----------------------------------------------------------- |
| Page exists and renders | ✅     | Full-featured review page at `/review`                      |
| Route wiring            | ✅     | App.tsx + layout.tsx + API routes all connected             |
| API endpoints           | ✅     | List, stats, resolve all implemented                        |
| OpenAPI spec            | ✅     | All 3 endpoints spec'd                                      |
| Generated hooks         | ✅     | useListReviewTasks, useGetReviewStats, useResolveReviewTask |
| Task card display       | ✅     | Entity type, node type, content, expand/collapse            |
| Approve/Reject/Defer    | ✅     | All three actions wired                                     |
| Inline correction       | ✅     | Edit & Correct mode with writeback                          |
| Stats sidebar           | ✅     | Pending/approved/rejected/deferred + today count            |
| Auto-refresh            | ✅     | 10s refetch interval                                        |
| Loading/empty states    | ✅     | Skeletons + empty state messages                            |
| L1 correction_examples  | ❌     | Missing — L1 corrections not stored in feedback loop        |
| Project filtering       | ❌     | No filter — all projects shown                              |
| Pagination              | ❌     | No limit/offset on list endpoint                            |
| Error handling (UI)     | ⚠️     | No onError callback for mutation failures                   |
| Test coverage           | ❌     | Zero tests (frontend + backend)                             |
| Type safety             | ⚠️     | `as any` cast on task prop                                  |

## Gaps & Recommendations

1. **Add correction_examples for L1 tags** (`review_tasks.ts:173-179`): Insert into `correctionExamplesTable` in the L1 branch, matching the pattern used for L2 (lines 131-137) and L3 (lines 158-164). ~5 lines.

2. **Add error handling to resolve mutation** (`review.tsx:253-261`): Add `onError` callback to `resolveTask.mutate` to show a toast/alert when resolution fails. The `Toaster` component is already imported.

3. **Add project filter to review page**: Add a project dropdown filter (similar to the layout's project selector) that passes a `projectId` query param to the list endpoint. Requires backend support for filtering.

4. **Add pagination to `GET /review-tasks`**: Add `limit`/`offset` query parameters to prevent loading unbounded task lists.

5. **Add tests**: At minimum, add integration tests for the review_tasks API (list, stats, resolve with correction writeback) and a snapshot test for the review page component.

---

### Item 5.2.2 — PASS Review queue filtering and display

- **Status:** `WARN`
- **Report File:** [0281_5.2.2.md](./reports/0281_5.2.2.md)

**Report Findings:**

## Summary

| Aspect                                           | Status | Details                                          |
| ------------------------------------------------ | ------ | ------------------------------------------------ |
| Filter tabs (pending/approved/rejected/deferred) | ✅     | All 4 tabs implemented with counts               |
| Default filter = pending                         | ✅     | Correct UX for review queue                      |
| Tab count badges                                 | ✅     | Computed from live data, styled per active state |
| Task list display                                | ✅     | TaskCard with entity type, node type, content    |
| Empty states                                     | ✅     | Contextual messages per filter                   |
| Loading states                                   | ✅     | Skeleton placeholders                            |
| Stats sidebar                                    | ✅     | Pending/approved/rejected/deferred + today count |
| Auto-refresh                                     | ✅     | 10s refetch interval for both list and stats     |
| Route wiring                                     | ✅     | App.tsx + layout.tsx + API routes all connected  |
| Backend list endpoint                            | ✅     | Returns enriched tasks ordered by createdAt desc |
| Backend stats endpoint                           | ✅     | Returns counts per status + today total          |
| Server-side status filter                        | ❌     | Filter is client-side only                       |
| Pagination                                       | ❌     | No limit/offset on list endpoint                 |
| Project filtering                                | ❌     | No project scoping on review queue               |
| Error handling (UI)                              | ⚠️     | No onError callback for mutation failures        |
| Test coverage                                    | ❌     | Zero tests (frontend + backend)                  |
| Type safety                                      | ⚠️     | `as any` cast on task prop                       |
| Stats query efficiency                           | ⚠️     | 5 separate queries instead of 1 aggregation      |

## Gaps & Recommendations

1. **Add server-side status filter** (`review_tasks.ts:68-75`): Add an optional `status` query parameter to `GET /review-tasks` and filter with `.where(eq(reviewTasksTable.status, status))` when provided. Update the frontend to pass the current filter value. This reduces data transfer and shifts filtering to the DB.

2. **Add pagination** (`review_tasks.ts:68-75`): Add `limit`/`offset` query parameters to the list endpoint. On the frontend, implement infinite scroll or pagination controls. This prevents unbounded memory growth.

3. **Add project filter to review queue**: Add a project dropdown to the review page (the layout already has a project selector in the header). Pass `projectId` to the backend and filter tasks by project. Requires joining through entity tables or adding `projectId` to the review_tasks table.

4. **Add error handling to resolve mutation** (`review.tsx:253-261`): Add `onError` callback to `resolveTask.mutate` to show a toast notification when resolution fails. The `Toaster` component is already imported in the app.

5. **Optimize stats endpoint** (`review_tasks.ts:77-106`): Replace 5 separate `count()` queries with a single `SELECT status, count(*) FROM review_tasks GROUP BY status` query plus one for today's count. Reduces DB round-trips from 5 to 2.

6. **Add tests**: Add integration tests for the review_tasks API (list with status filter, stats aggregation, resolve flow) and at minimum a snapshot test for the review page filter tabs and empty states.

---

### Item 5.2.3 — Approve/merge/reject actions

- **Status:** `WARN`
- **Report File:** [0282_5.2.3.md](./reports/0282_5.2.3.md)

**Report Findings:**

## Summary

| Aspect                                   | Status | Details                                                    |
| ---------------------------------------- | ------ | ---------------------------------------------------------- |
| Approve button                           | ✅     | Calls PATCH with status=approved                           |
| Reject button                            | ✅     | Calls PATCH with status=rejected                           |
| Defer button                             | ✅     | Calls PATCH with status=deferred                           |
| Edit & Correct textarea                  | ✅     | Toggle edit mode, shows Textarea for correction            |
| Save & Approve with correction           | ✅     | Submits correctedValue alongside approved status           |
| Stats badge update                       | ✅     | Query invalidation refetches list + stats                  |
| Action buttons hidden for resolved tasks | ✅     | CardFooter only renders when status=pending                |
| Backend correction writeback             | ✅     | L1/L2/L3 nodes updated with corrected value                |
| Backend correction_examples entry        | ✅     | L2 and L3 corrections stored for feedback loop             |
| Activity log on resolution               | ✅     | Every resolution logged                                    |
| Re-resolve protection (backend)          | ❌     | No guard against re-resolving already-resolved tasks       |
| Error feedback (UI)                      | ❌     | No onError callback for mutation failures                  |
| Test coverage                            | ❌     | Zero tests (frontend + backend)                            |
| Type safety                              | ⚠️     | `as any` cast on task prop                                 |
| L3 needsReview consistency               | ⚠️     | L3 nodes don't have needsReview column (schema difference) |

## Gaps & Recommendations

1. **Add re-resolve protection** (`review_tasks.ts:109-121`): At the start of the PATCH handler, query the existing task and return 409 Conflict if `status !== "pending"`. This prevents accidental overwrites and enforces the state machine invariant server-side.

2. **Add error handling to resolve mutation** (`review.tsx:253-261`): Add `onError` callback to `resolveTask.mutate` to show a toast notification when resolution fails. The `Toaster` component is already available in the app.

3. **Add tests**: Add integration tests for the resolve handler (approve/reject/defer, correction writeback, re-resolve rejection) and at minimum a snapshot test for the TaskCard action buttons.

4. **Fix type safety** (`review.tsx:328`): Replace `task as any` with proper typing by aligning `TaskCardProps` with the generated `ReviewTask` type or importing the generated type directly.

5. **Consider L3 needsReview consistency**: Either add `needsReview` to the L3 schema or document that L3 review status is tracked exclusively through the review_tasks table.

---

### Item 6.1.1 — openapi.yaml as single source of truth

- **Status:** `WARN`
- **Report File:** [0284_6.1.1.md](./reports/0284_6.1.1.md)

**Report Findings:**

## Summary

| Aspect                                   | Status                      | Details                                 |
| ---------------------------------------- | --------------------------- | --------------------------------------- |
| OpenAPI spec exists and is comprehensive | ✅                          | 2947 lines, 58 paths, 72 operationIds   |
| Orval codegen pipeline works             | ✅                          | Zod + React Query generated correctly   |
| Generated files not hand-edited          | ✅                          | Proper "Do not edit manually" headers   |
| Server routes use generated Zod          | ✅ (main) / ❌ (extensions) | Extensions routes use raw Zod           |
| Frontend uses generated hooks            | ✅                          | kg-engine imports from generated client |
| All server routes in OpenAPI spec        | ❌                          | 9 routes missing from spec              |
| All spec routes in server                | ✅                          | All spec paths implemented              |
| Path consistency (spec ↔ server)         | ❌                          | `/sync` vs `/sync/push` mismatch        |
| API-first convention documented          | ✅                          | AGENTS.md + design docs                 |
| CI enforcement of spec compliance        | ❌                          | No automated spec-to-server validation  |

## Gaps & Recommendations

1. **🔴 Fix `/sync` path mismatch.** The spec defines `POST /sync` but the server implements `POST /sync/push`. Either update the spec to `/sync/push` or update the server to `/sync`. This is a functional bug — the generated client will get a 404.

2. **🔴 Add missing server routes to OpenAPI spec.** The following endpoints need to be added to `openapi.yaml`:
   - `POST /projects/{id}/sync` (project-specific sync)
   - `POST /projects/{id}/ingest/build-artifact` (build artifact ingestion)
   - `POST /admin/reindex-embeddings` (admin reindex)
   - `POST /documents` (direct document upload)
   - `GET /mcp/read_shared_memory` and `GET /mcp/retrieve_original` (MCP internal tools)
   - `GET /metabolism-tick` and `GET /admin/metabolism-tick` (or document them as intentionally internal)

3. **🟡 Use generated Zod schemas in extensions_vscode.ts.** Replace the inline `z.object({...})` definitions with imports from `@workspace/api-zod` to maintain API-first consistency.

4. **🟡 Add CI check for spec-to-server alignment.** Implement a CI step (or a script) that verifies all server routes are defined in the OpenAPI spec. This could be a simple comparison of `router.get/post/put/patch/delete` calls against spec paths.

5. **🟢 Consider adding a `$schema` or version tag** to the OpenAPI spec to make it easier to reference programmatically.

## Final Verdict: ⚠️ WARN

The `openapi.yaml` as single source of truth is **partially implemented**. The codegen pipeline is fully operational — Orval generates Zod validators and React Query hooks correctly, the server uses generated types for most routes, and the frontend uses generated hooks. The API-first convention is well-documented and followed in the main codebase.

However, the OpenAPI spec is **not truly the single source of truth** for the API surface. Nine server-side routes are not defined in the spec, and there is a path mismatch (`/sync` vs `/sync/push`) that causes a functional bug. The VS Code extensions routes bypass the generated Zod schemas entirely. There is no CI enforcement to prevent drift between the spec and the server.

The foundation is solid, but the discipline of "all routes in spec, all types from codegen" is not yet fully enforced.

---

### Item 6.1.2 — Orval codegen → Zod validators + React Query hooks

- **Status:** `WARN`
- **Report File:** [0285_6.1.2.md](./reports/0285_6.1.2.md)

**Report Findings:**

## Summary

| Aspect                            | Status | Details                                                   |
| --------------------------------- | ------ | --------------------------------------------------------- |
| Orval config quality              | ✅     | Sophisticated 3.1→0.3 downgrade, type-array normalization |
| Zod validators generated          | ✅     | 149 schemas, 129 type files                               |
| React Query hooks generated       | ✅     | 72 hooks matching 72 operationIds                         |
| Generated files not hand-edited   | ✅     | Proper headers, committed to repo                         |
| Custom fetch wrapper              | ✅     | Production-ready, auth + error handling                   |
| Server uses generated Zod (core)  | ✅     | 10 route files import from `@workspace/api-zod`           |
| Server uses generated Zod (all)   | ❌     | ~8 routes define inline Zod schemas                       |
| Frontend uses generated hooks     | ✅     | 17 files import from `@workspace/api-client-react`        |
| Codegen integrated into typecheck | ✅     | Chains into typecheck:libs                                |
| CI enforcement                    | ❌     | No automated codegen freshness check                      |

## Gaps & Recommendations

1. **🔴 Replace inline Zod schemas with generated ones.** The following route files should import Zod validators from `@workspace/api-zod` instead of defining them inline:
   - `search.ts` → use `SearchInput`, `SearchFeedbackInput` from spec
   - `l2_nodes.ts` → use `NodeLinkInput` from spec
   - `templates.ts` → use template update types from spec
   - `documents.ts` → use `AffiliateDocumentInput` from spec
   - `generate.ts` → use `GenerateInput` from spec
   - `integrations.ts` → use integration types from spec
   - `llm_config.ts` → use `LlmConfigInput` from spec
   - `extensions_vscode.ts` → use `VscodeQueryInput`, `VscodeCreateDecisionInput` from spec
   - `mcp.ts` → use `McpQueryInput` from spec

2. **🟡 Add CI check for codegen freshness.** Implement a CI step that runs `pnpm --filter @workspace/api-spec run codegen` and verifies no generated files changed (i.e., `git diff --exit-code`). This ensures the generated files are always in sync with the spec.

3. **🟡 Add a pre-commit hook for codegen.** Consider adding a git pre-commit hook that runs codegen when `openapi.yaml` changes, ensuring developers never forget to regenerate.

4. **🟢 Document the codegen workflow.** Add a brief section to `CONTRIBUTING.md` (or equivalent) explaining the API-first workflow: edit spec → run codegen → commit generated files.

## Final Verdict: ⚠️ WARN

The Orval codegen pipeline is **well-architectured and mostly operational**. The configuration is sophisticated (3.1→0.3 downgrade, type-array normalization, coerce support), the generated output is comprehensive (149 Zod schemas, 72 React Query hooks, 129 type files), and the custom fetch wrapper is production-ready. The codegen is integrated into the typecheck pipeline, and both the server (core routes) and frontend correctly use the generated code.

However, approximately 8 server route files define inline Zod schemas for types that are already defined in the OpenAPI spec, bypassing the API-first pipeline. This creates a maintenance burden and risk of drift between the spec and the actual validation logic. Additionally, there is no CI enforcement to ensure generated files stay in sync with the spec.

The foundation is solid, but the discipline of "all types from codegen" is not yet fully enforced across the entire server codebase.

---

### Item 6.1.4 — Zod validation on all request payloads

- **Status:** `WARN`
- **Report File:** [0287_6.1.4.md](./reports/0287_6.1.4.md)

**Report Findings:**

## Summary

| Aspect                                 | Status        | Details                                                                                    |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| Generated Zod (`@workspace/api-zod`)   | ✅ Strong     | 9 route files use Orval-generated validators                                               |
| Inline Zod (`z.object()`)              | ✅ Present    | 7 route files define their own schemas                                                     |
| No validation on body-accepting routes | ⚠️ Minor gap  | 2 routes accept bodies without validation (both are stubs that ignore body)                |
| GitHub webhooks                        | ✅ Acceptable | HMAC validation is the correct approach for webhook payloads                               |
| Error handling consistency             | ⚠️ Gap        | Most routes use `.parse()` without try/catch → validation errors return 500 not 400        |
| Global validation middleware           | ❌ Missing    | No centralized Zod error handler; each route manually validates                            |
| Test coverage for validation           | ❌ Missing    | No tests verify validation error responses                                                 |
| Spec drift (inline vs generated)       | ⚠️ Risk       | `ingest.ts` and `extensions_vscode.ts` use inline schemas that may drift from OpenAPI spec |

## Gaps & Recommendations

1. **Add global Zod error handler middleware** — Create a middleware that catches `ZodError` and returns 400 with structured error details. This eliminates the need for per-route try/catch and ensures consistent error responses. Estimated: ~15 lines in a new `middlewares/validation.ts`.

2. **Add Zod validation to `pull_requests.ts` POST `/analyze`** — Even though the body is unused, add a no-op schema or explicit body parser to prevent arbitrary payload acceptance. Estimated: ~5 lines.

3. **Add Zod validation to `projects.ts` POST `/sync`** — Same as above. Or remove the body parser if the route truly doesn't need a body. Estimated: ~5 lines.

4. **Migrate inline schemas to OpenAPI spec** — Add the routes from `extensions_vscode.ts`, `generate.ts`, `search.ts`, `mcp.ts`, `sync.ts`, `llm_config.ts`, and `integrations.ts` to `openapi.yaml` and run codegen. Then replace inline `z.object()` schemas with imports from `@workspace/api-zod`. This ensures the "API-first" principle is fully enforced.

5. **Add validation error tests** — For each POST/PUT/PATCH route, add at least one test case that sends an invalid payload and asserts a 400 response with structured error details.

---

### Item 7.1.1 — Dashboard page with project statistics

- **Status:** `WARN`
- **Report File:** [0293_7.1.1.md](./reports/0293_7.1.1.md)

**Report Findings:**

## Summary

| Aspect             | Status      | Details                                            |
| ------------------ | ----------- | -------------------------------------------------- |
| Frontend component | ✅ Complete | 5 stat cards + activity feed, loading/error states |
| Backend API        | ✅ Complete | Real DB queries for all 6 metrics                  |
| Route mounting     | ✅ Complete | Registered in `routes/index.ts`                    |
| OpenAPI spec       | ✅ Complete | Path + schemas defined                             |
| Generated hooks    | ✅ Complete | `useGetDashboard` works correctly                  |
| Navigation         | ✅ Complete | Default route + sidebar link                       |
| Test coverage      | ❌ Missing  | Zero tests for frontend or backend                 |
| Spec drift         | ⚠️ Minor    | ActivityItem enum missing `"document"` value       |
| N+1 query          | ⚠️ Minor    | Activity log project name lookups                  |

## Gaps & Recommendations

1. **Add test coverage** — Write an integration test for `GET /dashboard` that verifies the response shape and stat counts using `withRollback()` and test factories. Write a component test for `dashboard.tsx` that mocks the API response.

2. **Fix ActivityItem enum drift** — Add `"document"` to the `type` enum in `openapi.yaml:1701` to match the DB schema's `activityTypeEnum`.

3. **Optimize N+1 query** — Replace the per-row project name lookup with a single `JOIN` or `IN` query. Example: fetch all relevant projects in one query and map by ID in memory.

4. **Consider caching** — Dashboard stats don't need real-time accuracy. A 30-second cache or materialized view would reduce DB load.

---

### Item 7.1.2 — Pipeline status display

- **Status:** `WARN`
- **Report File:** [0294_7.1.2.md](./reports/0294_7.1.2.md)

**Report Findings:**

## Summary

| Aspect                                     | Status      | Details                                        |
| ------------------------------------------ | ----------- | ---------------------------------------------- |
| Dashboard page has pipeline status section | ❌ Missing  | No pipeline status UI of any kind              |
| Backend API returns pipeline data          | ❌ Missing  | `GET /dashboard` has no status breakdown       |
| OpenAPI spec includes pipeline fields      | ❌ Missing  | `DashboardStats` schema is incomplete          |
| Project status tracked in DB               | ✅ Complete | `projectStatusEnum` with 4 values              |
| Pipeline status shown elsewhere            | ✅ Complete | Pipeline page and project detail page          |
| Reusable components exist                  | ✅ Partial  | `IngestStatusCard` exists but not on dashboard |
| Test coverage                              | ❌ Missing  | Zero tests for dashboard                       |

## Gaps & Recommendations

1. **Add project status breakdown to dashboard backend** — Add a `SELECT status, COUNT(*) FROM projects GROUP BY status` query to `routes/dashboard.ts` and include the result in the response.

2. **Extend DashboardStats schema** — Add a `projectsByStatus` field (or individual count fields like `activeProjects`, `indexingProjects`, `errorProjects`) to the `DashboardStats` schema in `openapi.yaml`, then run codegen.

3. **Add pipeline status section to dashboard frontend** — Add a visually distinct section to `dashboard.tsx` showing project status breakdown with color-coded badges (green for active, amber for indexing, red for error). Consider also showing the most recent ingest timestamp.

4. **Consider surfacing IngestStatusCard on dashboard** — Either embed a summary version of `IngestStatusCard` on the dashboard or create a new dashboard-specific component that aggregates pipeline health across all projects.

5. **Add test coverage** — Once implemented, add integration tests for the updated `GET /dashboard` endpoint and component tests for the new pipeline status UI.

---

### Item 7.1.3 — Review queue health indicator

- **Status:** `WARN`
- **Report File:** [0295_7.1.3.md](./reports/0295_7.1.3.md)

**Report Findings:**

## Summary

| Aspect                                                | Status      | Details                                   |
| ----------------------------------------------------- | ----------- | ----------------------------------------- |
| Dashboard shows review queue health                   | ❌ Missing  | Only shows single `pendingReviews` count  |
| Health breakdown (pending/approved/rejected/deferred) | ❌ Missing  | Not queried or displayed on dashboard     |
| "Reviewed Today" metric on dashboard                  | ❌ Missing  | Available via API but not shown           |
| Visual health indicator (color-coded)                 | ❌ Missing  | No health badge or status indicator       |
| Backend review stats endpoint exists                  | ✅ Complete | `GET /review-tasks/stats` works correctly |
| Review page health sidebar exists                     | ✅ Complete | Well-designed, could be adapted           |
| OpenAPI `DashboardStats` has health fields            | ❌ Missing  | Only has `pendingReviews` count           |
| Test coverage                                         | ❌ Missing  | Zero tests for dashboard                  |

## Gaps & Recommendations

1. **Extend `GET /dashboard` with review health data** — Add review queue health fields to the dashboard backend response. The query pattern already exists in `routes/review_tasks.ts` (lines 77–107). Either import and reuse that logic or inline the counts in the dashboard route.

2. **Update `DashboardStats` schema** — Add a `reviewHealth` object field (or flattened count fields) to the `DashboardStats` schema in `openapi.yaml`, then run `pnpm --filter @workspace/api-spec run codegen`.

3. **Add review health section to dashboard frontend** — Add a visually distinct card or section to `dashboard.tsx` showing:
   - A health badge (e.g., green "Healthy" if pending < 10, amber "Backlog" if pending ≥ 10, red "Stalled" if pending > 50)
   - Breakdown counts with color-coded icons (matching the Review page's design language)
   - "Reviewed Today" throughput metric
   - Link to `/review` for full queue management

4. **Reuse Review page design patterns** — The Review page's stats sidebar (lines 335–404 of `review.tsx`) uses a consistent design language with color-coded icons and counts. Extract a shared `ReviewHealthCard` component that can be used on both the dashboard and the Review page.

5. **Add test coverage** — Once implemented, add integration tests for the updated `GET /dashboard` endpoint and component tests for the new review health UI.

---

### Item 7.3.1 — Natural language query interface

- **Status:** `WARN`
- **Report File:** [0299_7.3.1.md](./reports/0299_7.3.1.md)

**Report Findings:**

## Summary

| Aspect                         | Status      | Details                                                   |
| ------------------------------ | ----------- | --------------------------------------------------------- |
| Query input UI                 | ✅ Complete | Well-designed with project filter, gradient styling       |
| Result display                 | ✅ Complete | Cards with layer badges, scores, content preview          |
| Loading/error/empty states     | ✅ Complete | All states handled with appropriate UI                    |
| Backend intent routing         | ✅ Complete | 4 strategies + 3 O(1) fast-paths                          |
| Backend search handlers        | ✅ Complete | Vector, graph, direct, hybrid all implemented             |
| Frontend → Backend field names | ❌ Critical | `query` should be `q`; `projectId` should be `project_id` |
| Auth header                    | ❌ Critical | No Authorization header; backend requires MCP_PAT         |
| Response `total` field         | ❌ Bug      | Backend doesn't return `total`; frontend expects it       |
| Routing metadata display       | ⚠️ Missing  | Strategy, confidence, reasoning all discarded             |
| Input length validation        | ⚠️ Missing  | No frontend enforcement of 2000-char limit                |
| Error message quality          | ⚠️ Generic  | Auth failures show "Search failed" with no detail         |
| Test coverage                  | ❌ Missing  | No frontend tests; backend tests cover utilities only     |

## Gaps & Recommendations

1. **[CRITICAL] Fix request body field names** — Change the frontend request body from `{ query, projectId, limit }` to `{ q, project_id, limit }` to match the backend Zod schema. Without this fix, every query will return a 400 error.

2. **[CRITICAL] Add authentication to query requests** — The frontend must include an `Authorization: Bearer ${MCP_PAT}` header. This requires either: (a) storing the PAT in the frontend and sending it with each request, (b) creating a proxy endpoint that adds the server-side PAT, or (c) using a session-based auth mechanism. Option (b) is recommended to avoid exposing the PAT in client-side code.

3. **[BUG] Add `total` to backend response or remove from frontend** — Either add `total: results.length` to the `RouteQueryResult` return value, or change the frontend to use `results.length` instead of `data.total`.

4. **[ENHANCEMENT] Display routing strategy indicator** — The backend returns `routingStrategy` (vector_search, graph_traversal, direct_lookup, hybrid) and `metadata.reasoning`. Display these in the UI (e.g., a small badge below the results header showing "Strategy: vector_search — 0.95 confidence"). This would also satisfy item 7.3.2's strategy indicator requirement.

5. **[ENHANCEMENT] Improve error messages** — Parse the backend error response and show user-friendly messages. For 401, show "Authentication required — please configure your API key in Settings." For 400, show the Zod validation message.

6. **[ENHANCEMENT] Add frontend input validation** — Enforce the 2000-character limit on the frontend with a character counter and disable the Search button when the query is too long.

7. **[TESTING] Add test coverage** — Add component tests for the Query page that verify:
   - Search submission with correct request body shape
   - Result rendering with mock data
   - Error display on failed requests
   - Empty state display
   - Project filter integration

---

### Item 7.4.1 — Project CRUD

- **Status:** `WARN`
- **Report File:** [0300_7.4.1.md](./reports/0300_7.4.1.md)

**Report Findings:**

## Summary

| Aspect                           | Status             | Details                                                      |
| -------------------------------- | ------------------ | ------------------------------------------------------------ |
| Create (frontend + backend)      | ✅ Complete        | Dialog with validation, cache invalidation, activity logging |
| Read list (frontend + backend)   | ✅ Complete        | Table with stats, status badges, loading/empty states        |
| Read detail (frontend + backend) | ✅ Complete        | Header, stats, 4 tabs (graph/commits/L2/bootstrap)           |
| Update (frontend)                | ❌ Missing         | No edit UI exists; `useUpdateProject` hook unused            |
| Update (backend)                 | ⚠️ Works but buggy | Returns zeroed counts instead of actual values               |
| Delete (frontend)                | ❌ Missing         | No delete UI exists; `useDeleteProject` hook unused          |
| Delete (backend)                 | ⚠️ Risky           | No cascade cleanup; FK violation risk; no 404 check          |
| API contract alignment           | ⚠️ Partial         | Create/read match; update/delete frontend missing            |
| DB schema                        | ✅ Complete        | 10 columns, 2 enums, all constraints                         |
| OpenAPI spec                     | ✅ Complete        | All CRUD endpoints documented                                |
| Generated hooks                  | ✅ Complete        | All 3 CRUD hooks exist in api-client-react                   |
| Test coverage                    | ❌ Missing         | No tests for project routes or pages                         |
| SVN support in UI                | ❌ Missing         | No VCS type selector in create form                          |

## Gaps & Recommendations

1. **[CRITICAL] Add Update project UI** — Add an "Edit" button to the project detail page (or a kebab menu on list rows) that opens a dialog with fields for name, repoUrl, description, and status. Wire it to `useUpdateProject` with cache invalidation. This is a core CRUD operation that is entirely missing.

2. **[CRITICAL] Add Delete project UI** — Add a "Delete" button with a confirmation dialog (using the existing `Dialog` component pattern) to the project detail page or list page. Wire it to `useDeleteProject` with cache invalidation and redirect to `/projects` after deletion.

3. **[HIGH] Add cascade cleanup to backend DELETE** — The `DELETE /projects/:id` handler must clean up all related records (l2_nodes, l3_nodes, commits, documents, activity_log, review_tasks, node_links, commit_l2_links, pull_requests, project_integrations, notifications, subscriptions, llm_configs, prompt_templates) either via DB-level `ON DELETE CASCADE` or explicit deletion in the handler. Without this, deleting a project with data will either fail with FK errors or leave orphaned records.

4. **[MEDIUM] Fix PATCH to return actual counts** — The update handler should compute and return real `l2Count`, `l3Count`, and `commitCount` values (like the GET handlers do) instead of hardcoding zeros.

5. **[MEDIUM] Add description field to create form** — The create project dialog should include an optional description textarea to match the `ProjectInput` schema.

6. **[MEDIUM] Add 404 check to DELETE handler** — The delete handler should return 404 if the project doesn't exist, consistent with GET and PATCH.

7. **[LOW] Add VCS type selector to create form** — For SVN support, add a VCS type dropdown (Git/SVN) and conditionally show an SVN URL field when SVN is selected.

8. **[LOW] Add test coverage** — Add unit/integration tests for:
   - Project list page rendering and empty/loading states
   - Create project dialog submission and error handling
   - Project detail page tab switching
   - Backend CRUD endpoints (especially cascade delete behavior)

---

### Item 7.4.2 — ️ WARN LLM config management

- **Status:** `WARN`
- **Report File:** [0302_7.4.2.md](./reports/0302_7.4.2.md)

**Report Findings:**

## Summary

| Aspect                  | Status      | Details                                        |
| ----------------------- | ----------- | ---------------------------------------------- |
| View config (frontend)  | ❌ Missing  | No page, component, or tab exists              |
| Edit config (frontend)  | ❌ Missing  | No form or dialog exists                       |
| Navigation (frontend)   | ❌ Missing  | No route or sidebar nav item                   |
| Get config (backend)    | ✅ Complete | Auto-creates defaults; 404 handling            |
| Update config (backend) | ⚠️ Partial  | Only model/provider; ignores 6 other columns   |
| API contract coverage   | ⚠️ Partial  | 6 of 11 DB columns not in OpenAPI spec         |
| Generated hooks         | ✅ Complete | useGetLlmConfig + useUpdateLlmConfig available |
| Frontend hook usage     | ❌ Missing  | Neither hook imported or used                  |
| DB schema               | ✅ Complete | 11 columns with proper types and defaults      |
| Test coverage           | ❌ Missing  | No tests for llm_config route                  |
| Input validation        | ✅ Complete | Zod schema on PATCH handler                    |

## Gaps & Recommendations

1. **[CRITICAL] Create LLM config management UI** — Add a dedicated settings page or a new tab on the project detail page for LLM configuration. The UI should:
   - Display current config (provider, model, and all advanced settings)
   - Provide an edit form with fields for all 11 DB columns
   - Use `useGetLlmConfig` to fetch and `useUpdateLlmConfig` to save
   - Include cache invalidation after updates
   - Add a route in App.tsx (e.g., `/projects/:id/settings` or `/settings/llm`)
   - Add a nav item in layout.tsx sidebar (e.g., under "System" section)

2. **[HIGH] Expand API to cover all DB columns** — The `LlmConfigInputSchema` and OpenAPI `LlmConfigInput` schema should expose all configurable columns: `similarityThreshold`, `condensationThreshold`, `condensationReviewRequired`, `autoGenerate`, `maxCommitsPerRun`, `cooldownMinutes`. The response should also include `updatedAt`.

3. **[HIGH] Reconsider auto-create defaults on GET** — The `GET /projects/:id/llm-config` handler should return 404 (or a null/empty response) when no config exists, rather than silently creating a hardcoded OpenAI config. This prevents unintended provider/model defaults for deployments using other LLM providers.

4. **[MEDIUM] Add provider enum validation** — The `LlmConfigInputSchema` and OpenAPI spec should constrain `provider` to a known set of values (e.g., `openai`, `anthropic`, `google`, `ollama`, `custom`) to prevent invalid provider names.

5. **[MEDIUM] Return `updatedAt` in API responses** — Both GET and PATCH handlers should include `updatedAt` in the serialized response, and the OpenAPI `LlmConfig` schema and Zod `GetLlmConfigResponse`/`UpdateLlmConfigResponse` should include this field.

6. **[LOW] Add test coverage** — Add unit/integration tests for:
   - GET returning existing config
   - GET auto-creating defaults (or returning 404 after fix)
   - PATCH updating model/provider
   - PATCH with invalid provider/model
   - PATCH auto-creating config when none exists
   - 404 for non-existent project

7. **[LOW] Align OpenAPI spec with DB schema** — The OpenAPI `LlmConfig` response schema should include all 11 columns (or at least all user-configurable ones). The `LlmConfigInput` schema should include fields for all updatable columns.

---

### Item 8.2.1 — CodeLens: L3 decision count above functions/classes

- **Status:** `WARN`
- **Report File:** [0304_8.2.1.md](./reports/0304_8.2.1.md)

**Report Findings:**

## Summary

| Aspect                                 | Rating                              |
| -------------------------------------- | ----------------------------------- |
| Core CodeLens display logic            | ✅ Well-implemented                 |
| L3 decision count computation          | ✅ Correct                          |
| Declaration detection (regex + LSP)    | ✅ Good dual-tier approach          |
| Click handler (`showDecisionsForLens`) | ❌ **No-op — commented out**        |
| Error handling                         | ⚠️ Missing for deleted files        |
| Anchoring drift protection             | ⚠️ Known issue, not yet fixed       |
| Test coverage                          | ❌ No tests for CodeLens            |
| Design doc alignment                   | ⚠️ Partial — QuickPick flow missing |

**Overall: WARN** — The CodeLens provider's core rendering logic is well-implemented and correctly displays L3 decision counts above function/class declarations. However, the click handler (`docuvia.showDecisionsForLens`) is a no-op with its implementation commented out, making the primary user interaction non-functional. Additionally, there are no automated tests for any of the CodeLens functionality, and known anchoring drift issues remain unresolved.

---

### Item 8.2.2 — Hover: L3 decision preview on symbol hover

- **Status:** `WARN`
- **Report File:** [0306_8.2.2.md](./reports/0306_8.2.2.md)

**Report Findings:**

## Summary

| Aspect                           | Rating                                         |
| -------------------------------- | ---------------------------------------------- |
| Core hover display logic         | ✅ Well-implemented                            |
| L3 decision preview content      | ✅ Correct (title, status, body preview, link) |
| Interval tree indexing           | ✅ Good data structure choice                  |
| Live edit tracking               | ✅ `shiftRanges()` works correctly             |
| Save-time rebuild                | ✅ Correct                                     |
| Command link (`openDecision`)    | ✅ Working with `isTrusted`                    |
| Data file hover (UUID regex)     | ❌ **Not implemented**                         |
| Three-priority lookup (L3→L2→L1) | ❌ **Not implemented**                         |
| `source_paths` filtering         | ❌ Missing — may show irrelevant decisions     |
| Empty `source_paths` guidance    | ❌ Not implemented                             |
| File existence check for links   | ❌ Not implemented                             |
| Test coverage                    | ❌ No tests for hover or indexer               |
| Design doc alignment             | ⚠️ Partial — data file hover missing           |

**Overall: WARN** — The hover provider's core functionality for source files is well-implemented. Hovering over a symbol that has been matched to an L3 decision correctly shows a rich preview with title, status, body excerpt, and a working "Open Decision" link. The interval tree indexing with live edit tracking and save-time rebuild is solid. However, the data file hover feature (UUID regex scanning in `.docuvia` YAML/Markdown files) and the three-priority lookup chain (L3→L2→L1) specified in the design doc are completely absent. Additionally, there is no `source_paths` filtering, no guidance for empty configurations, no file existence checks, and no automated tests for any of the hover or indexer functionality.

---

### Item 8.2.3 — Line-number anchoring drift issue (D-05)

- **Status:** `WARN`
- **Report File:** [0307_8.2.3.md](./reports/0307_8.2.3.md)

**Report Findings:**

## Summary

| Aspect                                 | Rating                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| CodeLens declaration detection         | ✅ Dual-tier (regex + LSP) works well                      |
| CodeLens drift self-healing            | ⚠️ Corrects in one render cycle, but visible flicker       |
| Hover interval tree indexing           | ✅ Good data structure choice for the job                  |
| Hover shiftRanges() for simple edits   | ✅ Works for insertions/deletions above ranges             |
| Hover drift between saves              | ⚠️ Complex edits within function ranges cause drift        |
| IntervalTree overlapping edit handling | ⚠️ Latent bug with multiple overlapping content changes    |
| AST-based / hash-based anchoring       | ❌ **Not implemented** (D-05, planned Phase 4)             |
| Symbol identity persistence            | ❌ Not implemented                                         |
| findBestSymbolMatch() robustness       | ⚠️ Word-overlap scoring can produce wrong matches          |
| Test coverage for anchoring            | ❌ No tests for drift behavior or interval tree edge cases |
| Design doc alignment                   | ⚠️ Partial — D-05 explicitly acknowledged as unimplemented |

**Overall: WARN** — Item 8.2.3 (D-05) is a **known, documented, and acknowledged** technical debt item. The codebase uses line-number anchoring exclusively for both CodeLens and hover providers. AST-based or hash-based anchoring ("Drift Protection") is explicitly planned for Phase 4 and not yet implemented. In practice, the impact is mitigated by two factors: (1) the CodeLens provider re-scans the document on every render cycle, so drift lasts at most one render cycle, and (2) the KnowledgeIndexer fully rebuilds its interval tree on every document save. However, between saves, complex edits (especially within function ranges or cut-paste operations) can cause the hover provider to show stale associations. The `IntervalTree.shiftRanges()` method also has a latent edge-case bug with overlapping content changes. This item should remain open as WARN until Phase 4 anchoring improvements are implemented.

---

### Item 6.3.1 — GitHub webhook listener (POST /github/webhooks)

- **Status:** `WARN`
- **Report File:** [0316_6.3.1.md](./reports/0316_6.3.1.md)

**Report Findings:**

## Summary

| Aspect                   | Status   | Details                                                           |
| ------------------------ | -------- | ----------------------------------------------------------------- |
| Route mounting           | ✅ PASS  | Correctly mounted with `express.raw()` before `express.json()`    |
| HMAC-SHA256 validation   | ✅ PASS  | Uses `timingSafeEqual` with buffer padding                        |
| PR opened/synchronize    | ✅ PASS  | Full processing: upsert, ingest commits, notify                   |
| PR merged                | ✅ PASS  | Updates state, sets L3→valid, generates AI summary, posts comment |
| PR closed without merge  | ⚠️ GAP   | Does NOT set L3→orphaned (ADR-011 gap)                            |
| `ping`/`reopened` events | ⚠️ MINOR | `ping` silently ignored, `reopened` unhandled                     |
| Auth fail-closed         | 🔴 GAP   | No auth when `GITHUB_WEBHOOK_SECRET` unset                        |
| Test coverage            | 🔴 GAP   | Zero tests for webhook endpoint                                   |
| OpenAPI spec             | ⚠️ MINOR | Missing header params, no `ping` documentation                    |

## Gaps & Recommendations

1. **[HIGH] Add L3→orphaned on PR close-without-merge:** In the `action === "closed"` branch (line 341), add a DB update to set `l3NodesTable.validityStatus = "orphaned"` for commits associated with the closed PR, mirroring the merge path's L3 update logic.

2. **[HIGH] Fail-closed when `GITHUB_WEBHOOK_SECRET` is unset:** Add an `else` clause after line 145 that returns 500 or 401 when `webhookSecret` is not configured. Alternatively, validate at startup and refuse to start the server without the secret.

3. **[HIGH] Add test coverage:** Create integration tests for the webhook endpoint covering: valid HMAC signature, invalid signature, missing signature, PR opened event, PR merged event (L3→valid), PR closed-without-merge event (L3→orphaned), and invalid project ID.

4. **[MEDIUM] Handle `reopened` action:** Add handling for `action === "reopened"` to reset PR state to "open" and re-ingest commits.

5. **[LOW] Improve `ping` response:** Return a more informative response for `ping` events (e.g., `{ message: "pong" }`) to aid webhook setup debugging.

6. **[LOW] Document headers in OpenAPI spec:** Add `X-Hub-Signature-256` and `X-GitHub-Event` as header parameters to the webhook path in `openapi.yaml`.

---

### Item 6.3.2 — HMAC-SHA256 signature validation

- **Status:** `WARN`
- **Report File:** [0317_6.3.2.md](./reports/0317_6.3.2.md)

**Report Findings:**

## Summary

| Aspect                                      | Status  | Details                                                     |
| ------------------------------------------- | ------- | ----------------------------------------------------------- |
| HMAC-SHA256 crypto implementation           | ✅ PASS | `crypto.createHmac` + `timingSafeEqual` with buffer padding |
| Raw body middleware ordering                | ✅ PASS | `express.raw()` before `express.json()`                     |
| Signature header extraction                 | ✅ PASS | Correct `x-hub-signature-256` header                        |
| Valid signature → accept                    | ✅ PASS | Correct flow                                                |
| Invalid signature → reject                  | ✅ PASS | Returns 400 "Invalid signature"                             |
| Missing signature → reject                  | ✅ PASS | Returns 400 "Missing signature header"                      |
| Missing `GITHUB_WEBHOOK_SECRET` → fail-open | 🔴 GAP  | No auth enforced; all requests accepted                     |
| Test coverage                               | 🔴 GAP  | Zero tests for HMAC validation                              |
| OpenAPI spec documentation                  | ⚠️ WARN | Missing `X-Hub-Signature-256` header param                  |

## Gaps & Recommendations

1. **[CRITICAL] Add fail-closed behavior when `GITHUB_WEBHOOK_SECRET` is unset:** Add an `else` clause after line 145 that returns `401` or `500` when the secret is not configured. Better yet, fail at startup: check `GITHUB_WEBHOOK_SECRET` at app initialization and refuse to start if it's missing when the webhook route is mounted.

2. **[HIGH] Add HMAC validation test coverage:** Create integration tests covering: (a) valid signature → 202 accepted, (b) invalid signature → 400 rejected, (c) missing `X-Hub-Signature-256` header → 400 rejected, (d) missing `GITHUB_WEBHOOK_SECRET` env var → request rejected.

3. **[MEDIUM] Document webhook headers in OpenAPI spec:** Add `X-Hub-Signature-256` and `X-GitHub-Event` header parameters to the `/webhooks/github/{projectId}` path in `openapi.yaml`. Consider adding a `securitySchemes` section or at minimum documenting the auth mechanism.

---

### Item 6.3.3 — GitHub PR analysis (fetch commits, diff, post comment)

- **Status:** `WARN`
- **Report File:** [0318_6.3.3.md](./reports/0318_6.3.3.md)

**Report Findings:**

## Summary

| Aspect                                             | Status       | Details                                                 |
| -------------------------------------------------- | ------------ | ------------------------------------------------------- |
| `fetchPrCommits` — paginated commit fetch          | ✅ PASS      | 3-page pagination, 250 commit cap                       |
| `fetchPrDiff` — unified diff retrieval             | ⚠️ DEAD CODE | Implemented but never called                            |
| `postPrComment` — PR comment posting               | ✅ PASS      | Uses correct `/issues/{prNumber}/comments` endpoint     |
| Webhook-triggered AI summary on merge              | ✅ PASS      | Generates summary via GPT-4o, posts comment             |
| Manual `POST /analyze` endpoint                    | ✅ PASS      | Async with status tracking, already_completed guard     |
| GET PR detail with L2/L3 impact                    | ✅ PASS      | Returns commits count, L2/L3 nodes                      |
| OpenAPI spec documentation                         | ✅ PASS      | All 3 endpoints + schemas documented                    |
| `checkCommitInDefaultBranch`                       | ⚠️ DEAD CODE | Implemented but never called                            |
| Commit scoping in GET detail (time-range)          | ⚠️ MEDIUM    | Could return unrelated commits in multi-PR environments |
| Unique constraint on `(projectId, githubPrNumber)` | ⚠️ LOW       | Race condition possible under concurrent webhooks       |
| Test coverage                                      | 🔴 GAP       | Zero tests for PR routes                                |
| Diff context in AI analysis                        | 🔴 GAP       | Raw diff not included in GPT-4o prompt                  |

## Gaps & Recommendations

1. **[HIGH] Add test coverage for PR analysis routes:** Create integration tests covering: (a) `GET /projects/:id/pull-requests` returns correct list, (b) `POST /analyze` triggers async analysis and stores `aiSummary`, (c) `POST /analyze` returns `already_completed` on re-run, (d) webhook merge path generates summary and posts comment, (e) analysis status transitions through the full state machine.

2. **[HIGH] Include diff context in AI summary generation:** The `fetchPrDiff()` function exists but is never called. The AI summary should include the PR's unified diff alongside L2/L3 changes for a richer impact analysis. This is a ~5 line change in `generatePrAiSummary()` (github-webhooks.ts) and in the `POST /analyze` handler.

3. **[MEDIUM] Improve commit scoping in GET detail endpoint:** Instead of time-range filtering (`gte(commitsTable.createdAt, pr.createdat)`), create a `pr_commits` junction table or filter by commits actually fetched from the GitHub PR commits API. This prevents false positives when multiple PRs are active.

4. **[LOW] Add unique constraint `UNIQUE(projectId, githubPrNumber)`:** Add a database-level unique constraint on `(projectId, githubPrNumber)` to prevent duplicate PR records under race conditions. The application-level SELECT-then-UPSERT in the webhook handler handles the happy path but isn't atomic.

5. **[LOW] Remove or use dead code:** Either integrate `fetchPrDiff` and `checkCommitInDefaultBranch` into the analysis flow, or remove them to reduce the maintenance surface.

---

### Item 6.3.4 — pull_requests table for analysis records

- **Status:** `WARN`
- **Report File:** [0319_6.3.4.md](./reports/0319_6.3.4.md)

**Report Findings:**

## Summary

| Aspect                 | Status      | Details                                      |
| ---------------------- | ----------- | -------------------------------------------- |
| Schema definition      | ✅ Complete | 14 columns, 2 pgEnums, all 3 sources in sync |
| Migration DDL          | ✅ Complete | Matches Drizzle schema                       |
| REST API (3 endpoints) | ✅ Complete | List, detail, analyze all implemented        |
| Webhook integration    | ✅ Complete | Upsert on open/sync, merge handling          |
| OpenAPI spec           | ✅ Complete | All 3 paths + schemas documented             |
| Generated hooks        | ✅ Complete | All hooks exist in `api.ts`                  |
| Frontend page          | ✅ Complete | Full PR management UI                        |
| Unique constraint      | ⚠️ Missing  | No UNIQUE on (projectId, githubPrNumber)     |
| Test coverage          | ⚠️ Missing  | Zero integration tests for PR routes         |
| Auth on analyze        | ⚠️ Missing  | Expensive LLM endpoint unauthenticated       |
| Webhook `reopened`     | ⚠️ Missing  | No handler for PR reopen action              |

## Gaps & Recommendations

1. **Add unique constraint:** Create a migration adding `UNIQUE (project_id, github_pr_number)` to prevent duplicate PR records under concurrent webhook deliveries.
2. **Add integration tests:** Test the full webhook → REST → frontend chain, including PR creation via webhook, analysis triggering, and detail retrieval.
3. **Add `reopened` handler:** Handle `action === "opened"` already covers reopens (GitHub sends `opened` for both new and reopened PRs), so this is actually fine — but add a comment in the code to clarify this for future maintainers.
4. **Consider auth on analyze endpoint:** At minimum, add rate limiting to prevent abuse of the LLM-triggering endpoint.

---

### Item 6.4.1 — Slack webhook notification dispatcher

- **Status:** `WARN`
- **Report File:** [0320_6.4.1.md](./reports/0320_6.4.1.md)

**Report Findings:**

## Summary

| Aspect                                   | Status        | Details                                                           |
| ---------------------------------------- | ------------- | ----------------------------------------------------------------- |
| Slack webhook dispatcher                 | ✅ Complete   | `postSlackMessage()` with Block Kit payload builder               |
| Teams webhook dispatcher                 | ✅ Complete   | `postTeamsMessage()` with MessageCard payload builder             |
| Central routing function                 | ✅ Complete   | `notifyExternalIntegrations()` with type filtering                |
| DB schema (project_integrations)         | ✅ Complete   | 7 columns, pgEnum, all 3 sources in sync                          |
| REST API (5 endpoints)                   | ✅ Complete   | CRUD + test all implemented                                       |
| OpenAPI spec                             | ✅ Complete   | All 5 paths + 3 schemas documented                                |
| Frontend UI                              | ✅ Complete   | Full integration management page                                  |
| Ingestion notification trigger           | ✅ Integrated | Called from `ingestion-pipeline.ts`                               |
| Generation notification trigger          | ✅ Integrated | Called from `generate.ts`                                         |
| `new_document` event in payload builders | ⚠️ Missing    | Falls back to generic `:bell:` emoji                              |
| PR events in external notifications      | ⚠️ Missing    | `notifyExternalIntegrations` not called from `github_webhooks.ts` |
| Test coverage                            | ⚠️ Missing    | Zero tests for Slack/Teams dispatch                               |
| HTTPS enforcement on webhook URL         | ⚠️ Missing    | Backend accepts `http://` URLs                                    |
| Webhook secret encryption at rest        | ⚠️ Missing    | Full URL stored in plaintext                                      |
| Retry mechanism                          | ⚠️ Missing    | Transient failures silently drop notifications                    |

## Gaps & Recommendations

1. **Add `new_document` mapping:** Add `new_document` to `emojiMap`, `titleMap`, `colorMap`, and `titleMap` in both `buildSlackPayload()` and `buildTeamsPayload()` for consistent UX. Update the OpenAPI enum and frontend help text accordingly.
2. **Add PR event external notifications:** Call `notifyExternalIntegrations()` from `github_webhooks.ts` for `new_pr_opened` and `pr_merged` events, and add corresponding emoji/title/color mappings.
3. **Enforce HTTPS on backend:** Add `.refine(url => url.startsWith("https://"))` to the `webhookUrl` field in `IntegrationInputSchema` to prevent plaintext webhook token exposure over HTTP.
4. **Add webhook URL redaction in logs:** Remove `webhookUrl` from the log metadata at line 65 (and equivalent Teams line 127) to prevent secret token leakage in log aggregation systems.
5. **Add testing:** Unit test the payload builders for all event types. Integration test the full dispatch chain with a mock webhook server (e.g., MSW or a local echo endpoint).
6. **Consider retry with backoff:** Add at least one retry with exponential backoff for transient webhook delivery failures.

---

### Item 6.4.2 — Teams webhook notification dispatcher

- **Status:** `WARN`
- **Report File:** [0321_6.4.2.md](./reports/0321_6.4.2.md)

**Report Findings:**

## Summary

| Aspect                                  | Status        | Details                                                                          |
| --------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| Teams webhook dispatcher                | ✅ Complete   | `postTeamsMessage()` with MessageCard payload builder                            |
| Teams MessageCard format                | ✅ Correct    | Proper `@type`, `@context`, `themeColor`, `sections` structure                   |
| Color coding for event types            | ✅ Complete   | 3 event types with distinct hex colors                                           |
| Central routing function                | ✅ Complete   | `notifyExternalIntegrations()` routes to Teams for `integrationType === "teams"` |
| DB schema (project_integrations)        | ✅ Complete   | pgEnum includes `teams`, all 3 schema sources in sync                            |
| REST API (5 endpoints)                  | ✅ Complete   | CRUD + test all handle Teams integrations                                        |
| OpenAPI spec                            | ✅ Complete   | `teams` in `integrationType` enum, all paths documented                          |
| Frontend UI                             | ✅ Complete   | Integration type selector includes "teams"                                       |
| Ingestion notification trigger          | ✅ Integrated | Called from `ingestion-pipeline.ts`                                              |
| Generation notification trigger         | ✅ Integrated | Called from `generate.ts`                                                        |
| Test notification support               | ✅ Complete   | `sendTestNotification()` routes to `postTeamsMessage()`                          |
| `new_document` event in payload builder | ⚠️ Missing    | Falls back to generic purple color + raw event type string                       |
| PR events in external notifications     | ⚠️ Missing    | `notifyExternalIntegrations` not called from `github_webhooks.ts`                |
| Test coverage                           | ⚠️ Missing    | Zero tests for Teams dispatch                                                    |
| HTTPS enforcement on webhook URL        | ⚠️ Missing    | Backend accepts `http://` URLs                                                   |
| Webhook secret encryption at rest       | ⚠️ Missing    | Full URL stored in plaintext                                                     |
| Retry mechanism                         | ⚠️ Missing    | Transient failures silently drop notifications                                   |
| Webhook URL in logs                     | ⚠️ Warning    | Secret token logged at warn level on failure                                     |

## Gaps & Recommendations

1. **Add `new_document` mapping:** Add `new_document` to `colorMap` and `titleMap` in `buildTeamsPayload()` for consistent UX. Suggested: color `#7B68EE` (medium slate blue), title "New Documents Ingested". Update the OpenAPI enum and frontend help text accordingly.
2. **Add PR event external notifications:** Call `notifyExternalIntegrations()` from `github_webhooks.ts` for `new_pr_opened` and `pr_merged` events, and add corresponding color/title mappings in `buildTeamsPayload()`.
3. **Enforce HTTPS on backend:** Add `.refine(url => url.startsWith("https://"))` to the `webhookUrl` field in `IntegrationInputSchema` to prevent plaintext webhook token exposure over HTTP.
4. **Add webhook URL redaction in logs:** Remove `webhookUrl` from the log metadata at line 127 to prevent secret token leakage in log aggregation systems.
5. **Add testing:** Unit test `buildTeamsPayload()` for all event types. Integration test the full Teams dispatch chain with a mock webhook server (MSW or local echo endpoint).
6. **Consider retry with backoff:** Add at least one retry with exponential backoff for transient webhook delivery failures.

---

### Item 6.5.2 — Markdown export (may be missing — D-06)

- **Status:** `WARN`
- **Report File:** [0205_6.5.2.md](./reports/0205_6.5.2.md)

**Report Findings:**

## Findings

| #   | Severity  | Finding                                                                                                                                                                      |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 High   | Hardcoded `userId = 1` fallback in `checkProjectOwnership` middleware — unauthenticated requests are treated as user ID 1, potentially granting access to user 1's projects. |
| 2   | 🟡 Medium | No error handling during stream — truncated Markdown responses possible on DB errors after `res.write()` begins.                                                             |
| 3   | 🟡 Medium | No Zod validation on the `id` path parameter — bypasses the project's standard validation pattern.                                                                           |
| 4   | 🟡 Medium | No tests for the Markdown export endpoint (happy path, auth, error path, streaming).                                                                                         |
| 5   | 🟡 Medium | N+1 query pattern for L3 nodes inside the L2 loop (same as JSON export, but more impactful during streaming).                                                                |
| 6   | 🟢 Low    | L1 tags not included in Markdown export (data completeness gap vs JSON export).                                                                                              |
| 7   | 🟢 Low    | Commits not included in Markdown export (data completeness gap vs JSON export).                                                                                              |
| 8   | 🟢 Low    | Filename sanitization may produce degenerate names for non-ASCII project names.                                                                                              |
| 9   | 🟢 Low    | `(req as any).user?.id` uses `any` cast — temporary code smell pending auth middleware.                                                                                      |

## Recommendations

1. **Replace hardcoded `userId = 1` fallback** with proper authentication middleware that rejects unauthenticated requests with 401. The fallback should be removed entirely, not just documented.
2. **Add error handling in the streaming loop** — wrap the batch loop in try/catch and call `res.status(500).end()` on failure. Consider adding a `res.on('error')` handler for client disconnects.
3. **Add Zod validation** for the `id` path parameter using the generated validator from `@workspace/api-zod`.
4. **Add integration tests** for the Markdown export endpoint: 200 with valid Markdown, 404 for non-existent project, 403 for unauthorized access, Content-Type header verification.
5. **(Optional) Batch the L3 query** — fetch all L3 nodes for a batch of L2 IDs in a single `IN (...)` query instead of one per L2.
6. **(Optional) Include L1 tags** in the Markdown export for completeness (e.g., as a tag section at the top of the document).

## Overall Verdict

**⚠️ WARN** — The Markdown export feature has been significantly improved since the last verification. The critical OpenAPI spec gap has been resolved — the endpoint is now defined in `openapi.yaml`, the Orval codegen has produced proper React Query hooks, and the kg-engine frontend has an "Export Markdown" button. The feature is now usable end-to-end. A new `checkProjectOwnership` middleware adds IDOR prevention. However, the hardcoded `userId = 1` fallback is a security risk, there is no error handling during the streaming response, no Zod validation, and no test coverage. The feature is functionally complete but has security and reliability gaps that should be addressed.

---
