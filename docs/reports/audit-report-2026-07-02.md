# Docuvia Comprehensive Project Audit Report
**Date:** 2026-07-02

## High (Critical)
- [x] **`lib/db/src/schema/commit-l2-links.ts` (Lines 11-14)**: Missing DB indexes for foreign keys `commit_id`, `l2_node_id`.
  - **Action**: Add explicit index declaration to table definition `(table) => ({ commitIdx: index(...), l2NodeIdx: index(...) })`.
- [x] **`lib/db/src/schema/commit-l3-links.ts` (Lines 11-14)**: Missing DB indexes for foreign keys `commit_id`, `l3_node_id`.
  - **Action**: Add explicit index declaration to table definition.
- [x] **`lib/db/src/schema/documents.ts` (Lines 29-30)**: Missing DB indexes for foreign keys `project_id`, `l2_node_id`.
  - **Action**: Add explicit index declaration to table definition.
- [x] **`lib/db/src/schema/error-reports.ts` (Lines 9-10)**: Missing DB indexes for foreign keys `project_id`, `job_id`.
  - **Action**: Add explicit index declaration to table definition.

## Medium
- [ ] **`lib/db/src/schema/correction-examples.ts` (Line 8)**: Missing DB index for foreign key `project_id`.
  - **Action**: Add explicit index declaration to table definition.
- [ ] **`lib/db/src/schema/llm-configs.ts` (Line 8)**: Missing DB index for foreign key `project_id`.
  - **Action**: Add explicit index declaration to table definition.
- [ ] **`lib/db/src/schema/notifications.ts` (Line 10)**: Missing DB index for foreign key `project_id`.
  - **Action**: Add explicit index declaration to table definition.
- [ ] **`lib/db/src/schema/project-integrations.ts` (Line 21)**: Missing DB index for foreign key `project_id`.
  - **Action**: Add explicit index declaration to table definition.
- [ ] **`lib/db/src/schema/prompt-templates.ts` (Line 14)**: Missing DB index for foreign key `project_id`.
  - **Action**: Add explicit index declaration to table definition.
- [ ] **`lib/db/src/schema/pull-requests.ts` (Line 18)**: Missing DB index for foreign key `project_id`.
  - **Action**: Add explicit index declaration to table definition.
- [ ] **`lib/db/src/schema/subscriptions.ts` (Line 12)**: Missing DB index for foreign key `project_id`.
  - **Action**: Add explicit index declaration to table definition.
- [ ] **`artifacts/vscode-client/src/tests/phase1.test.ts` (Lines 27-56)**: Missing 3A structure comments (Arrange, Act, Assert).
  - **Action**: Add `// Arrange`, `// Act`, `// Assert` comments to clearly separate test phases.
- [ ] **`docs/design/adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md`**: Missing Sequence Diagram for complex lifecycle.
  - **Action**: Add ````mermaid` block illustrating the workflow.
- [ ] **`docs/design/adrs/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md`**: Missing Dual Engine Architecture Diagram.
  - **Action**: Add ````mermaid` block illustrating the architecture.
- [ ] **`docs/design/adrs/ADR-020-unified-isomorphic-ast-microkernel.md`**: Missing Component Diagram.
  - **Action**: Add ````mermaid` block illustrating the microkernel state sharing.
- [ ] **`docs/design/adrs/ADR-019-pgvector-migration.md`**: Missing Migration Flowchart.
  - **Action**: Add ````mermaid` block illustrating the fallback, filtering, and temporal decay flow.
- [ ] **`artifacts/api-server/`**: Test Statement Coverage is 52.74% (< 80%).
  - **Action**: Add more unit tests for `artifacts/api-server/src` to cover missing branches and statements. Run `pnpm run test:coverage` to verify.

## Low
- [ ] **`docs/design/adrs/*.md`**: Most ADRs lack Date/Status fields.
  - **Action**: Add `Date:` and `Status:` headers to all ADR files.
- [ ] **`docs/design/adrs/ADR-011-two-phase-knowledge-validity.md`**: Missing visual diagram.
  - **Action**: Add ````mermaid` block if applicable.
- [ ] **`docs/design/adrs/ADR-012-document-misc-pool.md`**: Missing visual diagram.
  - **Action**: Add ````mermaid` block if applicable.
- [ ] **`docs/design/adrs/ADR-013-adversarial-implementation-protocol.md`**: Missing visual diagram.
  - **Action**: Add ````mermaid` block if applicable.
- [ ] **`docs/design/adrs/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md`**: Missing visual diagram.
  - **Action**: Add ````mermaid` block if applicable.
- [ ] **`docs/design/adrs/ADR-018-temporal-and-conceptual-bidirectional-linking.md`**: Missing visual diagram.
  - **Action**: Add ````mermaid` block if applicable.
