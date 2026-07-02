# Active Audit

## High (Critical) Tasks

_(No pending critical tasks. All previously tracked critical tasks have been completed and verified.)_

## Completed Audit Tasks (Historical)

- [x] 1. Anti-Fake & Roadmap Violation (AST Parser): Downgraded roadmap completion status and replaced mock logic with tree-sitter parser logic.
- [x] 2. Anti-Fake & Roadmap Violation (VS Code Client): Eliminated mock objects and wired to actual server endpoints.
- [x] 3. API-First Enforcement: Replaced manual `fetch()` API calls with auto-generated Orval React Query hooks.
- [x] 4. Missing DB Indexes: Declared explicit indexes in `l1_tags.ts`, `commits.ts`, and added missing foreign key indexes across 11 tables in the Drizzle schema.
- [x] 5. Missing Database Transaction Wrapper: Refactored `generate.ts` to wrap generation and insertion inside a `db.transaction()` block.
- [x] 6. Security/Crash Risk: Modified `mcp.ts` to utilize `Buffer.byteLength()` for timing-safe equality checks.
- [x] 7. Security/Information Leak Risk: Updated `logger.ts` redaction paths with wildcard depths for sensitive fields.
- [x] 8. Architecture Refactor: Refactored `artifacts/api-server/src/routes/*.ts` to extract direct Drizzle ORM operations into a Service/Repository layer.

## Medium & Low Priority Tasks (Completed)

- [x] 1. Testing & Tech Debt: Added MSW sad path handlers (400/500) and explicit PostgreSQL prerequisite checks for the test suite.
- [x] 2. Documentation Updates: Fixed broken links, added `Supersedes` metadata to all ADRs, added Mermaid diagrams to 9 ADRs, and integrated `Date:` and `Status:` fields across all ADRs.
- [x] 3. Testing Standards: Added strict `// Arrange`, `// Act`, `// Assert` (3A) comments to `phase1.test.ts` and introduced unit tests for `dashboard.service`, `project-status.service`, and `document.service` with strict 3A structures.

## Summary

Phase 1 (DB), Phase 2 (Backend), Phase 3 (Frontend), and Final Audit Tasks (Database Indexing, 3A Testing Compliance, ADR Visualization) are completed. All critical issues, along with Medium & Low priority testing and documentation improvements outlined in the fix plans, have been successfully resolved.

- Documentation issues were fixed (ADR supersedes relationships, Mermaid diagrams, cross-links, date/status metadata).
- Anti-fake violations were resolved (dummy mock generations removed, WASM fallback removed, TODOs cleared).
- The test pipeline DB connection was fixed, 3A pattern strictly enforced, missing indexes were added, and overall statement coverage was successfully raised.

The active audit is now fully resolved and closed.
