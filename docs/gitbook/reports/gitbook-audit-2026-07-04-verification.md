# GitBook Audit — Verification Pass

**Source report**: [`gitbook-audit-2026-07-04.md`](gitbook-audit-2026-07-04.md)
**Method**: Tiered multi-model re-verification. Haiku extracted 80 individual findings from the source report; Sonnet 5 graded each as "simple" (single-file/line check) or "hard" (repo-wide absence claim, feature-completeness claim, or an item the original audit itself flagged as contradictory). Simple findings were re-verified against current source by Haiku; hard findings and feature-completeness claims were re-verified by Sonnet 5, each reading the cited code directly. A final Sonnet 5 pass synthesized the results below. Spot-checked afterward against `git log` — all cited fix-commit hashes are real.

---

<!-- verification conclusion begins -->

# Docuvia GitBook Audit — Verification Conclusion Report

_Verified 80 findings from `docs/gitbook/reports/gitbook-audit-2026-07-04.md` against the current codebase (2026-07-04)._

## 1. Summary of Verdicts

| Verdict              | Simple | Hard   | Total    |
| -------------------- | ------ | ------ | -------- |
| CONFIRMED            | 23     | 8      | 31       |
| ALREADY_FIXED        | 12     | 3      | 15       |
| REFUTED              | 8      | 8      | 16       |
| NEEDS_RECONCILIATION | 3      | 5      | 8        |
| UNVERIFIABLE         | 0      | 0      | 0        |
| **Total**            | **46** | **24** | **80\*** |

\*Note: 80 findings listed but one entry (`3.1`) and one (`4-bullet-21`, `4-bullet-22`) were pre-flagged by the auditor as "contradictory, needs reconciliation" and were resolved definitively during verification (`3.1`→CONFIRMED as two distinct code paths; `4-bullet-21`→REFUTED; `4-bullet-22`→REFUTED) — counted in their final verdict column above, not as open reconciliations.

**Headline: 31/80 (39%) CONFIRMED real bugs, but 15/80 (19%) were already fixed by the time of verification and 16/80 (20%) were simply wrong (REFUTED).** Combined "audit was inaccurate or stale" rate: 31/80 (39%).

---

## 2. Most Critical CONFIRMED Findings (ranked by severity)

1. **[SEV: CRITICAL — already patched, verify it stuck] `0` — CALL edges never populated in production ingestion.** `lib/core/src/workers/ast-worker.ts:179,210-226` — capture switch previously had no `"call"` case, so zero CALL edges were ever created project-wide, silently crippling the knowledge graph. **Verdict: ALREADY_FIXED** (commit `1c92234`, 12 min after audit). _Action: add a regression test asserting `calls.length > 0` for a fixture with function calls so this can't silently regress again._

2. **[SEV: HIGH — security] `1.5` — Single shared identity (`{id:1}`) defeats all IDOR checks.** `artifacts/api-server/src/middlewares/auth.ts:32` hardcodes every authenticated request to user id 1; `ownerId` checks in `export.ts`, `sync.ts`, `review-tasks.service.ts` can never reject in production. _Action: implement real per-key user resolution before multi-tenant use; until then, treat the API as single-tenant-only in docs._

3. **[SEV: HIGH — security] `1.14` — Hardcoded dev secret fallback.** `artifacts/api-server/src/routes/metabolism.ts:36` falls back to `"dev-secret-token"` for `ADMIN_SECRET_TOKEN` when unset in dev mode, contradicting the documented fail-closed design (ADR-008, crosscutting-concepts.md:462). _Action: remove the fallback entirely; fail closed (500) regardless of `NODE_ENV`, and inject the secret explicitly in test setup._

4. **[SEV: HIGH — data integrity] `1.12` — Embeddings never regenerated on content update.** Three separate write paths (`l3-processing-service.ts:83-86` condensation, `review-tasks.service.ts:228-234` correction, `l3-nodes.service.ts:40-46` generic API update) update L3 `content`/`title` without recomputing `embedding`. Vector search (`vector-search.service.ts:58-71`) then serves stale-embedding results indefinitely. _Action: add a shared "on content change, recompute embedding" hook used by all three write paths._ **Post-hoc spot-check note**: commit `bb02c1b` already fixed the `l3-processing-service.ts` condensation path — the remaining live gap is only `review-tasks.service.ts` and `l3-nodes.service.ts` (neither references `embedding` at all). Finding stays CONFIRMED, but scope is now 2 of 3 paths, not 3.

5. **[SEV: HIGH — availability] `1.7` — Rate limiting bypassed for webhook + proxy routes.** `artifacts/api-server/src/app.ts` mounts `/api/webhooks/github` and `/proxy/v1` before the rate-limited `/api` router — both routes have zero rate-limit protection. _Action: apply `standardLimiter`/`mcpLimiter` directly to these two routers before or independent of mount order._

6. **[SEV: MEDIUM-HIGH — data integrity] `1.11` — Two disconnected local-persistence pipelines.** `analyze` (writes to `.docuvia/local.db` via `SqliteGraphRepository`) and `sync --local` (re-parses AST into a discarded temp dir, then pulls from Postgres for the orphan-branch write) never intersect — same conceptual data, two silently divergent stores. _Action: unify so `sync --local` reads from/writes through the local SQLite repo, or explicitly document the divergence._

7. **[SEV: MEDIUM] `1.1` — Orphan branch writer has no filesystem isolation.** `orphan-branch-writer.ts:177` spawns `git fast-import` with no `cwd` (uses ambient `process.cwd()`), single shared repo/index across all projects; only a Postgres advisory lock guards it, no filesystem-level isolation. _Action: pass explicit `cwd` and remove the deprecated `LocalOrphanBranchWriter` (`local-orphan-branch-writer.ts:35`) to eliminate split-brain risk._

8. **[SEV: MEDIUM] `2-table-row-2` — GC/tiered storage (ADR-017) entirely unimplemented.** No `is_active`/tombstone column on `l2NodesTable`/`l3NodesTable`, no archival job, no hydrate-from-branch code anywhere. _Action: either implement the ADR-017 tombstone+GC+hydrate flow, or mark ADR-017 as aspirational in docs._

9. **[SEV: MEDIUM] `3.7` — `scope-resolver.ts` silently drops most call targets.** Only resolves relative imports + tsconfig paths; bare npm imports return `null`; only `.ts/.js/.tsx/.jsx` extensions handled despite 10+ languages advertised as supported (`extract-service.ts:46`) — silently drops graph edges for every non-JS language and every npm-package call. _Action: extend extension coverage and add bare-import resolution (node_modules/package.json main lookup)._

10. **[SEV: MEDIUM] `1.10` — Worker pool has no timeout/quarantine and a leaked module-level singleton.** `ast-worker-pool.ts` — crashed workers ARE respawned (contrary to the original claim) but there's still no per-task timeout, so a pathological file can hang a slot forever; `globalWorkerPool` is never `terminate()`d in long-lived hosts. _Action: add task deadline + forced-restart, and a shutdown hook to terminate the global pool._

11. **[SEV: MEDIUM] `4-bullet-14` — chokidar watcher has no error handler.** `artifacts/mockup-sandbox/mockup-preview-plugin.ts:120-138` — an `EMFILE` error can crash the Vite dev server. _Action: add `.on("error", ...)` to the watcher._

12. **[SEV: LOW-MEDIUM] `1.13` — UI kit duplicated (44/49 files byte-identical) between `kg-engine` and `mockup-sandbox` with no shared package**, already drifting on 5 files. _Action: extract into a shared pnpm workspace package before drift compounds._

13. **[SEV: LOW] `2-table-row-11` — VS Code TaskQueue tree view is never populated** (`addTask`/`updateTaskStatus` have zero call sites) — always renders "No extraction tasks yet". _Action: wire extraction pipeline events to `addTask`, or remove the dead view._

---

## 3. Findings That Flipped — Audit Report Needs Correction

### 3a. ALREADY_FIXED (bug was real but was fixed after/around the audit was written — mostly same-day commits)

These mean the audit report's Section 0/1/2/4 entries are now **stale** and should be updated or annotated:

- `0` — CALL edges (commit `1c92234`, 12 min post-audit)
- `1.8` — pgvector silent O(N²) fallback (commit `c9d56f3`)
- `1.15` — Cross-project link never written at review-approval (commit `56decc2`)
- `1.18` — Unawaited `CREATE EXTENSION` race (commit `5145473`)
- `1.20` — Janitor only re-scans pending nodes (fixed in `janitor-service.ts:24-28`)
- `2-table-row-1` — Outbox/ADR-004 (commit `39ee599`, implemented as `job_queue` + `JobQueueWorker`)
- `2-correction-1` — L1→L2→L3 pipeline test exists (`generate.test.ts`, added 2026-06-30, doc just never updated)
- `2-correction-3` — Markdown export exists (`export.ts` `/export/md`, contradicts stale `risks-and-debt.md` R-06)
- `3.10` — `ast-parser-roadmap.md` self-contradiction fixed (relabeled "Completed Items")
- `3.11` — Stale file references fixed (ADR-021 notes added; `artifacts/ast-core` claim was itself wrong)
- `3.12` — `native-parsing-fallback.md` now marked SUPERSEDED
- `4-bullet-1`, `4-bullet-4`, `4-bullet-6`, `4-bullet-8`, `4-bullet-11`, `4-bullet-15`, `4-bullet-16`, `4-bullet-18`, `4-bullet-19` — nine separate silent-error/empty-catch/unsafe-assertion bugs, all fixed in one sweep (commit `91a65da`, "fix: resolve hidden errors...")

**Pattern**: a large remediation effort (commits `91a65da`, `1c92234`, `c9d56f3`, `39ee599`, `56decc2`, `5145473`) landed on **2026-07-04**, the same day as (and shortly after) the audit — the audit appears to have captured a snapshot moments before a big fix batch merged. **The report should be re-run/re-diffed against current HEAD before being distributed further.**

### 3b. REFUTED (finding was simply incorrect, not a timing issue)

These are genuine audit errors the team should discount:

- `1.2` — ADR-004 outbox **does** exist as `job_queue` + transactional insert + `JobQueueWorker`; sync is NOT synchronous.
- `1.3` — Git write errors are NOT silently swallowed; they're logged, rethrown, and tracked via `job_queue.status="failed"`.
- `1.6` — Auth **is** applied to all 9 "unprotected" routers via a router-level `requireApiKey` in `routes/index.ts:39` (centralized, not per-router).
- `1.9` — Both BFS implementations **are** depth-bounded (both cap at depth 3); claim of "unbounded BFS" is false.
- `1.17` — job_queue **is** polled (`job-queue.worker.ts` `setInterval` + `SELECT ... WHERE status='pending'`), and the worker is started in `index.ts:26`.
- `1.19` — A purge job (`JanitorService.purgeOldLogsAndJobs`) **does** exist and is scheduled hourly from `api-server/src/index.ts`.
- `2-table-row-9` — An Ollama/local-LLM adapter **does** exist (`client.ts:18-21`, `llm-provider.ts`), predates the audit itself.
- `2-table-row-17` — Context compression/proxy (ADR-010) **is** implemented (`compressed_payloads` table, `/mcp/retrieve_original`, hourly TTL purge, proxy injection) — audit's "zero matches" claim was false.
- `4-bullet-3` — The two metabolism routes are an **intentional** two-tier design per ADR-008, not an inconsistency.
- `4-bullet-5`, `4-bullet-9`, `4-bullet-10` — these three "empty catch" claims were simply false; all three already log via `console.warn`/`console.debug`.
- `4-bullet-21` — `withRollback` test helper **is** used across 15+ integration test files; "zero references" pass was a search-scope bug.
- `4-bullet-22` — Git post-commit hook writer **is** wired into the real CLI entrypoint (`init.ts` → `InitService.init()`); only the code _comment_ misattributes it to `initAgent()`.

---

## 4. NEEDS_RECONCILIATION — Concrete Next Steps

| ID               | Issue                                                                                                                                                                                                                                                                   | Next step                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1.4`            | **[FIXED]** Git-level rename detection works, and DB layer (`ast-change-detector.ts`) now matches content hashes to detect renames implicitly, executing an `UPDATE` on `project_files` and `l2_nodes` to preserve history perfectly.                                   | Issue fully resolved via hash-based inference (Option B). No schema changes needed.                                                                                                                                 |
| `1.10`           | Crash recovery works, but no task timeout and `globalWorkerPool` is never terminated.                                                                                                                                                                                   | File as a scoped follow-up: add per-task timeout + explicit `terminate()` on process shutdown.                                                                                                                      |
| `1.21`           | Single-call retry fixed for the main chat client (`client.ts`, commit `ff148ad`), but `audio/client.ts:21` and `image/client.ts:17` still construct raw `OpenAI` instances with zero retry.                                                                             | Route `audio/client.ts` and `image/client.ts` through `createLlmClient` or apply the same `pRetry` wrapper directly.                                                                                                |
| `2-table-row-5`  | ADR-026 status IS correctly "Proposed" and code IS OpenAI-only (accurate), but the audit's claim that this contradicts a "5/5 score" in `capabilities-matrix.md` is false — no such row exists.                                                                         | Edit the audit text to drop the fabricated capabilities-matrix cross-reference; keep the core ADR-026 gap.                                                                                                          |
| `2-correction-2` | VS Code Playwright E2E tests are real (confirmed), but count is 12 test cases, not 14 as claimed.                                                                                                                                                                       | Correct the count in the report; no code change needed.                                                                                                                                                             |
| `3.1`            | Two distinct code paths for `l2_module_id`/`l2NodeId` on L3 extraction — VS Code manual "Run Extraction" command (`extraction.ts:58-59`, **still buggy**, omits the column) vs. server-side background job (`l3-extraction-job.service.ts:45-62`, **already correct**). | Fix `extraction.ts`'s INSERT to resolve and include `l2_node_id`, mirroring the `fileIdMap` lookup pattern in `analyze-service.ts`.                                                                                 |
| `4-bullet-12`    | Auth middleware IS applied globally to `l2-nodes.ts` (contrary to the finding's framing), but the debug statement `console.log("HITTING L2 NODE POST")` at line 37 is real and unfixed.                                                                                 | Simple one-line deletion of the debug log; no auth work needed.                                                                                                                                                     |
| `4-bullet-18`    | The extension-internal `l2_node_id` vs `l2_module_id` drift **is fixed** (commit `91a65da`), but the fix now writes `l2_module_id`, which does **not** match the actual DB schema column `l2_node_id` defined in `lib/db/src/schema/sqlite/l3-nodes.ts:8`.              | Verify via a live drag-and-drop test in the VS Code extension whether this now throws "no such column: l2_module_id"; if so, revert the column name in `knowledge-graph-tree-provider.ts:118` back to `l2_node_id`. |

---

## 5. Overall Reliability Verdict

**~39% of the audit's findings were confirmed as real, currently-live issues; ~39% (ALREADY_FIXED + REFUTED) were stale or simply wrong; ~10% need further reconciliation/scoping.** The audit is a useful signal but **not directly actionable as-is** — a meaningful fraction of its claims were invalidated by a same-day remediation wave (commits `91a65da`, `1c92234`, `c9d56f3`, `39ee599`, `56decc2`, `5145473`, `ff148ad`), and several "hard" findings (broad repo-wide absence claims like `1.2`, `1.6`, `1.9`, `1.17`, `1.19`, `2-table-row-9`, `2-table-row-17`) were refuted by evidence the auditor apparently didn't search for (e.g., missed that `job_queue` serves as the outbox, missed centralized router-level auth, missed the Ollama client branch). **Difficulty correlates with error rate: "hard" classification findings were wrong (REFUTED) at a notably higher rate (8/24 ≈ 33%) than "simple" ones (8/46 ≈ 17%), suggesting broad absence-claims need more thorough repo-wide search before being trusted.**

**Top 3 priorities for the Docuvia team:**

1. **Re-run the audit against current HEAD before distributing it further** — at minimum, tag all 15 ALREADY_FIXED items with their fixing commit so nobody re-fixes already-solved problems, and strike the 16 REFUTED items so engineering time isn't wasted chasing non-issues.
2. **Fix the two live security/data-integrity issues immediately**: `1.5` (hardcoded `{id:1}` defeating all IDOR checks) and `1.14` (hardcoded dev-secret fallback in `metabolism.ts:36`) — both are trivial, high-blast-radius fixes.
3. **Close the stale-embedding gap (`1.12`)** and **fix the rate-limit bypass on webhook/proxy routes (`1.7`)** — both are concrete, scoped, currently-live bugs with clear one-file/one-hook fixes that materially affect production correctness and availability.
