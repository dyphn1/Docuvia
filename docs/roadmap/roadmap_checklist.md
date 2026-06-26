# Docuvia — Phase Completion Checklist (Comprehensive Audit)

|> Audited: 2026-06-27 (verification: 8.1.1 — zero-server-deep-traversal re-verification; schema gaps fixed in working tree, edge sync still missing) | Source-code verified via Agentic Exploration & Adversarial Audit

> **Legend:**
> ✅ **Done** = Implemented and Verified Functional
> ⚠️ **WARN** = Temporarily mocked, uses a fallback, or has architectural drift
> ❌ **ERROR** = Severe vulnerability, completely broken, or missing logic
> 🔲 **TODO** = Not yet implemented

---

## [Phase 1 | Foundation](master-roadmap.md#phase-1-api-server--foundation-the-metabolism-engine)

| Item                                                                                    | Status  | Evidence / Verification Target                                                                                                                                          |
| :-------------------------------------------------------------------------------------- | :------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo directory layout                                                               | ✅ Done | `lib/`, `artifacts/`, `scripts/` structure                                                                                                                              |
| Core DB schemas defined                                                                 | ✅ Done | [`schema/`](../../lib/db/src/schema/)                                                                                                                                   |
| Logging                                                                                 | ✅ Done | [`logger.ts`](../../artifacts/api-server/src/lib/logger.ts)                                                                                                             |
|| [LLM abstraction layer](../design/adrs/ADR-004-openai-compatible-llm-interface-only.md) | ⚠️ WARN | [`integrations-openai-ai-server`](../../lib/integrations-openai-ai-server/) (Only OpenAI supported; see [report 0633_phase-1_llm-abstraction-layer](../../docs/reports/0633_phase-1_llm-abstraction-layer.md)) |
| Per-project model switching                                                             | ✅ Done | [`llm_configs.ts`](../../lib/db/src/schema/llm_configs.ts)                                                                                                              |
| CI/CD pipeline                                                                          | ✅ Done | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) (Fixed `.prettierignore` exclusions; formatted all files — lint passes clean)                              |
| Mutex / Concurrency Control                                                             | ✅ Done | [`metabolism.ts`](../../artifacts/api-server/src/routes/metabolism.ts) (Uses PG advisory lock `pg_try_advisory_lock(123456789)` + `requireApiKey` on tick endpoint) |

## [Phase 2 | Input Layer](master-roadmap.md#phase-2-local-first-vs-code-client)

| Item                                                               | Status                | Evidence / Verification Target                                                                                                                                                                              |
| :----------------------------------------------------------------- | :-------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git ingestion (commit + diff)                                      | ✅ Done               | [`ingest.ts`](../../artifacts/api-server/src/routes/ingest.ts)                                                                                                                                              |
| [Document ingestion](../design/adrs/ADR-012-document-misc-pool.md) | ✅ Done               | [`document-parser.ts`](../../artifacts/api-server/src/lib/document-parser.ts) (Fixed: removed application/octet-stream MIME bypass; added Bearer token auth to upload route)                                |
| SVN integration                                                    | ⚠️ WARN               | [`svn-client.ts`](../../artifacts/api-server/src/lib/svn-client.ts) (Architecture drift: diffs stored improperly; see [report 0629_1.2.5](../../reports/0629_1.2.5.md)) |
| Build artifact parser                                              | ✅ Done               | [`documents.ts`](../../artifacts/api-server/src/routes/documents.ts), [`ingest.ts`](../../artifacts/api-server/src/routes/ingest.ts), [`document-upload.test.ts`](../../artifacts/api-server/test/integration/document-upload.test.ts), [`build-artifact-upload.test.ts`](../../artifacts/api-server/test/integration/build-artifact-upload.test.ts) |

## [Phase 3 | Knowledge Construction Layer](master-roadmap.md#phase-3-swarm-intelligence--git-isomorphic-sync)

| Item                                                                        | Status  | Evidence / Verification Target                                                                                         |
| :-------------------------------------------------------------------------- | :------ | :--------------------------------------------------------------------------------------------------------------------- |
| Commit filter                                                               | ✅ Done | `scoreCommit()` (Noise commits now skipped in git/SVN/webhook ingestion paths)                                         |
| [L1 Tagger](../design/adrs/ADR-005-knowledge-abstraction-strategy.md)       | ✅ Done | [`l1_tags.ts`](../../lib/db/src/schema/l1_tags.ts), [`generate.ts`](../../artifacts/api-server/src/routes/generate.ts) |
| [L2 Extractor](../design/adrs/ADR-005-knowledge-abstraction-strategy.md)    | ✅ Done | [`l2_nodes.ts`](../../lib/db/src/schema/l2_nodes.ts)                                                                   |
| [L3 Generator](../design/adrs/ADR-005-knowledge-abstraction-strategy.md)    | ✅ Done | [`l3_nodes.ts`](../../lib/db/src/schema/l3_nodes.ts)                                                                   |
| Generate pipeline orchestrator                                              | ✅ Done | [`generate.ts`](../../artifacts/api-server/src/routes/generate.ts)                                                     |
| [Server-Side Metabolism](../design/adrs/ADR-008-asynchronous-metabolism.md) | ✅ Done | [`metabolism.ts`](../../artifacts/api-server/src/routes/metabolism.ts)                                                 |
| Fast-Path Filters                                                           | ✅ Done | [`intent-router.ts`](../../artifacts/api-server/src/lib/intent-router.ts)                                              |

## [Phase 4 | Knowledge Graph Layer](master-roadmap.md#phase-4-human-in-the-loop--operations-server-side-extensions)

| Item                                                                                             | Status  | Evidence / Verification Target                                                                           |
| :----------------------------------------------------------------------------------------------- | :------ | :------------------------------------------------------------------------------------------------------- |
|| [Vector Index & Search](../design/adrs/ADR-019-pgvector-migration.md)                            | ✅ Done | [`intent-router.ts`](../../artifacts/api-server/src/lib/intent-router.ts), [`l2_nodes.ts`](../../lib/db/src/schema/l2_nodes.ts), [`l3_nodes.ts`](../../lib/db/src/schema/l3_nodes.ts), [`generate.ts`](../../artifacts/api-server/src/routes/generate.ts) (pgvector `vector(1536)` + IVFFlat indexes + `<=>` cosine operator + temporal decay in SQL; commit 4557177) |
| Semantic search                                                                                  | ✅ Done | [`search.ts`](../../artifacts/api-server/src/routes/search.ts)                                           |
| Graph index                                                                                      | ✅ Done | [`node_links.ts`](../../lib/db/src/schema/node_links.ts)                                                 |
| Impact analysis                                                                                  | ✅ Done | [`mcp.ts`](../../artifacts/api-server/src/routes/mcp.ts)                                                 |
|| [Cross-project linking](../design/adrs/ADR-018-temporal-and-conceptual-bidirectional-linking.md) | ⚠️ WARN | [`generate.ts`](../../artifacts/api-server/src/routes/generate.ts) (detectCrossProjectLinks creates review tasks only, no graph edges; see [report 0635_phase-4_cross-project-linking](../../reports/0635_phase-4_cross-project-linking.md)) |

## [Phase 5 | Query Layer / MCP](master-roadmap.md#phase-5-the-ast-microkernel-deep-local-analysis)

| Item                                                                         | Status  | Evidence / Verification Target                                            |
| :--------------------------------------------------------------------------- | :------ | :------------------------------------------------------------------------ |
| MCP Route scaffolding                                                        | ✅ Done | [`mcp.ts`](../../artifacts/api-server/src/routes/mcp.ts)                  |
| MCP Search Knowledge                                                         | ✅ Done | [`mcp.ts`](../../artifacts/api-server/src/routes/mcp.ts)                  |
| MCP Get Dependencies                                                         | ✅ Done | [`mcp.ts`](../../artifacts/api-server/src/routes/mcp.ts)                  |
| MCP Impact Analysis                                                          | ✅ Done | [`mcp.ts`](../../artifacts/api-server/src/routes/mcp.ts)                  |
| MCP Get Decision Record                                                      | ✅ Done | [`mcp.ts`](../../artifacts/api-server/src/routes/mcp.ts)                  |
| MCP List Projects                                                            | ✅ Done | [`mcp.ts`](../../artifacts/api-server/src/routes/mcp.ts)                  |
| [Agentic RAG (Intent Router)](../design/adrs/ADR-007-agentic-rag-routing.md) | ✅ Done | [`intent-router.ts`](../../artifacts/api-server/src/lib/intent-router.ts) |
| [Temporal Decay Scoring](../design/adrs/ADR-007-agentic-rag-routing.md)      | ✅ Done | [`intent-router.ts`](../../artifacts/api-server/src/lib/intent-router.ts) |
| Natural language UI                                                          | ✅ Done | `kg-engine/src/pages/query.tsx`                                           |

## [Phase 6 | Human-in-the-Loop](master-roadmap.md#phase-3-swarm-intelligence--git-isomorphic-sync)

| Item                                                                                 | Status  | Evidence / Verification Target                                                 |
| :----------------------------------------------------------------------------------- | :------ | :----------------------------------------------------------------------------- |
| [Review task schema](../design/adrs/ADR-006-self-evolution-architecture.md)          | ✅ Done | [`review_tasks.ts`](../../lib/db/src/schema/review_tasks.ts)                   |
| Review API routes                                                                    | ✅ Done | [`review_tasks.ts`](../../artifacts/api-server/src/routes/review_tasks.ts)     |
| Review stats                                                                         | ✅ Done | [`reviewStats.ts`](../../artifacts/api-server/src/routes/review_tasks.ts)      |
| [Review resolution workflow](../design/adrs/ADR-011-two-phase-knowledge-validity.md) | ✅ Done | [`reviewResolution.ts`](../../artifacts/api-server/src/routes/review_tasks.ts) |
| Review UI (frontend)                                                                 | ✅ Done | `kg-engine/src/pages/review.tsx`                                               |
| Noise detection                                                                      | ✅ Done | [`generate.ts`](../../artifacts/api-server/src/routes/generate.ts)             |
| [Feedback loop (corrections)](../design/adrs/ADR-006-self-evolution-architecture.md) | ✅ Done | [`correction_examples.ts`](../../lib/db/src/schema/correction_examples.ts)     |
| Template management & Inheritance                                                    | ✅ Done | [`prompt_templates.ts`](../../lib/db/src/schema/prompt_templates.ts)           |

## [Phase 7 | Enhancements & Ecosystem](master-roadmap.md#phase-4-human-in-the-loop--operations-server-side-extensions)

| Item                                                                                                       | Status  | Evidence / Verification Target                                                                                                                            |
| :--------------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export (Markdown / JSON)                                                                                   | ✅ Done | [`export.ts`](../../artifacts/api-server/src/routes/export.ts) (IDOR fixed: added Bearer token auth via `DOCUVIA_API_KEY`, removed `1` fallback, batched N+1 queries) |
| Dashboard & stats                                                                                          | ✅ Done | [`dashboard.ts`](../../artifacts/api-server/src/routes/dashboard.ts)                                                                                      |
| Incremental update (delta-only)                                                                            | ✅ Done | [`projects.ts`](../../lib/db/src/schema/projects.ts)                                                                                                      |
| Cross-team subscription                                                                                    | ✅ Done | [`subscriptions.ts`](../../lib/db/src/schema/subscriptions.ts)                                                                                            |
| VS Code Extension Endpoints                                                                                | ✅ Done | [`extensions_vscode.ts`](../../artifacts/api-server/src/routes/extensions_vscode.ts)                                                                      |
| Slack / Teams bot                                                                                          | ✅ Done | [`slack-teams-client.ts`](../../artifacts/api-server/src/lib/slack-teams-client.ts)                                                                       |
| GitHub PR integration                                                                                      | ✅ Done | [`github_webhooks.ts`](../../artifacts/api-server/src/routes/github_webhooks.ts) (webhook HMAC validation fixed: fail-closed on missing secret/signature) |
| [Orphan Branch R/W Protocol](../design/adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md) | ✅ Done | [`orphan-branch-writer.ts`](../../artifacts/api-server/src/lib/orphan-branch-writer.ts) (Fixed: L1 tags now populated from DB instead of empty array)     |

## [Phase 8 | VS Code Client & Local First (2026-H2)](vscode-roadmap.md#phase-1-core-scaffolding--command-palette)

| Item                                                                                           | Status                           | Evidence / Verification Target                                                       |
| :--------------------------------------------------------------------------------------------- | :------------------------------- | :----------------------------------------------------------------------------------- |
| [Standalone Engine (Graceful Degradation)](../design/adrs/ADR-002-local-first-architecture.md) | ✅ Done                          | [`KnowledgeStore.ts`](../../artifacts/vscode-client/src/KnowledgeStore.ts) (Refactored to natively query `.docuvia/local.db` via `better-sqlite3`, legacy YAML eliminated) |
| [Workspace Onboarding (`/init`)](../design/adrs/ADR-001-vscode-client-onboarding.md)           | ✅ Done                          | `extension.ts` (Refactored to scaffold `.docuvia/local.db` schema) |
| Multi-root Workspace Support                                                                   | ✅ Done                          | `TaskRunner.ts`                                                                      |
| [Token Limits & Chunking Configs](../design/adrs/ADR-009-token-management.md)                  | ✅ Done                          | `extension.ts`                                                                       |
|| `docuvia sync` Bidirectional CLI                                                               | ⚠️ WARN | [`cli.ts`](../../artifacts/cli/src/cli.ts), [`projects.ts`](../../artifacts/api-server/src/routes/projects.ts) (CLI sync + POST /projects/:id/sync implemented with requireApiKey; legacy /sync/push still unauthenticated; no VS Code command; see [report 0636_phase-8_docuvia-sync-cli](../../docs/reports/0636_phase-8_docuvia-sync-cli.md)) |
|| AST Microkernel Architecture                                                                   | ✅ Done | [`@workspace/ast-core`](../../artifacts/ast-core/) (Core parser + Topology Mapping + Edge Creation + Batch Write Optimization + Incremental Watch + Cross-Language Edges implemented; bridge-provider.ts parses OpenAPI/Swagger specs → api_contract events → L2 pcd + L3 endpoint nodes + consumer links; see [report 0626_phase-5_ast-microkernel](../../reports/0626_phase-5_ast-microkernel.md)) |
| Zero-Server Deep Traversal                                                                     | ⚠️ WARN                        | [`KnowledgeStore.ts`](../../artifacts/vscode-client/src/KnowledgeStore.ts) (SQLite CTE traversal + in-memory BFS fallback; schema gaps fixed in working tree; no edge sync mechanism; see [report 0642_8.1.1](../../reports/0642_8.1.1.md)) |
|| Local Context Compression                                                                      | ✅ Done                          | [`compression.ts`](../../artifacts/api-server/src/lib/compression.ts), [`generate.ts`](../../artifacts/api-server/src/routes/generate.ts) (Wired into document context pipeline: dedup→sort→truncate→budget assembly, maxTotalChars=6000, maxPerNodeChars=600, compression stats logged) |
|| Sub-second Incremental Watch                                                                   | ✅ Done                          | [`ingest.ts`](../../artifacts/api-server/src/routes/ingest.ts), [`ast-ingestion-pipeline.ts`](../../artifacts/api-server/src/lib/ast-ingestion-pipeline.ts), [`project_files.ts`](../../lib/db/src/schema/project_files.ts) (File-hash delta detection, `mode: "incremental"` on `/projects/:id/ingest/ast`, `project_files` table for content hash tracking) |

---

� Verification Reporting Protocol

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
2. **If duplicate exists**: Merge/update the existing report with new findings. Update the `Date` field to the latest verification date. Preserve historical findings that remain relevant.
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
