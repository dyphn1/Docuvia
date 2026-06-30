# Active Audit

## High (Critical) Tasks

- [x] 1. Anti-Fake & Roadmap Violation (AST Parser): Downgraded roadmap completion status and replaced mock logic with tree-sitter parser logic.
- [x] 2. Anti-Fake & Roadmap Violation (VS Code Client): Eliminated mock objects and wired to actual server endpoints.
- [x] 3. API-First Enforcement: Replaced manual `fetch()` API calls with auto-generated Orval React Query hooks.
- [x] 4. Missing DB Indexes: Declared explicit indexes in `l1_tags.ts` and `commits.ts`.
- [x] 5. Missing Database Transaction Wrapper: Refactored `generate.ts` to wrap generation and insertion inside a `db.transaction()` block.
- [x] 6. Security/Crash Risk: Modified `mcp.ts` to utilize `Buffer.byteLength()` for timing-safe equality checks.
- [x] 7. Security/Information Leak Risk: Updated `logger.ts` redaction paths with wildcard depths for sensitive fields.

## Medium & Low Priority Tasks

- [x] 1. Testing & Tech Debt: Added MSW sad path handlers (400/500) and explicit PostgreSQL prerequisite checks for the test suite.
- [x] 2. Documentation Updates: Fixed broken links, added `Supersedes` metadata to all ADRs, and integrated Mermaid diagrams into the local-first architecture docs.

## Summary

Phase 1 (DB), Phase 2 (Backend), and Phase 3 (Frontend) are completed. All critical issues, along with Medium & Low priority testing and documentation improvements outlined in the fix plans, have been successfully resolved. 
- Documentation issues were fixed (ADR supersedes relationships, Mermaid diagrams, cross-links).
- Anti-fake violations were resolved (dummy mock generations removed, WASM fallback removed, TODOs cleared).
- The test pipeline DB connection was fixed and the overall statement coverage was successfully raised to 82.73%.

The active audit is now fully resolved and closed.
