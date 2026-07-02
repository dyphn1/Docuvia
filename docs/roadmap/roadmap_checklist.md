# Docuvia — Phase Completion Checklist (Comprehensive Audit)

|> Audited: 2026-07-02 (implementation: aligned with master-roadmap phases) | Source-code verified via Agentic Exploration & Adversarial Audit

|> **Legend:**
|> ✅ **Done** = Implemented and Verified Functional
|> ⚠️ **WARN** = Temporarily mocked, uses a fallback, or has architectural drift
|> ❌ **ERROR** = Severe vulnerability, completely broken, or missing logic
|> 🔲 **TODO** = Not yet implemented

---

## [Phase 1 | API Server & Foundation (The Metabolism Engine)](master-roadmap.md#phase-1-api-server--foundation-the-metabolism-engine)

||| Item | Status | Evidence / Verification Target |
||| :-------------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ ||
||| Monorepo directory layout | ✅ Done | `lib/`, `artifacts/`, `scripts/` structure ||
||| Core DB schemas defined | ✅ Done | [`schema/`](../../lib/db/src/schema/) ||
||| Logging | ✅ Done | [`logger.ts`](../../lib/core/src/utils/logger.ts) ||
||| LLM abstraction layer | ✅ Done | [0701_phase-1_llm-abstraction-layer.md](../reports/0701_phase-1_llm-abstraction-layer.md) ||
||| Per-project model switching | ✅ Done | [`llm-configs.ts`](../../lib/db/src/schema/llm-configs.ts) ||
||| CI/CD pipeline | ✅ Done | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) ||
||| Server-Side Metabolism | ✅ Done | [`metabolism.ts`](../../artifacts/api-server/src/routes/metabolism.ts) ||
||| Vector Index & Search | ✅ Done | [`intent-router.ts`](../../lib/core/src/services/intent-router.ts) ||
||| Semantic search | ✅ Done | [`search.ts`](../../artifacts/api-server/src/routes/search.ts) ||
||| Graph index | ✅ Done | [`node-links.ts`](../../lib/db/src/schema/node-links.ts) ||

## [Phase 2 | Local-First VS Code Client](master-roadmap.md#phase-2-local-first-vs-code-client)

||| Item | Status | Evidence / Verification Target ||
||| :--------------------------------------------------------------------------------------------- | :------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ||
||| Standalone Engine (Graceful Degradation) | ✅ Done | [`knowledge-store.ts`](../../artifacts/vscode-client/src/knowledge-store.ts) ||
||| Workspace Onboarding (`/init`) | ✅ Done | [`extension.ts`](../../artifacts/vscode-client/src/extension.ts) ||
||| Multi-root Workspace Support | ✅ Done | [`task-runner.ts`](../../artifacts/vscode-client/src/task-runner.ts) ||
||| Token Limits & Chunking Configs | ✅ Done | [`extension.ts`](../../artifacts/vscode-client/src/extension.ts) ||
||| `docuvia sync` Bidirectional CLI | ✅ Done | [`cli.ts`](../../artifacts/cli/src/cli.ts) ||
||| CLI Commands (analyze/init) | ✅ Done | [`cli.ts`](../../artifacts/cli/src/cli.ts) ||
||| Smart Blast Radius (WASM Semantic Diff) | ✅ Done | [`semantic-diff.ts`](../../artifacts/ast-core/src/detector/semantic-diff.ts) ||
||| VS Code Blast Radius UI | ✅ Done | `Hover/CodeLens` providers via `docuvia_impact` and `docuvia_context` MCP tools ||
||| Natural language UI | ✅ Done | [`Query.tsx`](../../artifacts/kg-engine/src/pages/Query.tsx) ||

## [Phase 3 | Swarm Intelligence & Git-Isomorphic Sync](master-roadmap.md#phase-3-swarm-intelligence--git-isomorphic-sync)

||| Item | Status | Evidence / Verification Target ||
||| :-------------------------------------------------------------------------- | :------ | :--------------------------------------------------------------------------------------------------------------------- ||
||| Git ingestion (commit + diff) | ✅ Done | [`ingest.ts`](../../artifacts/api-server/src/routes/ingest.ts) ||
||| Document ingestion | ✅ Done | [`document-parser.ts`](../../lib/core/src/services/document-parser.ts) ||
||| Build artifact parser | ✅ Done | [`documents.ts`](../../artifacts/api-server/src/services/document.service.ts) ||
||| Commit filter | ✅ Done | `scoreCommit()` ||
||| L1 Tagger | ✅ Done | [`l1-tags.service.ts`](../../artifacts/api-server/src/services/l1-tags.service.ts) ||
||| L2 Extractor | ✅ Done | [`l2-nodes.service.ts`](../../artifacts/api-server/src/services/l2-nodes.service.ts) ||
||| L3 Generator | ✅ Done | [`l3-nodes.service.ts`](artifacts/api-server/src/services/l3-nodes.service.ts) ||
||| Generate pipeline orchestrator | ✅ Done | [`generate.ts`](../../artifacts/api-server/src/services/generate.service.ts) ||
||| Fast-Path Filters | ✅ Done | [`intent-router.ts`](../../lib/core/src/services/intent-router.ts) ||
||| Cross-project linking | ⚠️ WARN | [`0702_phase-3_3_1_1_cross-project-linking.md`](../reports/0702_phase-3_3_1_1_cross-project-linking.md) ||
||| Orphan Branch R/W Protocol | ✅ Done | [`orphan-branch-writer.ts`](../../lib/core/src/services/orphan-branch-writer.ts) ||
||| Template management & Inheritance | ✅ Done | [`prompt-templates.ts`](../../lib/db/src/schema/prompt-templates.ts) ||

## [Phase 4 | Human-in-the-Loop & Operations (Server-Side Extensions)](master-roadmap.md#phase-4-human-in-the-loop--operations-server-side-extensions)

||| Item | Status | Evidence / Verification Target ||
||| :----------------------------------------------------------------------------------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ||
||| Review task schema | ✅ Done | [`review-tasks.ts`](../../lib/db/src/schema/review-tasks.ts) ||
||| Review API logic | ✅ Done | [`review-tasks.service.ts`](../../artifacts/api-server/src/services/review-tasks.service.ts) ||
||| Review resolution workflow | ✅ Done | [`review-tasks.service.ts`](artifacts/api-server/src/services/review-tasks.service.ts) ||
||| Review UI (frontend) | ✅ Done | [`Review.tsx`](../../artifacts/kg-engine/src/pages/Review.tsx) ||
||| Noise detection | ✅ Done | [`generate.ts`](../../artifacts/api-server/src/services/generate.service.ts) ||
||| Feedback loop (corrections) | ✅ Done | [`correction-examples.ts`](../../lib/db/src/schema/correction-examples.ts) ||
||| Export (Markdown / JSON) | ✅ Done | [`export.ts`](../../artifacts/api-server/src/services/export.service.ts) ||
||| Dashboard & stats | ✅ Done | [`dashboard.ts`](../../artifacts/api-server/src/services/dashboard.service.ts) ||
||| Incremental update (delta-only) | ✅ Done | [`projects.ts`](../../lib/db/src/schema/projects.ts) ||
||| Cross-team subscription | ✅ Done | [`subscriptions.ts`](../../lib/db/src/schema/subscriptions.ts) ||
||| VS Code Extension Endpoints | ✅ Done | [`extensions-vscode.ts`](../../artifacts/api-server/src/routes/extensions-vscode.ts) ||
||| Slack / Teams bot | ✅ Done | [`slack-teams-client.ts`](lib/core/src/services/slack-teams-client.ts) ||
||| GitHub PR integration | ✅ Done | [`github-webhooks.ts`](../../artifacts/api-server/src/routes/github-webhooks.ts) ||

## [Phase 5 | The AST Microkernel (Deep Local Analysis)](master-roadmap.md#phase-5-the-ast-microkernel-deep-local-analysis)

||| Item | Status | Evidence / Verification Target ||
||| :--------------------------------------------------------------------------- | :------ | :----------------------------------------------------------------- ||
||| MCP Route scaffolding | ✅ Done | [`mcp.ts`](../../artifacts/api-server/src/routes/mcp.ts) ||
||| Agentic RAG (Intent Router) | ✅ Done | [`intent-router.ts`](../../lib/core/src/services/intent-router.ts) ||
||| Temporal Decay Scoring | ✅ Done | [`intent-router.ts`](../../lib/core/src/services/intent-router.ts) ||
||| AST Microkernel Architecture | ✅ Done | [`@workspace/ast-core`](../../artifacts/ast-core/) ||
||| TypeScript `implements`/`extends` Parser | ✅ Done | [`typescript.ts`](../../artifacts/ast-core/src/parsers/typescript.ts) ||
||| Zero-Server Deep Traversal | ✅ Done | [`knowledge-store.ts`](../../artifacts/vscode-client/src/knowledge-store.ts) ||
||| Local Context Compression | ✅ Done | [`compression.ts`](../../lib/core/src/utils/compression.ts) ||
||| Sub-second Incremental Watch | ✅ Done | [`ast-watcher.ts`](../../artifacts/vscode-client/src/indexer/ast-watcher.ts), [`ast-ingestion-pipeline.ts`](../../lib/core/src/services/ast-ingestion-pipeline.ts) ||
||| Background Agentic RAG | ✅ Done | `docuvia.json` ||

## [Phase 6 | Architecture Hardening & Stabilization (The Tech Debt Phase)](master-roadmap.md#phase-6-architecture-hardening--stabilization-the-tech-debt-phase)

||| Item | Status | Evidence / Verification Target ||
||| :----------------------------------------------------------------------------------- | :------ | :----------------------------------------------------------------------------- ||
||| pgvector Migration | ✅ Done | [`intent-router.ts`](../../lib/core/src/services/intent-router.ts) ||
||| Concurrency Locks | ✅ Done | [`metabolism.ts`](../../artifacts/api-server/src/routes/metabolism.ts) ||
||| Security Hardening | ✅ Done | [`export.ts`](../../artifacts/api-server/src/routes/export.ts) ||
||| SVN integration | WARN | [`ingest.ts`](../../artifacts/api-server/src/routes/ingest.ts) (see 0701_phase-6_2_1_svn-integration.md) ||

---

## Verification Reporting Protocol

When an AI Agent (e.g., `Task Verifier`, `QA`, or `Explore` subagent) executes a validation task on the codebase based on this checklist, the Agent **MUST** document its findings using the following protocol. This ensures a closed loop between code reality, documentation, and the issue tracker.

### 1. Mandatory Pre-Conditions

- Before starting, the Agent must read [`AGENTS.md`](../../AGENTS.md) to understand the project conventions.
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