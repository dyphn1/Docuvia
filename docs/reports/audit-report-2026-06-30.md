# Comprehensive Project Audit Report
**Date:** 2026-06-30
**Auditor:** Master Orchestrator (Agentic Pipeline)

This report details the findings of the 4-Round Project Audit, strictly enforcing the Anti-Fake Policy, Three-Way Alignment, and Architectural Purity.

## High (Critical) - Immediate Action Required

- [ ] **Anti-Fake & Roadmap Violation (AST Parser):**
  - **File:** `docs/roadmap/ast-parser-roadmap.md`, `lib/core/src/workers/ast-worker.ts`
  - **Issue:** Roadmap claims AST parsing features (`[x] Batch Write Optimization`, `[x] Incremental Fast-Path`, etc.) are complete. However, `ast-worker.ts` contains `// Mock logic as requested` and `ast-demo-*.ts` generates dummy files.
  - **Action:** Downgrade the markdown items in `ast-parser-roadmap.md` to `[ ]`. Implement actual AST parsing with `tree-sitter`.
- [ ] **Anti-Fake & Roadmap Violation (VS Code Client):**
  - **File:** `artifacts/vscode-client/src/CentralServerClient.ts`
  - **Issue:** Hardcoded mock objects (`mock-project`, `Mock L1 Tag`, `Mock L2 Module`) are returned instead of making actual server calls.
  - **Action:** Remove mock data and implement actual network fetching to the central server.
- [ ] **API-First Enforcement Violation:**
  - **File:** `artifacts/kg-engine/src/pages/documents.tsx`, `mcp.tsx`, `pipeline.tsx`, `query.tsx`
  - **Issue:** Manual `fetch()` calls to `/api/projects/...` circumventing the auto-generated API hooks.
  - **Action:** Replace all `fetch()` calls with `@workspace/api-client-react` Orval hooks.
- [ ] **Missing DB Indexes & Critical TODOs:**
  - **File:** `lib/db/src/schema/l1_tags.ts`, `lib/db/src/schema/commits.ts:7`
  - **Issue:** `l1_tags` is missing explicit `index()` declarations. `commits.ts` lacks foreign key indexes (causing full table scans on CASCADE DELETE).
  - **Action:** Add `index("...").using(...)` to `l1_tags` and `commits` tables in the schema and run `pnpm --filter @workspace/db run push`.
- [ ] **Missing Database Transaction Wrapper:**
  - **File:** `artifacts/api-server/src/routes/generate.ts:615`
  - **Issue:** LLM generation pipeline executes discrete DB operations without a transaction, risking database corruption.
  - **Action:** Wrap the generation and insertion logic in a `db.transaction()` block.
- [ ] **Security/Crash Risk (Buffer Byte Length):**
  - **File:** `artifacts/api-server/src/routes/mcp.ts:57`
  - **Issue:** Using string `.length` instead of `Buffer.byteLength()`, which crashes `crypto.timingSafeEqual` for multibyte characters.
  - **Action:** Update the length check to use `Buffer.byteLength()`.
- [ ] **Security/Information Leak Risk:**
  - **File:** `artifacts/api-server/src/lib/logger.ts:8`
  - **Issue:** Redaction paths lack wildcard depth, potentially leaking `OPENAI_API_KEY`.
  - **Action:** Update logger redaction paths to use wildcards appropriately.

## Medium - Technical Debt & Testing

- [ ] **Sad Path Test Coverage Omission:**
  - **File:** `artifacts/api-server/test/setup/msw/handlers.ts`
  - **Issue:** Only "Happy Path" (HTTP 200/201) responses are mocked. There are no 4xx/5xx HTTP error simulations for resilience testing.
  - **Action:** Add `HttpResponse.json({}, { status: 400 })` and `status: 500` error handlers to the MSW setup.
- [ ] **Metrics Verification Blocked by DB Dependency:**
  - **File:** `artifacts/api-server/test/integration/*.test.ts`
  - **Issue:** `pnpm run test:coverage` fails entirely with `ECONNREFUSED 127.0.0.1:5432`. Integration tests cannot run without a live PostgreSQL instance.
  - **Action:** Mock the DB layer for unit tests or explicitly document the DB requirement in a setup script/Docker container before running tests.

## Low - Documentation & Formatting

- [ ] **Broken Cross-Link:**
  - **File:** `AGENTS.md`
  - **Issue:** The link `See [.github/agents/](agents/)` is broken because it points to `agents/` instead of `.github/agents/`.
  - **Action:** Update the link to `[.github/agents/](.github/agents/)`.
- [ ] **Missing ADR Override Headers:**
  - **File:** `docs/design/adrs/*.md`
  - **Issue:** A sweep found no `Supersedes: [ADR-Name]` headers. If any ADR overrides a previous one, it is undocumented.
  - **Action:** Review ADR timeline and manually add `Supersedes` metadata where applicable.
- [ ] **Missing Mermaid Diagrams:**
  - **File:** `docs/architecture/`
  - **Issue:** Complex architecture descriptions lack visual representations.
  - **Action:** Add ````mermaid` blocks to core architecture documents to clarify intent.