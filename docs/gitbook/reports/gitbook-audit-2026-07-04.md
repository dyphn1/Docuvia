# GitBook Documentation vs. Codebase Audit

**Date**: 2026-07-04
**Scope**: Full cross-check of `docs/gitbook/` (architecture, ADR-001..026, packages, roadmap, evaluate, development/vscode-client) against actual source in `lib/*` and `artifacts/*`. Every finding below was verified by reading the cited code; items that could not be verified are marked accordingly instead of guessed.

---

## 0. Most Critical Finding

### CALL edges are never populated in the production ingestion pipeline

- **Status**: 🔴 Critical — undermines the core "knowledge graph" value proposition
- **Target Files**: `lib/core/src/workers/ast-worker.ts:179,210-225`, `lib/core/src/services/ast-event-mapper.ts:65`, `lib/ast-core/src/core/edge-computer.ts`
- **Description**: A fully-built, 10-language `EdgeComputer`/`classifyCall` implementation exists in `lib/ast-core/src/core/edge-computer.ts` (603 lines) but is only ever invoked from demo scripts (`artifacts/api-server/src/examples/ast-demo-*.ts`), never from the real indexer. The actual production worker (`analyze-service.ts` → `AstProcessingService` → `AstWorkerPool` → `ast-worker.ts`) declares a `calls` array and captures `@call` nodes in its tree-sitter query (line 179), but the capture-handling `switch` (lines 210-225) has **no case for `"call"`** — `calls` stays empty forever, and `mapAstToEvents` iterates it as a no-op. As a result, **zero CALL edges are ever created** in any indexed project.
- **Impact**: Every feature that assumes a walkable dependency graph (ADR-007 routing, ADR-011 validity reconciliation, `local-bfs-blast-radius.md`, `ast-dependency-edge-creation.md`, impact analysis) operates on a graph with no call edges at all. No doc mentions this gap.
- **Required Action**: Wire `EdgeComputer`/`classifyCall` (or add the missing `"call"` case to `ast-worker.ts`) into the real ingestion path, then re-validate `node_links` population end-to-end.

---

## 1. Design Flaws / Hidden Risks

### 1.1 Orphan branch writer has no filesystem isolation

- **Target**: `lib/core/src/services/orphan-branch-writer.ts:176`, `lib/core/src/services/local-orphan-branch-writer.ts:35`
- `git fast-import` is spawned with no `cwd` — it operates on the API server process's ambient working directory (one shared repo/index for all projects). The local CLI writer targets a different repo (`workspaceRoot`, uses `--force`) with no shared lock — split-brain between local and server writers is possible. Not documented in ADR-004/017.

### 1.2 ADR-004's "Database-as-IPC / Outbox" is entirely unimplemented

- **Target**: no outbox table exists anywhere in `lib/db`
- Sync happens synchronously inside `sync.service.ts`'s DB transaction, not via the async Outbox→Worker→Git flow the ADR describes as done.

### 1.3 Git write failures are silently swallowed

- **Target**: `orphan-branch-writer.ts:142-144`, called from `sync.service.ts:39` inside a `db.transaction`
- The entire write path is wrapped in a try/catch that only logs. The DB transaction can commit successfully while the orphan-branch git commit silently never happened, with no retry/outbox compensation.

### 1.4 Rename/move detection does not exist

- **Status**: ✅ ALREADY_FIXED
- **Target**: `lib/core/src/services/change-detection-service.ts:14-33`
- Runs `git diff --name-status` without `-M`/`--find-renames`; only takes the final path token, so `R100\told\tnew` lines silently drop the old path. `AstChangeDetector` hashes by `filePath` alone — a renamed-but-unchanged file becomes a fresh INSERT, not an UPDATE. Contradicts ADR-016's "zero-cost rename" claim entirely.

### 1.5 Single shared identity defeats the IDOR check

- **Target**: `artifacts/api-server/src/middlewares/auth.ts:32`
- Every valid API-key holder is hardcoded to `{ id: 1 }`. `export.ts`'s `ownerId !== userId` check is real code but functionally moot — there is no second real user it could ever reject.

### 1.6 Auth applied to ~9 routes; most CRUD routers unprotected

- **Target**: `l1-tags`, `l2-nodes`, `l3-nodes`, `review-tasks`, `notifications`, `subscriptions`, `templates`, `integrations`, `pull-requests` routers
- No `requireApiKey` middleware on any of these. Not mentioned in `packages/api-server.md`.

### 1.7 Rate limiting bypassed for webhook + proxy routes

- **Target**: `artifacts/api-server/src/app.ts`
- `/api/webhooks/github` and `/proxy/v1` are mounted before the rate-limited `/api` router, so both bypass `standardLimiter`/`mcpLimiter` entirely.

### 1.8 pgvector silently falls back to O(N²) scan on any error

- **Target**: `lib/core/src/services/cross-project-service.ts:64-86`
- pgvector IS the primary path, but any query error is caught via `console.error("PGVECTOR ERROR:", err)` with no rethrow/alert, and silently falls back to an in-memory `cosineSimilarity` scan. `risks-and-debt.md`'s R-01 ("not wired") framing is stale — the real, undocumented risk is this silent degradation path.

### 1.9 Two divergent, unbounded/inconsistent BFS implementations

- **Target**: `lib/core/src/services/impact-analysis-service.ts:6-30` (unbounded, no depth/size cap — risks hitting SQL parameter limits on dense graphs) vs. `lib/core/src/services/query-service.ts:99-134` (depth hardcoded to 3)
- Two separate graph-traversal engines with no shared depth/size limits.

### 1.10 Worker pool does not recover from crashed workers

- **Target**: `lib/core/src/services/ast-worker-pool.ts:68-75`
- A crashed worker is never removed from `this.workers`/`workerQueue`, never terminated, never respawned — pool capacity permanently shrinks per crash. No timeout/quarantine mechanism exists despite `worker-pool-concurrency.md` explicitly requiring one. A pathological input file can hang a worker slot forever; if all workers hang, `taskQueue` grows unbounded with no signal.
- `extract-service.ts`'s `globalWorkerPool` is a module-level singleton that is never `terminate()`d — in a long-lived host (VS Code extension), repeated `extract` calls leak worker threads.

### 1.11 Two disconnected local-persistence pipelines

- **Target**: `lib/core/src/services/sqlite-graph.repository.ts` (drizzle → `.docuvia/local.db`, used by `analyze`) vs. `artifacts/cli/src/commands/sync.ts` `--local` path (re-parses AST → writes straight to the git orphan branch, never touches `local.db`)
- `local-sqlite-write-pipeline.md` implies one unified pipeline; in reality these are two independent write paths for the same data.

### 1.12 Embeddings never regenerated on content update

- **Target**: `lib/core/src/services/generation/l3-processing-service.ts:84-86` (updates `content` but not `embedding`) vs. `lib/core/src/services/router/vector-search.service.ts:58-71` (ranks by embedding)
- Vector search can serve a node ranked by a stale embedding indefinitely after an edit.

### 1.13 UI kit duplicated between kg-engine and mockup-sandbox

- ~30 Radix-based component files copy-pasted identically between `artifacts/kg-engine/src/components/ui/` and `artifacts/mockup-sandbox/src/components/ui/`, no shared package.

### 1.14 Hardcoded dev secret fallback

- **Target**: `artifacts/api-server/src/routes/metabolism.ts:36` — falls back to `"dev-secret-token"` when `ADMIN_SECRET_TOKEN` is unset in development mode.

### 1.15 Cross-project link only written at detection, never at review-approval

- **Target**: `artifacts/api-server/src/services/cross-project-service.ts:121-127` vs. `review-tasks.service.ts` `resolveTask()` (no `nodeLinksTable` write anywhere in the approval path)
- The review/approve workflow appears to succeed but produces no graph effect — a correctness gap disguised as a success path. Confirmed both by `risks-and-debt.md` R-03 and independent code read.

### 1.16 Raw SQL is pervasive despite `constraints.md` forbidding it

- **Target**: `l2-nodes.service.ts:146-147`, `sync.service.ts:9-10`, `metabolism.service.ts:24,33`, `lib/db/src/index.ts:26`, 8+ services using `sql\`...\`` for ORDER BY
- `constraints.md`'s "raw SQL forbidden in application code" claim is actively violated across the codebase.

### 1.17 ADR-014's "Database-as-IPC" job queue is never actually consumed

- **Target**: `job_queue` schema/table
- Grep for `SELECT ... job_queue` returns zero results anywhere — nothing ever polls this table. It is written to and consumed synchronously by the same process, i.e. it functions as an audit log, not the async IPC mechanism ADR-014 describes and diagrams.

### 1.18 Unawaited `CREATE EXTENSION` race on DB connect

- **Target**: `lib/db/src/index.ts:25-27`
- `CREATE EXTENSION IF NOT EXISTS vector` runs inside an unawaited, uncaught async `pool.on("connect")` handler. A rejection becomes an unhandled promise rejection, and queries can race ahead of the extension actually being ready.

### 1.19 `error_reports` / `job_queue` grow unbounded

- Both tables are insert/update-only with no purge job anywhere in `lib/core` or `artifacts` — unbounded growth, not mentioned in any doc.

### 1.21 Retry/backoff exists only for batch LLM calls, not single calls

- **Target**: `lib/integrations-openai-ai-server/src/batch/utils.ts:1-2,53-86,88-132` (real `p-retry`/`p-limit`, exponential backoff, rate-limit-aware) vs. `client.ts`, `audio/client.ts`, `image/client.ts` (no retry wrapper at all — errors propagate directly to the caller)
- ADR-009/ADR-026's implied uniform resilience layer does not exist; single (non-batch) LLM calls have zero retry/backoff coverage.

### 1.20 ADR-018 self-healing only ever re-scans `pending` nodes

- **Target**: `lib/core/src/services/janitor-service.ts:10-13`
- Once a node reaches `validityStatus === "valid"`, it is never revisited. If its backing commit is later removed by a history rewrite (e.g. rebase), the doc's "continuous self-healing / immunity to destructive history rewriting" claim does not hold — only nodes still stuck in `pending` ever get healed.

---

## 2. Features Not Fully Implemented

| Feature (doc)                                                                 | Verdict                                                | Evidence                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outbox / async DB-as-IPC (ADR-004)                                            | ❌ Missing                                             | No outbox table anywhere in `lib/db`                                                                                                                                                                                                                                                                          |
| GC / hot-cold tiered storage (ADR-017)                                        | ❌ Missing                                             | No `is_active`/tombstone column on `l2NodesTable`/`l3NodesTable`, no archival job, no hydrate-from-branch code                                                                                                                                                                                                |
| Branch-merge detection (ADR-011)                                              | ❌ Missing                                             | No `isMerged`/`mergeStatus` anywhere in `lib/`; `orphaned` status is never set (code uses `garbage` instead — enum mismatch)                                                                                                                                                                                  |
| 4D edge types `IMPLEMENTS`/`EXPLAINS`/`EVOLVED_INTO`/`HAS_RULE` (ADR-018)     | ❌ Missing                                             | `node-links.ts` only has a free-text `linkType`; FKs only point at `l2NodesTable`, so L1/Physical-node edges can't even be represented structurally                                                                                                                                                           |
| Multi-provider LLM abstraction (ADR-026)                                      | 📋 Proposed, not Accepted                              | Doc's own status field says "Proposed"; code is still OpenAI-only. (Correction, 2026-07-05: the original claim that this "contradicts `capabilities-matrix.md`'s 5/5 score" was itself inaccurate — no such row exists in that doc; the ADR-026 gap stands on its own.)                                       |
| `docuvia visualize` CLI command                                               | ❌ Never started                                       | No such command in `cli.ts`; no D3/Mermaid dependency anywhere                                                                                                                                                                                                                                                |
| VS Code interactive topology webview                                          | ❌ Never built                                         | `dashboard-panel.ts` only renders stats/counts, not a graph; own code comment admits no real-time DB-event wiring                                                                                                                                                                                             |
| Git-diff-scoped incremental sync                                              | ❌ Missing                                             | `sync --local` always does full `discoverFiles` rediscovery; no `git diff-tree` logic found                                                                                                                                                                                                                   |
| Ollama / local-LLM adapter                                                    | ❌ Missing                                             | Contradicts "Local-First" positioning repeated in ADR-013                                                                                                                                                                                                                                                     |
| CLI ↔ MCP parity tests                                                        | ⚠️ Stub only                                           | `parity.unit.test.ts`: `it("should be skipped", () => {})`                                                                                                                                                                                                                                                    |
| VS Code `TaskQueue` tree view                                                 | ❌ Never populated                                     | No command pushes tasks into it besides `clearCompletedTasksCommand`                                                                                                                                                                                                                                          |
| `autoCategorizeDecisionsCommand`                                              | ⚠️ No-op stub                                          | `decision.ts:6-13`                                                                                                                                                                                                                                                                                            |
| `docuvia.knowledgeGraph.refresh`                                              | ❌ Never registered                                    | matches `nodes.md`/`user-journeys.md` R-1's own admission                                                                                                                                                                                                                                                     |
| GitHub push-event handling                                                    | ⚠️ Explicit stub                                       | `github-webhook.service.ts:76-79`: `logger.info("Push event received but not fully implemented yet")`                                                                                                                                                                                                         |
| Performance targets (p95<2s, ingestion<30s, etc., `quality-requirements.md`)  | ❌ Aspirational only                                   | Zero enforcing code, tests, or CI gates found for any of the five stated targets                                                                                                                                                                                                                              |
| DLQ "3 failures → error_reports" (`quality-requirements.md`)                  | ❌ Fabricated                                          | No retry-count/attempts logic anywhere; `error_reports` is written on the **first** failure, not the third                                                                                                                                                                                                    |
| Context compression & proxy (ADR-010)                                         | ❌ Missing, despite doc status "Accepted (2026-06-19)" | Zero matches for `compressed_payloads` table, `docuvia_retrieve_original` MCP tool, "Dumb Text Crusher" regex-fold logic, or a 24h-TTL SQLite cache anywhere in the repo. Doc's Accepted status is misleading relative to actual code state.                                                                  |
| Token management (ADR-009)                                                    | ❌ Mostly unimplemented                                | No L3/L2/L1 (50/30/20%) weight allocation, no 8192/8000-token budget constant, no `tiktoken`, no local pre-truncation logic, no "1900→300 token" evolution-phase solidification anywhere in `lib/integrations-openai-ai-server` or elsewhere.                                                                 |
| POST `/extensions/vscode/extract` route (`runtime-scenarios.md` Scenario 6.5) | ❌ Does not exist                                      | `artifacts/api-server/src/routes/extensions-vscode.ts` only has `/query`, `/create-decision`, `/file-context` — no extract endpoint, no 202/taskId response, no polling. The described async-extraction-via-API flow is entirely fictional; extraction happens client-side only inside the VS Code extension. |

**Explicitly-deferred, not silently stubbed (good citizen):**

- `lib/core/src/services/sqlite-graph.repository.ts:240` — local vector search throws `new Error("NotImplementedError: Local vector search is deferred to a future phase.")`. This is an honest, fail-loud placeholder, not a silent gap — worth noting as a positive counterexample to the rest of this report.

**Corrections (doc is stale in the other direction — already implemented, doc says otherwise):**

- L1→L2→L3 full-pipeline test — exists and passes (`generate.test.ts`), contradicting `quality-requirements.md`'s "not yet implemented" gap.
- VS Code Playwright E2E tests — real, 12 test cases across `phase1/2/3.spec.ts` (corrected 2026-07-05; originally miscounted as 14), not stubs as implied.
- Markdown export — exists (`export.ts` `/export/md` route), contradicting stale `risks-and-debt.md` R-06.

---

## 3. Features Implemented Incorrectly

### 3.1 `l2_module_id` never written on L3 decision extraction — ⚠️ CONTRADICTORY FINDINGS, needs reconciliation

- One pass found the bug is live: `artifacts/vscode-client/src/commands/extraction.ts:58-59`'s `INSERT INTO l3_nodes` statement omits the column entirely (not `""`, just unset) — every decision extracted via the VS Code extension is orphaned from its L2 module. (`risks-and-debt.md`'s R-09 misattributes this to a since-deleted `TaskRunner.ts`, but the underlying bug claim was otherwise confirmed independently.)
- A separate pass found it already fixed, in a different file: `lib/core/src/services/l3-extraction-job.service.ts:45-62` resolves `l2NodeId` from a real map and `continue`s on a miss rather than inserting `""`/leaving it unset.
- **These are plausibly two different code paths** (the VS Code extension's own local extraction command vs. a server-side extraction job) rather than a direct contradiction — but this needs a direct side-by-side read of both files before either doc's R-09 status can be trusted. Do not close R-09 as fixed without checking `extraction.ts:58-59` specifically.

### 3.2 ADR-007 routing funnel doesn't match its own diagram

- **Target**: `lib/core/src/services/router/intent-router.service.ts:37-106`
- Actual code has an undocumented `direct_lookup` short-circuit for single-word queries, and the doc's single "Hybrid/Vector LLM Arbitration" branch is really a 4-way re-classification.

### 3.3 `pg_trgm` claimed, `ILIKE` actually used

- **Target**: `lib/core/src/services/router/direct-lookup.service.ts:52-53` — code comment admits "sticking to ILIKE... for architectural continuity", contradicting ADR-007's sequence diagram.

### 3.4 HNSW never implemented, IVFFlat hardcoded

- **Target**: `lib/db/src/schema/pg/l2-nodes.ts:46-49`, `l3-nodes.ts:47-50` — both hardcode `.using("ivfflat", ...)` despite ADR-019 presenting IVFFlat/HNSW as an either/or decision.

### 3.5 Janitor never actually garbage-collects

- **Target**: `lib/core/src/services/janitor-service.ts:112-116` — only sets `validityStatus: "garbage"`, contradicting ADR-018's "safely garbage collected" wording (implies removal).

### 3.6 Two overlapping/conflicting validity fields on `commits`

- **Target**: `lib/db/src/schema/pg/commits.ts:17,26` — `valid: boolean` (default `true`) coexists with `validityStatus: text` (default `"pending"`), with no reconciling code; `valid=true` and `validityStatus="garbage"` can be simultaneously true.

### 3.7 `scope-resolver.ts` silently drops most call targets

- **Target**: `lib/core/src/services/scope-resolver.ts:100-135` — only resolves relative imports + tsconfig paths; bare npm imports return `null`; only tries `.ts/.js/.tsx/.jsx` extensions even though 11 languages are advertised as "supported" for parsing.

### 3.8 Unknown file extensions silently misparsed as TypeScript

- **Target**: `lib/core/src/services/ast-processing.service.ts:38-39`

### 3.9 WASM parse failure falls back to a naive regex but reports `success: true`

- **Target**: `lib/core/src/workers/ast-worker.ts:109-137` — regex only matches named ES imports, misses default imports/`require()`/all non-JS languages, yet masks the failure from callers/telemetry.

### 3.10 `ast-parser-roadmap.md` defeats its own stated purpose

- The doc's purpose is to "track only unfinished work," but every item under "Unfinished Items (Implementation Backlog)" is checked `[x]` / "Status: ✅ Done".

### 3.11 Stale file references in docs

- `roadmap/README.md` cites `artifacts/ast-core` (actual: `lib/ast-core`); `vscode-roadmap.md` still cites `task-runner.ts`/`central-server-client.ts`/`knowledge-store.ts`, which `vscode-client.md` itself confirms were deleted under ADR-021.

### 3.12 `native-parsing-fallback.md` contradicts the superseding ADR-020

- Doc recommends native tree-sitter-first with WASM fallback; ADR-020 explicitly bans native bindings (WASM-only). Code correctly follows ADR-020, but the older eval doc is never marked superseded/rejected.

### 3.13 ADR-013's "Adversarial Implementation Protocol" is fiction — the real agent scaffold is a linear pipeline

- **Target**: `docs/gitbook/adr/ADR-013-adversarial-implementation-protocol.md:19-40` vs. `.github/agents/*.agent.md`, `.claude/agents/*.md`, `CLAUDE.md`
- ADR-013 describes a mandatory 3-role debate (PM / QA / Developer) plus named personas "Challenger Max" and "Lead Developer Leo", minimum 3 rounds, and mandatory post-commit doc-sync. Grepping both agent directories for "Leo", "Max", "Challenger", "adversarial", "3 rounds", "debate" returns **zero matches**. The real orchestration (per `CLAUDE.md` and `task-verifier.agent.md:38-79`) is strictly linear: `requirement-analyzer` → one execution specialist → `task-verifier` (pass/re-dispatch on fail) — no debate, no consensus gate, no named personas anywhere in the actual scaffold. The ADR's vocabulary does appear near-verbatim in `.github/instructions/adversarial-workflow.instructions.md`, but that file references a nonexistent `runSubagent` tool and is not wired into `CLAUDE.md`'s orchestration rules — a second layer of aspirational-but-disconnected documentation, not evidence the protocol actually runs.

---

## 4. Hidden / Undefined Errors

**Context**: a dedicated grep sweep across `lib/*` and `artifacts/*` for TODO/FIXME/HACK/XXX and hardcoded secrets came back essentially clean — no genuine debt markers, and the only "hardcoded secret" is the `metabolism.ts:36` dev-mode fallback, which is intentionally gated behind `NODE_ENV === "development"` and fails closed (500) in production per ADR-008. The issues below are real but are mostly silent-failure/error-handling gaps, not planted debt or leaked credentials.

- `janitor-service.ts:97-104` — `.insert(commitL3LinksTable).values(...).catch(() => {})` silently discards DB errors with zero logging.
- `lib/core/src/services/l3-extraction-job.service.ts:63-69` — LLM decision-extraction and DB-insert errors are logged via `console.error` only per file, no rethrow, no monitoring signal — a single file's extraction can fail silently within a larger batch job.
- `artifacts/api-server/src/routes/metabolism.ts` has **two separate routes/auth paths** both ultimately calling `MetabolismService.runAll()` (the main route and a second `/metabolism-tick` route using a different `requireApiKey` middleware) — not confirmed harmful, but worth a direct look to make sure both paths enforce the same admin-secret guarantee ADR-008 describes.
- Empty `catch {}` blocks with no logging: `artifacts/cli/src/commands/init-agent.ts:37-39`, `lib/core/src/services/local-snapshot-service.ts:80-81,96`, `lib/core/src/services/status-service.ts:26-27` (silently ignores missing `projects` table), VS Code `extension.ts` config load, `parser.ts`, `docuvia-code-lens-provider.ts`, `chat/handlers/explore.ts`, `scope-resolver.ts`'s `loadTsConfigPaths`.
- `artifacts/api-server/src/routes/l2-nodes.ts` — no auth middleware, plus a leftover `console.log("HITTING L2 NODE POST")` debug statement.
- `artifacts/api-server/src/routes/generate.ts:60-61` — duplicated `console.error("GENERATE ERROR:", err)` call (copy-paste).
- `artifacts/mockup-sandbox/mockup-preview-plugin.ts:128-138` — chokidar watcher has no `.on("error", ...)` handler; an EMFILE error can crash the Vite dev server.
- VS Code webview message handlers chain `openTextDocument(...).then(...)` with no trailing `.catch()` — unhandled rejection risk.
- `sqlite-graph.repository.ts:95,130,153` — non-null assertions (`nodeInsert!.id` etc.) on `.get()` results with no runtime check; a silent insert no-op throws an undescribed `TypeError` mid-transaction.
- VS Code `server_url` falls back to plain `http://localhost:3000` when unset (`commands/workspace.ts:73`), silently bypassing the HTTPS-only schema validation in `types.ts:62-68`. Not documented in `configuration/settings.md`.
- Schema/column-name drift at the extension/DB boundary: `l2_node_id` (raw SQL write path in `knowledge-graph-tree-provider.ts:118`) vs. `l2_module_id` (typed read paths in `types.ts`, `dashboard-panel.ts`, `docuvia-code-lens-provider.ts`).
- `chat-participant.ts` has no top-level try/catch — synchronous throws before a handler's own try/catch escape uncaught, unlike command handlers which mostly wrap and call `showErrorMessage`.
- `lib/ast-core/src/detector/semantic-diff.ts:48-49` — `if (oldTree) if (oldTree) oldTree.delete();`, a duplicated nonsensical condition indicating this code (which is otherwise dead/orphaned — see 3.x findings on `SemanticDiffDetector`) was never actually reviewed in a real code path.
- `withRollback()` test helper — one verification pass found it at `lib/test-utils/src/db.ts:1-4` (re-exported from `@workspace/db`, used across 15+ integration tests); a second pass found zero references anywhere. **Needs reconciliation** — likely a search-scope discrepancy between the two audit passes, not yet independently resolved.
- **Git post-commit hook — contradictory findings, needs reconciliation.** One pass (`roadmap-checklist` verification) found a real, idempotent hook writer at `lib/core/src/services/init-service.ts:46-77` (writes a `#!/bin/bash` hook firing `npx docuvia sync --local &`). A separate pass (`runtime-scenarios.md` Scenario 6.8 verification) checked `artifacts/cli/src/commands/init.ts`/`init-agent.ts` specifically and found **no** `.git/hooks/post-commit` file installed anywhere, concluding the hook claim is aspirational. These may both be correct if `init-service.ts`'s hook-writing code exists but is never actually called from the CLI's `init`/`init-agent` command paths — **this wiring needs to be checked directly** before trusting either doc's claim about automatic sync-on-commit.

---

## 5. Notes on Audit Process

This report was compiled from roughly 19 parallel/nested subagent audit passes across architecture docs, all 26 ADRs, package docs, VS Code client docs, roadmap/capability-matrix self-claims, runtime-scenarios.md, the agent scaffold (`.github/agents/`, `.claude/agents/`), and the `evaluate/` technical-spike docs. One subagent pass surfaced and correctly refused a suspicious mid-task message impersonating an authority instructing it to fabricate findings without verification — it declined, took no destructive action, and the relevant ADR-004/017/018 findings were independently confirmed by a separate legitimate pass instead (see §1.1–1.3, §2 Outbox/GC/edge-type rows).

Two items above are flagged as needing direct reconciliation rather than a confident verdict (`withRollback()` location, and whether the git post-commit hook is actually wired up) — different passes searched different scopes and reached opposite conclusions. Treat those two specifically as "needs a follow-up look," not settled findings.
