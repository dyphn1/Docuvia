# Docuvia — Phase Completion Checklist (Comprehensive Audit)

|> Audited: 2026-07-02, re-verified 2026-07-04 (57 checklist items + 6 spot-checked ADR rows re-checked against current source) | Source-code verified via Agentic Exploration & Adversarial Audit

|> **Legend:**
|> ✅ **Done** = Implemented and Verified Functional
|> ⚠️ **WARN** = Temporarily mocked, uses a fallback, or has architectural drift
|> ❌ **ERROR** = Severe vulnerability, completely broken, or missing logic
|> 🔲 **TODO** = Not yet implemented

---

## [Phase 1 | API Server & Foundation (The Metabolism Engine)](./README.md#phase-1-api-server--foundation-the-metabolism-engine)

||| Item | Status | Evidence / Verification Target |
||| :-------------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ ||
||| Monorepo directory layout | ✅ Done | `lib/`, `artifacts/`, `scripts/` structure ||
||| Core DB schemas defined | ✅ Done | `lib/db/src/schema/pg/` ||
||| Logging | ✅ Done | `lib/core/src/utils/logger.ts` ||
||| LLM abstraction layer | ⚠️ WARN | `lib/integrations-openai-ai-server/src/client.ts` — accepts a `provider` config but always returns an OpenAI client; no Anthropic/Gemini adapters. See `docs/reports/consolidated_status_report.md` ||
||| Per-project model switching | ✅ Done | `lib/db/src/schema/pg/llm-configs.ts` + `lib/core/src/services/llm-provider.ts` (`getLlmClientForProject()`) ||
||| CI/CD pipeline | ✅ Done | `.github/workflows/ci.yml` ||
||| Server-Side Metabolism | ✅ Done | `artifacts/api-server/src/routes/metabolism.ts` ||
||| Vector Index & Search | ✅ Done | `lib/core/src/services/intent-router.ts` ||
||| Semantic search | ✅ Done | `artifacts/api-server/src/routes/search.ts` ||
||| Graph index | ✅ Done | `lib/db/src/schema/pg/node-links.ts` ||

## [Phase 2 | Local-First VS Code Client](./README.md#phase-2-local-first-vs-code-client)

||| Item | Status | Evidence / Verification Target ||
||| :--------------------------------------------------------------------------------------------- | :------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ||
||| Standalone Engine (Graceful Degradation) | ✅ Done | `knowledge-store.ts` was deleted per ADR-021 — capability now lives in `lib/core/src/services/local-snapshot-service.ts` and `lib/core/src/services/sqlite-graph.repository.ts` ||
||| Workspace Onboarding (`/init`) | ✅ Done | `artifacts/vscode-client/src/commands/init-project.ts` (simpler than originally designed — no 3-way choice; see `docs/gitbook/development/vscode-client/command-palette/init-project.md`) ||
||| Multi-root Workspace Support | ✅ Done | `task-runner.ts` was deleted per ADR-021 — capability now in `artifacts/vscode-client/src/knowledge-graph-tree-provider.ts` (per-workspace snapshot map) and `commands/init-project.ts` (uninitialized-folder picker) ||
||| Token Limits & Chunking Configs | ✅ Done | `artifacts/vscode-client/package.json` (`docuvia.extraction.maxLinesWarning` etc.), enforced in `artifacts/vscode-client/src/commands/extraction.ts` ||
||| `docuvia sync` Bidirectional CLI | ✅ Done | `artifacts/cli/src/commands/sync.ts` ||
||| CLI Commands (analyze/init) | ✅ Done | `artifacts/cli/src/commands/analyze.ts`, `artifacts/cli/src/commands/init.ts` ||
||| Smart Blast Radius (WASM Semantic Diff) | ✅ Done | `lib/ast-core/src/detector/semantic-diff.ts` ||
||| VS Code Blast Radius UI | ✅ Done | `artifacts/vscode-client/src/docuvia-hover-provider.ts` — calls `QueryService.getImpact()`/`getContext()` directly (the "via MCP tools" framing is inaccurate; MCP tools are for external AI agents, the extension's own hover doesn't go through MCP) ||
||| Natural language UI | ✅ Done | `artifacts/kg-engine/src/pages/Query.tsx` ||

## [Phase 3 | Swarm Intelligence & Git-Isomorphic Sync](./README.md#phase-3-swarm-intelligence--git-isomorphic-sync)

||| Item | Status | Evidence / Verification Target ||
||| :-------------------------------------------------------------------------- | :------ | :--------------------------------------------------------------------------------------------------------------------- ||
||| Git ingestion (commit + diff) | ⚠️ WARN | Evidence path stale — no dedicated `ingestion-pipeline.ts` found in `lib/core/src/services/`. Closest related files: `lib/core/src/services/ast-ingestion-pipeline.ts`, `lib/core/src/services/build-artifact-aggregator.ts`. A generic git commit/diff reader distinct from AST/build-artifact ingestion was not isolated in this audit — needs re-verification against `artifacts/api-server/src/routes/ingest.ts` ||
||| Document ingestion | ✅ Done | `artifacts/api-server/src/services/doc-ingestion.service.ts` ||
||| Build artifact parser | ✅ Done | `lib/core/src/services/build-artifact-aggregator.ts` ||
||| Commit filter | ✅ Done | `lib/core/src/services/commit-scorer.ts` (`scoreCommit()`) ||
||| L1 Tagger | ✅ Done | `artifacts/api-server/src/services/l1-tags.service.ts` ||
||| L2 Extractor | ✅ Done | `artifacts/api-server/src/services/l2-nodes.service.ts` ||
||| L3 Generator | ✅ Done | `artifacts/api-server/src/services/l3-nodes.service.ts` ||
||| Generate pipeline orchestrator | ✅ Done | `lib/core/src/services/generation/generate.service.ts` ||
||| Fast-Path Filters | ✅ Done | `lib/core/src/services/intent-router.ts` ||
||| Cross-project linking | ✅ Done | `lib/core/src/services/cross-project-service.ts` (`detectCrossProjectLinks()`) ||
||| Orphan Branch R/W Protocol | ✅ Done | `lib/core/src/services/orphan-branch-writer.ts` ||
||| Template management & Inheritance | ⚠️ WARN | `lib/db/src/schema/pg/prompt-templates.ts` (schema) + `lib/core/src/services/prompt-service.ts` implements a project → global → default fallback cascade — no true parent-template inheritance model exists ||

## [Phase 4 | Human-in-the-Loop & Operations (Server-Side Extensions)](./README.md#phase-4-human-in-the-loop--operations-server-side-extensions)

||| Item | Status | Evidence / Verification Target ||
||| :----------------------------------------------------------------------------------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ||
||| Review task schema | ✅ Done | `lib/db/src/schema/pg/review-tasks.ts` ||
||| Review API logic | ✅ Done | `artifacts/api-server/src/services/review-tasks.service.ts` ||
||| Review resolution workflow | ✅ Done | `artifacts/api-server/src/services/review-tasks.service.ts` (`resolveTask()`) ||
||| Review UI (frontend) | ✅ Done | `artifacts/kg-engine/src/pages/Review.tsx` ||
||| Noise detection | ✅ Done | `lib/core/src/services/generation/generate.service.ts` (calls `runSieveModel()`) ||
||| Feedback loop (corrections) | ✅ Done | `lib/db/src/schema/pg/correction-examples.ts` + `artifacts/api-server/src/services/metabolism.service.ts` (`distillPendingCorrections()`) ||
||| Export (Markdown / JSON) | ✅ Done | `artifacts/api-server/src/services/export.service.ts` ||
||| Dashboard & stats | ✅ Done | `lib/plugins-domain/src/dashboard.service.ts` (`getDashboardStats()`) ||
||| Incremental update (delta-only) | ✅ Done | `lib/db/src/schema/pg/projects.ts` (`lastGitIngestedAt`, `lastAstIngestedAt`, `lastSvnRevision` cursor columns) ||
||| Cross-team subscription | ✅ Done | `lib/db/src/schema/pg/subscriptions.ts` + `SubscriptionService` ||
||| VS Code Extension Endpoints | ✅ Done | `artifacts/api-server/src/routes/extensions-vscode.ts` ||
||| Slack / Teams bot | ✅ Done | `lib/core/src/services/slack-teams-client.ts` (`buildSlackPayload()`, `notifyExternalIntegrations()`) ||
||| GitHub PR integration | ✅ Done | `artifacts/api-server/src/routes/github-webhooks.ts` ||

## [Phase 5 | The AST Microkernel (Deep Local Analysis)](./README.md#phase-5-the-ast-microkernel-deep-local-analysis)

||| Item | Status | Evidence / Verification Target ||
||| :--------------------------------------------------------------------------- | :------ | :----------------------------------------------------------------- ||
||| MCP Route scaffolding | ✅ Done | `artifacts/api-server/src/routes/mcp.ts` ||
||| Agentic RAG (Intent Router) | ✅ Done | `lib/core/src/services/intent-router.ts` ||
||| Temporal Decay Scoring | ✅ Done | `lib/core/src/services/decay.ts` (`calculateTemporalDecay()`, exponential decay on `last_verified_at`) ||
||| AST Microkernel Architecture | ✅ Done | `lib/ast-core/` ||
||| TypeScript `implements`/`extends` Parser | 🔲 TODO | Not isolated as a dedicated parser — general parsing lives in `lib/ast-core/src/parser-core.ts` (web-tree-sitter wrapper); no specific `implements`/`extends` resolution logic confirmed ||
||| Zero-Server Deep Traversal | ✅ Done | `knowledge-store.ts` was deleted per ADR-021 — capability now in `lib/core/src/services/local-snapshot-service.ts` ||
||| Local Context Compression | ✅ Done | `lib/core/src/utils/compression.ts` (`compressAstContext()`) ||
||| Sub-second Incremental Watch | ✅ Done | `indexer/ast-watcher.ts` doesn't exist — actual watcher is `artifacts/vscode-client/src/knowledge-graph-tree-provider.ts` (`.docuvia/local.db` file watcher), plus `lib/core/src/services/ast-ingestion-pipeline.ts` ||
||| Background Agentic RAG | 🔲 TODO | `docuvia.json` does not exist anywhere in the repo — fabricated evidence citation. No dedicated background-RAG config file found ||

## [Phase 6 | Architecture Hardening & Stabilization (The Tech Debt Phase)](./README.md#phase-6-architecture-hardening--stabilization-the-tech-debt-phase)

||| Item | Status | Evidence / Verification Target ||
||| :----------------------------------------------------------------------------------- | :------ | :----------------------------------------------------------------------------- ||
||| pgvector Migration | ✅ Done | `lib/db/src/schema/pg/l2-nodes.ts` (`vector` column type), `lib/core/src/services/router/vector-search.service.ts` (`<=>` cosine distance operator) ||
||| Concurrency Locks | ✅ Done | `artifacts/api-server/src/services/metabolism.service.ts` (`withMetabolismLock()`, PostgreSQL advisory locks) ||
||| Security Hardening | ✅ Done | `artifacts/api-server/src/routes/export.ts` ||
||| SVN integration | ⏸️ Pending | `lib/core/src/services/svn-client.ts` exists (`getSvnLog()`) but diffs are not fetched and the diff column is unused; see `docs/reports/consolidated_status_report.md` ||

---

## Verification Reporting Protocol

When an AI Agent (e.g., `Task Verifier`, `QA`, or `Explore` subagent) executes a validation task on the codebase based on this checklist, the Agent **MUST** document its findings using the following protocol. This ensures a closed loop between code reality, documentation, and the issue tracker.

### 1. Mandatory Pre-Conditions

- Before starting, the Agent must read `AGENTS.md` to understand the project conventions.
- The Agent must cross-reference the feature's `Evidence / Verification Target` against its governing `ADR`.
- The Agent must read `docs/reports/.verification-index.json` to understand which items have already been verified.

### 2. Target Selection (Cron Mode)

When running as a cron job (e.g., `Docuvia Design Verification`), the Agent MUST:

1. **Read `docs/reports/.verification-index.json`** to identify unverified items.
2. **Priority order**: Items with `status: "todo"` (never verified) > items with `status: "warn"` or `status: "error"` (re-verify after code changes) > items with `status: "done"` (skip unless code changed).
3. **One item per invocation**: Verify only ONE item per cron run. Do not batch.
4. **Full cycle**: Only after all items in a phase are verified should the agent move to re-verification of WARN/ERROR items.

### 3. Duplicate Report Detection

Before writing a new report, the Agent MUST check if a report already exists for the same topic:

1. **Search pattern**: Look for files in `docs/reports/` matching `*_phase-X_<feature-slug>.md` (different dates = same topic).
2. **If duplicate exists**: Merge/update the existing report with new findings. Update the `Date` field to the latest verification date. Preserve findings that remain relevant.
3. **If no duplicate**: Create a new report using the naming convention `MMDD_phase-X_feature-name.md`.

### 4. Reporting Format

If a discrepancy is found (e.g., a feature marked as `✅ Done` is actually missing, using a fallback, or violates its ADR constraint), the Agent MUST:

1. **Inject a TODO in the source code**: Immediately add `// TODO: [CRITICAL BUG FIX] - <Description>` in the exact `.ts` or `.tsx` file that is failing.
2. **Generate/Update a Report**: Create or update a detailed Markdown report in the `docs/reports/` directory using the naming convention `MMDD_phase-X_feature-name.md`.
3. **Report Template**:

   ```markdown
   # Verification Report: [Feature Name]

   - **Date**: YYYY-MM-DD
   - **Phase & Item**: [e.g., Phase 2 - Git Ingestion]
   - **Target File**: [e.g., ingest.ts]
   - **Status Update Required**: [✅ PASS | ⚠️ WARN | ❌ ERROR]

   ### Description of Failure

   [Explain exactly what logic is missing or why it violates the ADR]

   ### Recommended Fix

   [Actionable steps for the Developer Agent to implement the fix]
   ```

4. **Update Verification Index**: Update `docs/reports/.verification-index.json` with the new status, report filename, and verification date.
5. **Update Checklist**: Update the checklist row's `Evidence / Verification Target` column to reference the report file.
6. **Update Action Plan**: Append a summary of the failure to the `master-roadmap.md` under the relevant Phase's **Precautions** section to prevent future regressions.

### 5. Git Commit Rules

- **Reports in `docs/reports/` are committed to git** (shared with team).
- **`docs/reports/.verification-index.json` is NOT committed** (local-only, add to `.gitignore`). It is used solely by the cron agent to track verification state.
- Commit message format: `verify(phase-X): <feature-name> — <status>`.

## Architecture Decision Records (ADR) Mapping

To ensure no architectural decision is implemented without being tracked on the roadmap, the following is a comprehensive mapping of all ADRs to their implementation status.

| ADR     | Decision Topic                               | Roadmap Phase / Feature               | Status     |
| :------ | :------------------------------------------- | :------------------------------------ | :--------- |
| ADR-001 | VS Code Client Onboarding                    | Phase 2 (Workspace Onboarding)        | ✅ Done    |
| ADR-002 | Local-First Architecture                     | Phase 2 (Standalone Engine)           | ✅ Done    |
| ADR-003 | Server-Side Zero-to-One                      | Phase 1 & 3 (Bootstrap Blueprint)     | ✅ Done    |
| ADR-004 | Git Isomorphic Graph                         | Phase 3 (Orphan Branch Protocol)      | ✅ Done    |
| ADR-005 | Knowledge Abstraction Strategy               | Phase 1 (L1/L2/L3 Schemas)            | ✅ Done    |
| ADR-006 | Self-Evolution Architecture                  | Phase 4 (Distillation Job)            | ✅ Done    |
| ADR-007 | Agentic RAG Routing                          | Phase 5 (Intent Router)               | ✅ Done    |
| ADR-008 | Asynchronous Metabolism                      | Phase 1 (Metabolism Engine)           | ✅ Done    |
| ADR-009 | Token Management                             | Phase 2 (Token Limits & Chunking)     | ✅ Done    |
| ADR-010 | Context Compression & Proxy                  | Phase 5 (Local Context Compression)   | ✅ Done    |
| ADR-011 | Two-Phase Knowledge Validity                 | Phase 4 (Review Queue)                | ✅ Done    |
| ADR-012 | Document Misc Pool                           | Phase 3 (Document Ingestion)          | ✅ Done    |
| ADR-013 | Adversarial Implementation Protocol          | N/A (Process Governance)              | ✅ Done    |
| ADR-014 | SQL-Indexed Graph & DB-as-IPC                | Phase 1 (Core DB Schemas)             | ✅ Done    |
| ADR-015 | Progressive Enrichment & LSP Dual Engine     | Phase 5 (LSP Dual Engine)             | ⏸️ Pending |
| ADR-016 | Git Blob Identity & Checkout Defense         | Phase 3 (Git Ingestion)               | ⏸️ Pending |
| ADR-017 | Tiered Storage & Orphan Branch Maintenance   | Phase 3 (Orphan Branch Protocol)      | ✅ Done    |
| ADR-018 | Temporal & Conceptual Bidirectional Linking  | Phase 3 (4D Edges & Janitor)          | ❌ ERROR   |
| ADR-019 | pgvector Migration                           | Phase 6 (pgvector Migration)          | ✅ Done    |
| ADR-020 | Unified Isomorphic AST Microkernel           | Phase 5 (AST Microkernel)             | ✅ Done    |
| ADR-021 | Shared Core API & Presentation Layers        | Phase 1 (Monorepo Layout)             | ✅ Done    |
| ADR-022 | WASM AST Blast Radius                        | Phase 2 (Smart Blast Radius)          | ✅ Done    |
| ADR-023 | Granular Markdown Storage                    | Phase 3 (Orphan Branch Serialization) | ✅ Done    |
| ADR-024 | Cross-Project Soft Linking                   | Phase 3 (Cross-Project Linking)       | ✅ Done    |
| ADR-025 | Hybrid Temp-File Blast Radius & Headless LSP | Phase 5 (Headless LSP Overlay)        | ✅ Done    |
| ADR-026 | Multi-Provider LLM Abstraction Layer         | Phase 1 (LLM Abstraction Layer)       | ⏸️ Pending |

> **ADR-018 downgraded from ⚠️ WARN to ❌ ERROR** (re-audited): `lib/db/src/schema/pg/node-links.ts` only has a generic `linkType` field — none of the ADR's specified `IMPLEMENTS` / `EXPLAINS` / `EVOLVED_INTO` edge types, temporal properties, or bidirectional `HAS_RULE` checks exist. This isn't architectural drift on top of a working mechanism; the specific model the ADR describes was never built.
