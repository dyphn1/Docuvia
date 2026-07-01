# Comprehensive Project Audit Report (2026-07-01)

## 🔴 High (Critical) Severity

- [x] **Code Alignment: Missing Module Claimed in Architecture**
  - **File:** `docs/design/05-building-blocks.md`
  - **Line/Function:** Table 5.2 – api-server Internal Modules
  - **Action Required:** Implement the missing `build-artifact-parser.ts` module in `lib/core/src/services/`, or remove the claim from the design doc.
- [x] **Cross-Link Resolution: Broken Inter-Document Links**
  - **File:** `AGENTS.md`, `docs/roadmap/roadmap_checklist.md`, `docs/roadmap/master-roadmap.md`, `docs/design/05-building-blocks.md`
  - **Line/Function:** Various schema and routing paths.
  - **Action Required:** Update paths in `AGENTS.md` to `docs/design/vscode-client/00-router-overview.md` and `lib/core/src/services/intent-router.ts`. Replace underscores with hyphens for schema file references in roadmap and design docs.
- [ ] **Architectural Purity & MVC Violations**
  - **File:** `artifacts/api-server/src/routes/*.ts` (e.g., `export.ts`, `ingest.ts`, `generate.ts`, `review-tasks.ts`)
  - **Line/Function:** Over 52 direct Drizzle ORM operations (`db.select`, `db.insert`, etc.).
  - **Action Required:** Extract direct DB queries from controllers into a dedicated Service/Repository layer.
- [x] **Single Responsibility Principle (SRP) Violations**
  - **File:** `artifacts/api-server/src/routes/metabolism.ts`
  - **Line/Function:** `runMetabolism()`
  - **Action Required:** Refactor `runMetabolism()` to decouple DB operations, external GitHub API calls, and LLM prompts into separate background workers or single-purpose service classes.
- [x] **Metrics Verification: Failing Tests Block Coverage Generation**
  - **File:** `artifacts/cli/test/support/sandbox.ts` and `artifacts/cli/test/unit/parity.unit.test.ts`
  - **Line/Function:** Global execution of `pnpm run test:coverage`
  - **Action Required:** Fix the missing `execa` module resolution in `sandbox.ts`. Update `mcp/server.ts` or `cli.ts` to ensure 100% parity between CLI commands and MCP tools to pass the failing parity test.

## 🟡 Medium Severity

- [x] **ADR Contradiction: SQLite vs PostgreSQL for Local Hooks**
  - **File:** `docs/design/adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md`
  - **Line/Function:** Line 9
  - **Action Required:** Change `"local PostgreSQL database"` to `"local SQLite database"` to accurately reflect ADR-014.
- [x] **Visual - [ ] **Visual & Architectural Assessment: Missing Complex Workflow Diagrams** Architectural Assessment: Missing Complex Workflow Diagrams**
  - **File:** `docs/design/vscode-client/ui-ux/user-journeys.md` & `docs/design/vscode-client/command-palette/search.md`
  - **Line/Function:** Journey sections and `executeSearch` branching flow.
  - **Action Required:** Insert Mermaid Sequence/Flowchart diagrams outlining the state transitions and interactions.
- [x] **Schema Integrity: Missing Explicit Indexes on Graph Traversal Edge Table**
  - **File:** `lib/db/src/schema/node-links.ts`
  - **Line/Function:** `nodeLinksTable` declaration.
  - **Action Required:** Add an explicit index block targeting `sourceNodeId` and `targetNodeId`.
- [x] **Schema Integrity: Missing Explicit Indexes on Projects Table**
  - **File:** `lib/db/src/schema/projects.ts`
  - **Line/Function:** `projectsTable` declaration.
  - **Action Required:** Add an explicit index block targeting `ownerId` and `repoUrl`.
- [x] **DRY Principle (Don't Repeat Yourself) Violations**
  - **File:** `artifacts/api-server/src/routes/` (multiple files like `documents.ts`, `export.ts`, `generate.ts`, `ingest.ts`, etc.)
  - **Line/Function:** `const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));`
  - **Action Required:** Consolidate this exact query (duplicated 17 times) into a shared middleware or repository function like `getProjectById`.

## 🟢 Low Severity

- [x] **ADR Supplement: Update Status Headers**
  - **File:** `docs/design/adrs/ADR-004-git-isomorphic-graph.md` & `docs/design/adrs/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md`
  - **Line/Function:** Frontmatter/Header
  - **Action Required:** Add `Status: Superseded by ADR-017` to ADR-004. Add `Status: Superseded by ADR-020` to ADR-015.
- [x] **Code Alignment: Unresolved External Tool Reference**
  - **File:** `docs/evaluate/07-local-bfs-blast-radius.md`
  - **Line/Function:** Reference to `code-review-graph`.
  - **Action Required:** Clarify whether `code-review-graph` is an external tool, planned module, or reword it to refer to a generic algorithm implementation.
