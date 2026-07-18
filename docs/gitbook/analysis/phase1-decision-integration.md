# Phase 1 — Decision Integration & Implementation Handoff (2026-07-16)

> **Inputs integrated:** [Background Knowledge Loop — Gap Analysis](background-knowledge-loop-gap-analysis.md)
> (2026-07-16), [Cross-Product CLI Benchmark](cross-product-cli-benchmark.md) (2026-07-13, live-verified),
> and [PLAT-007 — Tiered Background Knowledge Evolution](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md)
> (accepted 2026-07-16).
>
> **Method:** every load-bearing claim from the input reports was re-verified against the working
> tree today before deciding. This report is the final integration; implementation is dispatched
> from §5.

---

## 1. Reconciliation of the two analyses

The two reports describe the same product at different dates and different altitudes. Integrated:

| Claim                                          | Benchmark (7/13) | Gap analysis (7/16)                  | Verified today (working tree)                                                                                             |
| ---------------------------------------------- | ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `dist/cli.js` unbootable (duplicated shebang)  | ❌ blocking bug  | not mentioned                        | **Fixed** — `artifacts/cli/tsup.config.ts` no longer injects a shebang banner (only the `createRequire` banner remains)   |
| AST worker crash-loops on `encoding.js` import | ❌ blocking bug  | init Phase 4 works                   | **Fixed** — `lib/core/src/ast/ast-worker.ts` inlines the constants instead of importing `../constants/encoding.js`        |
| Graph is empty / `analyze` produces 0 nodes    | ❌               | Wire 1: hook snapshots a stale graph | **Still true as designed** — no-arg `analyze` is config-scan-only (`analyze-workflow.ts:75-98`); ingestion only at `init` |
| L3 decisions evaporate (print-only)            | not tested       | Wire 2                               | **實作進行中，尚未完全驗證** (In Progress / Partially Verified - 2026-07-17)。已於 Slice 1 實作 L3 持久化與 Upsert 去重   |
| snapshot/hydrate git plumbing works            | ✅ verified      | ✅                                   | unchanged                                                                                                                 |

**Conclusion:** the benchmark's two blocking bugs are already fixed; its remaining Docuvia2
action items (non-interactive `init`, `uninstall` confirmation) are real but orthogonal to
Phase 1 and stay on the watchlist. The gap analysis's three-wire framing plus PLAT-007's tier
decisions are the authoritative Phase 1 scope. **Nothing found today contradicts PLAT-007 —
it stands as accepted.**

## 2. Integrated decision — what Phase 1 implements, in order

PLAT-007's ordering is confirmed as the best solution; no competing alternative from either
report survives (full re-index per commit, new `update` command, `snapshot --evolve`, resident
daemon — all already rejected in the ADR with reasons that still hold):

1. **Slice 1 — Wire 2: L3 persistence** (已於 2026-07-16 實作，狀態：正在進行尚未完全驗證 - 2026-07-17). Smallest, fully independent,
   the owner's standing top concern, and unblocks `sync`'s existing push pipeline.
2. **Slice 2 — Tier A**: `analyze` auto mode (sha fast-path + `SemanticDiffDetector` delta
   re-parse) + hook flip from `snapshot` to `analyze`. **Gated** by the `analyze`+`snapshot`
   and `doctor`+`hydrate` concurrency tests (still open per `docs/cli-test-analysis/README.md`
   status table).
3. **Slice 3 — Tier B**: real `escalateToLsp` (spawn-per-batch), one-snapshot-per-batch,
   pre-push + commit-cap triggers.
4. **Slice 4 — Tier C**: budgeted async LLM queue, local endpoint default via LLM-002 bridge.
5. **Slice 5 — Reliability**: `doctor` detects "hook present but docuvia not resolvable" and
   LLM endpoint reachability.

### Resolution of PLAT-007's one open sub-decision (idle-timer mechanism)

**Decision: pre-push + commit-cap only for Phase 1; no idle timer.** Of the three options the
ADR left open (OS scheduled task / piggyback-on-next-run / pre-push-only conservative default),
the conservative default wins for Phase 1: an OS scheduled task is a per-repo, cross-platform
registration surface (a daemon-manager in disguise — the exact shape this repo rejects), and
piggyback-on-next-run adds latency jitter without guaranteeing freshness. The commit cap is
already mandatory per PLAT-007's own risk note, so Tier B liveness is bounded without a timer.
Revisit an idle mechanism only if real usage shows batches waiting too long — same
"measured pain first" rule the ADR applies to warm LSP instances.

## 3. Slice 1 (Wire 2) — integration-level design decisions

Verified against schema `0001_init.sql:92-113` and contracts. Three gaps the ADR's one-line
spec didn't resolve, decided here:

### 3a. Schema: two additive columns, one new migration

`l3_nodes` already has `commit_hash`, `source_commits`, `confidence`, `content_hash` (indexed),
`validity_status` (default `'pending'` — already the GRPH-002 phase PLAT-007 asks for), and
`source`. Missing vs. PLAT-007's provenance list: the **extraction model** and the **source
file list**. Decision: new migration `0004_l3_provenance.sql` adding two nullable columns —
`extraction_model TEXT`, `source_files TEXT` (JSON array of workspace-relative paths). Additive
`ALTER TABLE ... ADD COLUMN` only; no table rebuild, no backfill (pre-existing rows keep NULL).

### 3b. Anchoring: resolve `l2_node_id` via `node_key`, never invent graph nodes

`l3_nodes.l2_node_id` is `NOT NULL`, but `analyze <targetPath>` decisions are extracted from a
file **or directory** target. Decision — resolve in this order:

1. Exact match: L2 node whose `node_key` (STOR-005 deterministic `<file_path>` /
   `<file_path>#<symbol>` identity) equals the workspace-relative target path.
2. Directory target / no exact match: the file-level L2 node of the **first collected source
   file** that has one (the extraction already knows its file list from `collectSourceFiles`).
3. No L2 node at all (graph empty — `init` never ran ingestion): **persist nothing, warn
   clearly** ("run `docuvia init` first — decisions need a graph to attach to"), exit 0, and
   still print the decisions. Rationale: inventing synthetic L2 anchor nodes pollutes the graph
   Tier A is about to make real, and relaxing `NOT NULL` in SQLite means a table rebuild — both
   worse than an honest precondition. Tier A (Slice 2) makes this branch rare.

### 3c. Dedup: content-hash upsert, occurrence bump

`content_hash` = sha256 over `nodeType + "\n" + title + "\n" + content` (normalized). On hash
match for the same project: bump `occurrence_count`, refresh `last_verified_at`, append the
current commit to `source_commits` if new — do **not** insert a duplicate row. This mirrors the
`sync-state.json` content-hash pattern PLAT-007 names, and the `l3_nodes_content_hash_idx`
index already exists for it. New rows: `commit_hash` = HEAD sha at extraction time,
`source_commits` = `[HEAD]`, `source` = `'analyze'`, `ai_generated` = 1,
`validity_status` = `'pending'` (column default).

### 3d. Surfaces touched

- `IL3NodesRepo` (contracts) + `L3NodesRepo` (schema): add the write/upsert method; delete the
  "deliberately no write methods" comment whose reason expires with this change. FTS triggers
  on `l3_nodes` already keep `l3_nodes_fts` in sync — no extra FTS work.
- `AnalyzeWorkflow.executeDecisionExtraction`: after parsing decisions, resolve anchor + persist
  through the repo (graph store opened the same way other workflows do), append a
  `analyze.focused.persisted` JSONL log line with counts.
- `analyze.ts` CLI: report "N persisted, M deduplicated" after the existing per-decision output.
- Tests: unit tests for the upsert (new/dup/occurrence bump), anchor resolution (file / directory
  / empty-graph), and a workflow-level test that a mocked LLM response lands as `l3_nodes` rows
  with full provenance. `insertL3NodeFixture` (graph-store integration test helper) can retire
  in favor of the real write path where it makes tests clearer.

**Acceptance for Slice 1:** `pnpm run build` + full test suite green; `analyze <targetPath>`
twice on the same target yields rows once with `occurrence_count` bumped, not duplicated;
`export-topology`/`sync` read paths see the rows without modification.

## 4. Watchlist (unchanged, carried forward)

Benchmark items not in Phase 1 scope: non-interactive `init` flag, `uninstall` global-config
confirmation, borrow-visualization ideas. Gap-analysis watchlist items (stale `--global` flag,
MCP `docuvia_init` lock bypass, `sync`/`sync-knowledge` naming, stale STOR-002/LLM-README
notes) remain parked for Phase 2+ or doc passes.

## 5. Handoff

Slice 1 is dispatched to a Sonnet-class implementation agent with this report as the spec
(§3 is the contract; the implementer has latitude on code placement, none on the decisions).
Slices 2–5 follow sequentially, each gated by verification of the previous; Slice 2 additionally
requires the two open concurrency tests before the hook flips.

> **Status update (2026-07-16):** Slice 1 implemented, task-verifier passed, committed as
> `871c961`. Slice 2's integration-level contract is §6 below.

## 6. Slice 2 (Tier A) — integration-level design decisions

PLAT-007's Tier A section is the spec; the gaps it leaves to implementation are decided here.
Slice 2 ships as **two sequential dispatches**: **2a** — `analyze` auto mode with delta
ingestion, hook untouched; **2b** — the two gating concurrency tests, then the hook flip. The
hook must not call `analyze` until 2b's tests pass (PLAT-007 reliability requirement).

### 6a. Mode selection and the last-ingested sha

No-arg `analyze` becomes auto mode (breaking change accepted in PLAT-007):

- **Full ingestion** when the graph has no project row or no L2 nodes: the same pipeline `init`
  Phase 3–4 uses (discovery → config scan → `AstProcessingService` → `GraphPersister`), reusing
  those components — not a re-implementation. The old config-scan-only output becomes a step of
  this (its result still reported); tests and user-facing docs update in the same change.
- **Delta ingestion** otherwise, anchored on a new `docuvia_meta` key (`GitConstants`
  addition, e.g. `META_KEY_LAST_INGESTED_SOURCE_SHA`) written after every successful full or
  delta ingestion. Resolution order when the key is absent (pre-Slice-2 workspaces): newest
  `Docuvia-Source` trailer on the knowledge branch, else full re-ingest once.
- **Sha fast-path**: `HEAD == lastIngestedSourceSha` → log (`analyze.delta.noop` JSONL line)
  and exit 0 immediately. This is the idempotency fast-path; it must be the first check.
- `analyze <targetPath>` behavior (Slice 1) is untouched; `--escalate-to-lsp` is Slice 3, not
  this slice.

### 6b. Delta semantics: re-parse changed files; detector classifies for Tier B

- Diff `lastIngestedSourceSha → HEAD` (name-status). Added/modified source files — filtered by
  the same discovery ignore/oversize rules `init` uses — are re-parsed through
  `AstProcessingService` and re-persisted. Per-file replace: delete the file's existing L2 rows
  (and their links) before persisting its fresh parse. Deleted files: drop their L2 rows.
  Renames: treated as delete + add. Cross-file edge drift is accepted per PLAT-007 (Tier B is
  the backstop).
- **`SemanticDiffDetector`'s Tier A role is classification, not parse-avoidance**: changed
  files are re-parsed regardless (cost ∝ diff, already sub-second); the detector runs on each
  changed file (old content via `git show <sha>:<path>`, new from HEAD, hunk line-ranges from
  the diff) solely to assign pruning levels. Any `CONTRACT_CHANGED` node enqueues its file for
  Tier B. This keeps Tier A simple while giving Tier B exactly the queue PLAT-007 specifies.
- **Tier B queue storage**: a `docuvia_meta` key (`tierBQueue`) holding a JSON array of
  `{file, commitSha}` entries, deduped by file. Disposable like the rest of `local.db` (git
  remains the source of truth); consumed by Slice 3. No new table.
- Locking: the delta persist step takes the knowledge-branch lock (PLAT-007 reliability
  requirement), same discipline as `hydrate`/`snapshot`. Failures go to JSONL logs
  (`analyze.log`) and `process.exitCode`, never to the committing developer.

### 6c. Dispatch 2b: concurrency tests, then the hook flip

1. **Gating tests** (open items in `docs/cli-test-analysis/README.md`): concurrent
   `analyze` (delta write) + `snapshot` (read + pack), and concurrent `doctor` + `hydrate` —
   following the existing `analyze-concurrency.test.ts` pattern. Both must pass before step 2.
2. **Hook flip with legacy upgrade**: `POST_COMMIT_HOOK_CONTENT` switches to
   `npx --no-install docuvia analyze`; `POST_COMMIT_HOOK_MARKER` becomes `"docuvia analyze"`
   with the old `"docuvia snapshot"` retained as a legacy marker constant.
   `installPostCommitHook` recognizes a legacy block and replaces it in place (under the
   existing knowledge-branch lock, PLAT-006 discipline) instead of appending a duplicate.
   `doctor`'s "legacy hook" and "hook present but docuvia not resolvable" checks stay in
   Slice 5.

**Acceptance for Slice 2:** full build + suite green; on a real repo: commit → hook fires →
changed file's L2 rows update while unchanged files' rows are untouched; second run with no new
commit is a sub-second no-op (fast-path); `CONTRACT_CHANGED` edits land in `tierBQueue`;
`snapshot` output unchanged in shape. Hook flip present only after both concurrency tests exist
and pass.

### 6d. Dispatch 2a — post-implementation rulings (2026-07-17)

Dispatch 2a is implemented (build green, full suite 98 files / 599 tests green). The
implementer flagged three judgment calls; owner-level rulings:

1. **No hydration attempt before full ingestion (empty `local.db`, knowledge branch has data)
   — accepted, not a defect.** A fresh re-parse of HEAD is at least as current as any
   knowledge-branch snapshot (which may itself be the stale day-one graph Wire 1 produced),
   and the post-ingestion `markSynced` call — the same discipline `init` uses — prevents a
   later `ensureHydrated` from clobbering the fresh graph with the older snapshot.
   _Follow-up (optimization, not correctness):_ on large repos, hydrate-then-delta (hydrate
   the snapshot, then delta from its `Docuvia-Source` trailer to HEAD) would be cheaper than a
   full re-parse. Parked on the watchlist.
2. **Missing integration tests for the new libgit2 surface — ruled blocking; fixed before 2b.**
   The two-ref mode of `getChangedFilesSince` (added/modified/deleted/renamed between two
   shas) and `getChangedLineRanges` (`git diff --unified=0` hunk-header parsing) are the
   foundation delta ingestion stands on, and real shell-out parsing was only exercised through
   mocks. Tests added to `libgit2-provider.integration.test.ts` following its existing
   real-temp-git-repo pattern.
3. **Generic `IKnowledgeGitService.runUnderKnowledgeLock<T>` pass-through — accepted.** It is
   the minimal surface that lets `lib/ui-core` honor the locking requirement without breaking
   the Virtual Contracts token-only boundary, and it mirrors the existing
   `withKnowledgeBranchLock` helper's shape exactly.

### 6e. Dispatch 2b — completion record (2026-07-17)

Dispatch 2a committed as `0e66ed6`. Dispatch 2b implemented per §6c in order (error JSONL →
the two gating concurrency tests → hook flip), first verification **failed** on two surgical
defects — `openStore` sat outside the `analyze.auto.error`-logged try (a `DB_OPEN_FAILED`
would still be an invisible failure), and a stale "fires `docuvia snapshot`" docstring — both
fixed and re-verified (build green; 100 test files / 616 tests green, including a new
store-open-failure regression test). Deviation accepted: one `analyze.auto.error` event
instead of per-mode names, since a failure can precede mode determination.

**Verification findings worth keeping (Tier A semantics):**

- **No hook self-trigger is possible**: knowledge-branch writes go through `git fast-import`
  / `commit-tree` plumbing, which never fires the post-commit hook; and any spurious re-entry
  hits the sha fast-path noop.
- `init` never writes `lastIngestedSourceSha` — the first post-`init` delta resolves its
  baseline via the knowledge branch's `Docuvia-Source` trailer fallback. By design, not a bug.
- `uninstall` has never removed the git post-commit hook (pre-existing; mitigated by
  `npx --no-install`'s silent no-op). Slice 5's `doctor` checks are the home for this and for
  detecting a user-edited legacy hook block (bytes diverged → upgrade degrades to
  append-without-removal, leaving both blocks live).

**Slice 2 status: complete** (pushed as `b316f2f` + merge `9b6d517` + `056939a`). Wire 1 is
closed — the post-commit hook now runs `docuvia analyze` (auto mode), per-commit L2 freshness
lives in `local.db`, and the two `cli-test-analysis` concurrency items (`analyze`+`snapshot`,
`doctor`+`hydrate`) are closed. Merge note: the upstream magic-strings sweep landed mid-slice;
Slice 2 code now follows its conventions (`GitMessages`, `ANALYZE_EVENTS`, `AnalyzeResultKind`,
`ChangedFileStatuses`) and the ESLint cyclomatic-complexity budget (max 10) is enforced in
pre-push — future slices must budget for it. Next: §7.

## 7. Forward log — Slices 3–5 (recorded ahead of implementation, 2026-07-17)

What remains of Phase 1, with everything the Slice 1/2 work established that feeds it. Slice 3
needs a §6-style integration contract **before** dispatch; the open sub-decisions to settle are
listed explicitly. _(Update 2026-07-17: settled — §8 below is that contract.)_

### 7a. Slice 3 — Tier B: LSP escalation batch

**Already decided** (PLAT-007 + §2 of this report — not to be re-litigated):

- Implement `escalateToLsp` for real; **spawn-per-batch** headless LSP, no resident daemon.
- Batch = the composition `analyze --escalate-to-lsp && snapshot`, orchestrated by a thin
  scheduler — `--escalate-to-lsp` is a flag on `analyze`, never a new command.
- Triggers: **pre-push hook + commit cap (default 20) only** — no idle timer in Phase 1.
- LSP runs **only over the accumulated `tierBQueue`** (`docuvia_meta` JSON of
  `{file, commitSha}` deduped by file, written by Tier A since `0e66ed6`); a queue with only
  `INTERNAL_LOGIC` changes skips LSP entirely.
- **One snapshot per batch** — this is the knowledge-branch growth policy; Tier A never
  snapshots.
- Locking/logging discipline: knowledge-branch lock for writes, JSONL run logs, failures only
  to logs + exit code (same bar the 2b verifier enforced on Tier A).

**Open sub-decisions for the Slice 3 contract** (settled 2026-07-17 — owner rulings in §8; the
original list is preserved below as recorded):

1. **LSP server choice + bootstrap**: which server (`typescript-language-server` vs raw
   `tsserver`), how it's resolved (user-supplied binary? npx? bundled?), and what `doctor`
   should say when it's absent. IMPT-003 names the tri-layer but not the binary.
2. **What "corrected edges" means concretely**: which LSP capabilities run (references,
   definitions?) over queue files, and how results map onto `node_links` rows — including
   whether stale _incoming_ edges (the drift Tier A accepts on per-file replace) get repaired
   here, which is the whole point of the backstop.
3. **Queue consumption semantics**: drain-all vs batch-size cap; on LSP failure, re-queue or
   drop-with-log; queue entries whose file has since been deleted.
4. **Commit-cap counter**: where it lives (a `docuvia_meta` counter bumped by Tier A vs derived
   from `lastIngestedSourceSha..HEAD` commit count at hook time) and where it resets.
5. **Pre-push hook mechanics**: reuse `installPostCommitHook`'s marker + lock + legacy-upgrade
   pattern for a `pre-push` hook; decide interplay with Phase 2's `sync-knowledge` scheduling
   so the two pre-push steps don't double-fetch (gap analysis §6 Phase 2 flags this — decide
   them **together**).
6. **Gating tests**: batch vs concurrent `analyze`/`snapshot`; a batch interrupted mid-LSP
   (crash) must leave the queue re-runnable (idempotency).

### 7b. Slice 4 — Tier C: budgeted async LLM queue

Decided: candidates = commit messages + `CONTRACT_CHANGED` symbols, enqueued by Tiers A/B;
consumption under explicit per-day call/token caps (queue waits when exhausted); local
OpenAI-shaped endpoint as default tier via the LLM-002 bridge, remote opt-in; docuvia never
manages the model process; persists via Slice 1's `upsertDecision` path (provenance included).
To settle at contract time: queue/budget storage shape, what triggers consumption without a
daemon (fold into the Tier B batch?), and prompt shape for commit-message extraction.

_Addendum (2026-07-17, owner rulings — see §8i):_ endpoints are settled — **all LLM traffic goes
through the LLM-002 CLIProxyAPI bridge**, no other endpoint integrations are considered; the one
open selection left for this contract is an **embedded in-process model**. Added to the
to-settle list: the **commit semantic filter** (critique §4.4 — drop `wip`/`typo`-class messages
before they reach the queue) and **request-side throttling** as the corrected form of critique
§4.5 — concurrency 1, token budget, system-load check before dispatch; docuvia throttles its own
requests and never manages the endpoint's process (PLAT-007 stance unchanged).

### 7c. Slice 5 — reliability (`doctor`)

- "Hook present but docuvia not resolvable" (`npx --no-install` silently no-ops — the invisible
  failure PLAT-007 forbids).
- Legacy-hook detection: `docuvia snapshot` block still live, including the edited-legacy-block
  case (bytes diverged → 2b's upgrade degrades to append-without-removal, leaving **both**
  blocks firing).
- `uninstall` has never removed the git post-commit hook (pre-2b fact, found by the 2b
  verifier) — decide whether `uninstall` should start removing it or `doctor` just reports it.
- LLM endpoint reachability (Tier C's `doctor` half); LSP binary presence (7a.1).

### 7d. Watchlist accumulated from Slice 1/2 verifications (no slice owns these yet)

| Item                                                                            | Source                                                                                        | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hydrate-then-delta optimization                                                 | 2a ruling 1                                                                                   | Empty `local.db` + populated knowledge branch currently full re-parses; hydrating then delta-ing from the `Docuvia-Source` trailer would be cheaper on big repos. Correctness is fine as-is (`markSynced` prevents stale clobber).                                                                                                                                                                                                                                                                                                                         |
| Delta log misattribution                                                        | 2a verifier                                                                                   | Delta's reuse of `runParseAndPersist` writes `init.parse_failure`/`init.file_skipped_oversized` events to `init.log` (oversize skips double-logged). Wants an event-name/log-target parameter on the shared helper.                                                                                                                                                                                                                                                                                                                                        |
| Dirty-index hash edge                                                           | 2a verifier                                                                                   | Delta takes blob hashes from the index but content at `headSha`; a dirty index can mismatch the `files` dedup table. Harmless today; recheck in Tier B.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `getChangedFilesSince` asymmetry footgun                                        | 2a test dispatch                                                                              | No-arg merges untracked files; explicit `baseRef` (even `"HEAD"`) does not. Documented + pinned by integration tests, but easy to misuse in future call sites.                                                                                                                                                                                                                                                                                                                                                                                             |
| L3 never reaches the knowledge branch                                           | 2a verifier learning                                                                          | Snapshot packs L2/links only and hydration restores L2 only — L3 durability rests entirely on `local.db` + remote `sync`. Whether L3 belongs in the snapshot is a **Phase 2 (distribute)** design question.                                                                                                                                                                                                                                                                                                                                                |
| Focused-path missing error-log line                                             | pre-merge analyze status                                                                      | A `chatCompletion` throw in `analyze <targetPath>` logs `analyze.focused.error` only on some paths (the old analyze-status follow-up dropped in the upstream docs consolidation — re-verify and close or fix).                                                                                                                                                                                                                                                                                                                                             |
| `.gitignore` `graphify-out/` line                                               | outside agent flow                                                                            | Appeared in the working tree unowned; deliberately left uncommitted by Slices 1–2. Commit or drop explicitly.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `impact --escalate-to-lsp` no-op flag                                           | §8 ruling (2026-07-17)                                                                        | `impact` benefits transparently from Tier B's better edges without the flag; wire-or-remove deferred to Slice 5.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Commit-cap trigger has no firing point                                          | Slice 3 verifier (2026-07-17)                                                                 | §7a lists "pre-push + commit cap" as triggers, but §8c structurally forbids LSP at commit time and §8h's pre-push batch runs unconditionally — so the derived cap (`commitCapExceeded`) is computed and surfaced in the JSONL summary but fires nothing. A user who accumulates 20+ commits without pushing gets no batch. Needs an owner ruling (e.g. Tier A logs a nudge, or `doctor` reports it in Slice 5).                                                                                                                                            |
| ~~Real-LSP end-to-end acceptance run outstanding~~ **CLOSED (§9n, 2026-07-18)** | Slice 3 verifier (2026-07-17)                                                                 | Run against Docuvia2's own history; found and fixed a real Windows spawn bug (`EINVAL` on `.cmd` shims — Tier B had never succeeded on Windows before this) rather than just measuring hit-rate. Post-fix: 135/135 files processed, 287 edges applied, 0 failed. Granular METHOD-vs-CONSTRUCTOR `node_key` hit-rate specifically remains unmeasured (not persisted/logged per-kind — would need new instrumentation); aggregate numbers are the honest substitute.                                                                                         |
| Recursive contract-diffusion (considered, not built)                            | `gemini-3.5-flash/lsp-orchestration-and-escalation.md` (deleted 2026-07-18, superseded by §8) | That report's §3 proposed recursively re-seeding LSP escalation when a referencer of a changed contract is itself a contract, diffusing until fully converged. §8d shipped a simpler one-pass design instead (find references once per queued file, no recursive re-seeding) — cheaper, and no reported case where one pass under-repairs. Re-open only if a real cross-contract-chain drift case is observed.                                                                                                                                             |
| MCP `init` bypasses PLAT-006's coarse lock                                      | ADR audit (2026-07-18)                                                                        | `artifacts/cli/src/mcp/tools/init.ts`'s `docuvia_init` calls `docuviaApi.init()` directly, never acquiring the `INIT_COMMAND_LOCK_FILE_NAME` lock the CLI's `initCommand()` takes — so two concurrent MCP-triggered inits (or one MCP + one CLI) aren't mutually exclusive, despite PLAT-006 explicitly naming AI-agent/editor integration points as the realistic concurrent-trigger scenario. Not fixed in this pass (doc/ADR reconciliation only, scope discipline); candidate for Slice 5 since it's a concurrency-reliability gap, not a doc problem. |
| Degraded batch advances `lastTierBBatchSha`                                     | Slice 3 verifier (2026-07-17)                                                                 | A fully-degraded batch (LSP absent) still seeds/advances the cap baseline at the next snapshot while its entries stay queued. Harmless today (pre-push runs regardless) but interacts with §8f's "rebuild queue from `lastTierBBatchSha`" recovery story.                                                                                                                                                                                                                                                                                                  |
| Tier B "exists at HEAD" ≈ working tree                                          | Slice 3 implementer (2026-07-17)                                                              | §8g's deleted-at-HEAD drop is implemented as an exists-in-working-tree check (documented in `run-tier-b-batch.ts`), since the LSP session reads live files off disk. Joins the dirty-index hash-edge family; the dirty-index item itself was rechecked in Slice 3: Tier B never calls `collectFilesToParse`, so it stays harmless and un-owned.                                                                                                                                                                                                            |

Phase 2 (distribute) and Phase 3 (consume) remain as mapped in the gap analysis §6 — Phase 3's
"verify reads serve a fresh graph" check becomes actionable now that Tier A ships.

## 8. Slice 3 (Tier B) — integration contract (owner rulings, recorded 2026-07-17)

> **Inputs:** §7a's open sub-decision list plus two 2026-07-17 reviews — the
> [cross-tool benchmark](../../reports/competitor-analysis-gitnexus-graphify-crg.md)
> (hermes-agent, live-verified) and the
> [Slice 3–5 critique](../../reports/ongoing-phase1-critical-gap-analysis.md). All rulings below
> are owner decisions (2026-07-17). This is the §6-style contract for the Slice 3 dispatch: the
> implementer has latitude on code placement, none on the decisions.

### 8a. Reconciliation of the 2026-07-17 critique

The critique is a thought-evolution document: its §5 stance is authoritative wherever it
conflicts with its own §§2–4 (§5a explicitly retracts the "developers won't compile" premise
behind §2a/2b). Disposition of its action items:

| Critique item                                     | Ruling (2026-07-17)                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §4.2 self-built static scope-resolution pipeline  | **Overruled.** During active development the code is compiled hundreds of times; bypassing the real LSP to hand-guess cross-file calls is wasteful re-invention. LSP stays the precision engine (§8b). |
| §4.3 tierBQueue LRU merge                         | **Already implemented** — `tier-b-queue.ts` dedupes by file (refreshing `commitSha`) since 2b; ten edits of one file cost one LSP pass over HEAD. Closed.                                              |
| §5b LSP output serialized to contract files       | **Already satisfied** — Tier B edges flow through the existing graph-rows → snapshot-pack → knowledge-branch path; the LLM reads hydrated `local.db`, never the LSP. No new mechanism.                 |
| §2c edge-vacuum window                            | **Accepted as designed** (PLAT-007: Tier B is the backstop). The `node_key` incoming-edge repair (§8d) shrinks the window.                                                                             |
| §4.1 pre-flight gate                              | **Adopted** → §8c.                                                                                                                                                                                     |
| §2d language boundary                             | **Adopted, with plugin architecture** → §8e.                                                                                                                                                           |
| §4.4 commit semantic filter / §4.5 LLM throttling | **Adopted for Slice 4**, with §4.5 rewritten as request-side throttling → §7b addendum.                                                                                                                |

### 8b. D1 — edge resolution: LSP primary; honest degradation now; LLM compensation later, behind a provider seam

`escalateToLsp` is implemented for real behind an **edge-resolution provider seam** — an
interface the Tier B batch consumes:

- **Provider 1 (this slice): spawn-per-batch headless LSP** (PLAT-007). Server:
  `typescript-language-server`, resolved project-locally (`node_modules/.bin`, then
  `npx --no-install`), config-overridable; never bundled. This settles §7a-1's binary question;
  what `doctor` says when it is absent stays in Slice 5 (§7c).
- **Provider 2 (later, Slice 4+): small-model compensation** — documented in the seam, not
  built. Owner measurement: a 1B-class model via the existing `AI_DOCUVIA_FAST_MODEL` surface
  analyzes typical Docuvia files in 100–200 ms each; an embedded in-process model is the
  candidate (§8i).
- **Parallel semantics when both are enabled** (runtime, not just roadmap): providers run in
  parallel and results merge by provenance — LSP edges are authoritative; LLM edges must carry
  `source='llm-inferred'` plus a confidence value; LSP wins conflicts.
- **Honest degradation:** LSP absent / unready / timed out → AST-level edges stay as they are,
  a JSONL event records why, exit 0, `doctor` explains the reason. Statically inventing edges
  is prohibited (§4.2 overruled).

### 8c. D2 — pre-flight gate, tiered by trigger point

- **Commit hook (Tier A): structurally never starts LSP or LLM.** A contract rule, not a gate
  outcome — the gate does not even run there.
- **Push stage (Tier B batch): heavy work is allowed.** The owner's own pre-push validation is
  already heavier than this batch; the trigger point is what makes the cost acceptable.
- **`init` / manual `analyze --escalate-to-lsp`: the gate is mandatory.** Detect environment
  readiness (`node_modules` present, tsconfig resolvable, LSP binary resolvable) and give the
  user the explicit choice (interactive prompt or flags, e.g. `--fallback-ast`), per the
  critique's §5a. Background paths are never interactive — they degrade and log.

### 8d. D3 — "corrected edges", concretely (settles §7a-2)

- For each queued file (after language dispatch, §8e): run LSP references/definitions over its
  symbols and write **cross-file symbol-level `calls` edges** between existing L2 nodes
  (STOR-005 `node_key` identity).
- **Repair incoming edges** dropped by Tier A's per-file replace: evaluate
  re-attach-by-`node_key` (the deterministic identity survives the replace), so unchanged
  callers re-link without re-parsing dependents.
- This is the costed answer to the benchmark's edge-deficit finding (Docuvia 144,242 edges vs
  GitNexus 283k / CRG 787k on hermes-agent): the gap is cross-file symbol calls, and it closes
  incrementally for exactly the files that change.
- **Implemented and verified in the same slice and the same verification pass as §8b** — the
  degradation semantics define what happens when LSP cannot supply these edges, so they are one
  acceptance surface.

### 8e. D4 — TS/JS first, behind per-language dispatch

- Queue consumption dispatches by language through a **dispatch table (per-language plugin
  shape)**, never a hardcoded TS check. Slice 3 ships the TS/JS plugin only.
- Non-TS/JS entries skip LSP with a JSONL log line and remain at AST precision — the natural
  extension of §8b's honest degradation.
- **Docs must state explicitly** (user guide and this contract) that LSP precision currently
  covers TS/JS only; every other language stays AST-level until its plugin exists. (Owner:
  without this note the natural reading is that all languages are already supported.)

### 8f. D5 — commit cap: derived, no counter (settles §7a-4)

New `GitConstants` meta key (`docuvia_meta`): `lastTierBBatchSha`, written only after a fully
successful batch (post-snapshot). Cap check at hook time =
`rev-list --count lastTierBBatchSha..HEAD` ≥ N (default 20, config-tunable per PLAT-007). Key
absent (pre-Slice-3 workspace): the commit-cap trigger stays inactive; the first pre-push batch
seeds the key. A lost queue (`local.db` destroyed) is rebuildable by re-classifying the diff
from `lastTierBBatchSha` — possible by design, not automated in Slice 3.

### 8g. D6 — queue consumption semantics (settles §7a-3)

Drain-all per batch. The queue is cleared **only after a successful snapshot** — a batch
interrupted mid-LSP leaves the queue intact and re-runnable (satisfies §7a-6's idempotency
requirement). Entries whose file no longer exists at HEAD are dropped at consumption time with
a log line. A per-file LSP failure keeps that entry for the next batch, logs it, and lets the
rest of the batch proceed; the batch still snapshots what succeeded.

### 8h. D7 — pre-push hook: synchronous first, explicitly tentative (settles §7a-5)

**Owner ruling (2026-07-17): tentative — function first, measure, then optimize; do not
hard-code aggressive limits up front.**

- The pre-push hook runs the batch (`analyze --escalate-to-lsp && snapshot`) **synchronously**,
  with a **generous initial timeout**; actual durations come from the JSONL run logs before any
  tightening. Owner measurement: in most cases the cost is small (their own pre-push validation
  is already heavier than this batch).
- Async/detached execution is a later UX optimization, evaluated against measured timings — not
  a Slice 3 requirement.
- Mechanics reuse 2b's marker + lock + legacy-upgrade pattern. Interplay with Phase 2's
  `sync-knowledge` pre-push scheduling must be designed together to avoid double-fetch (per
  §7a-5); the hook content should leave room for that second step.

### 8i. D8 — LLM endpoints: CLIProxyAPI only; embedded model deferred to Slice 4

All LLM traffic goes through LLM-002's CLIProxyAPI bridge
([router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)) — no other endpoint
integrations are considered. The **only** open consideration is an embedded in-process model
(weights distribution, loading cost); that ruling is deferred to the Slice 4 contract. Slice 3's
sole obligation toward it is the §8b provider seam. Compatible with the no-daemon stance:
per-batch in-process inference manages no server process. PLAT-007's Tier C wording is amended
accordingly (see the ADR's 2026-07-17 amendment note).

### 8j. Gating tests (settles §7a-6)

1. Batch vs concurrent Tier A `analyze` (delta write), and batch vs `snapshot` — following the
   existing concurrency-test pattern.
2. Crash mid-LSP: queue intact and re-runnable; the re-run converges (idempotency).
3. Degradation: LSP absent → AST edges untouched, JSONL event written, exit 0.
4. Language dispatch: non-TS entry skipped with a log line; TS entry processed.

**Acceptance for Slice 3:** build + full suite green (ESLint complexity budget ≤ 10 respected).
On a real TS repo: accumulate `CONTRACT_CHANGED` commits → pre-push fires the batch →
cross-file symbol-level `calls` edges appear and per-file-replace-dropped incoming edges are
repaired → exactly one snapshot lands on the knowledge branch. In an LSP-less environment the
same flow degrades honestly (exit 0, logged, `doctor` explains). An interrupted batch re-runs
cleanly. The user guide states the TS/JS-only LSP scope.

**Out of scope, recorded:** `impact --escalate-to-lsp` stays a documented no-op — `impact`
benefits transparently from the better edges without the flag; wire-or-remove is deferred to
Slice 5 (row added to §7d).

> **Status update (2026-07-17):** Slice 3 implemented and task-verifier **passed** (build,
> ESLint complexity budget, and full suite — 110 files / 685 tests — independently re-verified).
> D1–D8 confirmed compliant; changes staged in the working tree, not yet committed. Reusable
> learning for Slice 4: the **stage-then-finalize pattern** (analyze stages `tierBBatchPending`;
> `SnapshotWorkflow`'s post-pack finalize atomically drains the queue and seeds
> `lastTierBBatchSha`) is the mechanism that satisfies "effects only after successful snapshot" —
> Slice 4's budget/queue consumption should reuse it. Four verifier advisories recorded in §7d.
>
> **Status update (2026-07-18):** Slice 3 committed. Slice 4's integration-level contract is §9
> below.

## 9. Slice 4 (Tier C) — integration contract (Fable-rendered rulings, 2026-07-18)

> **Inputs:** §7b's settled scope + §8i's addendum (the embedded-model decision, explicitly
> deferred from Slice 3), and an AI-generated recommendations doc (not an owner ruling — its
> proposals are dispositioned below in §9a; the doc itself was fully dispositioned into this
> section and removed 2026-07-18, see git history for its original text if ever needed).
> Per owner instruction, the open questions carrying real architectural weight were routed to a
> Fable-model consult rather than decided ad hoc; the rulings below are that consult's output,
> recorded the same way owner rulings are recorded elsewhere in this document (D1–D8 precedent),
> so implementation has a single settled contract to build against. **These are not yet
> owner-ratified** — flag any E-ruling below that the owner wants overridden before or during
> implementation.

### 9a. Disposition of the Slice 4 recommendations doc's proposals

| Proposal                                                     | Disposition                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commit semantic filter                                       | **Adopted** → §9e.                                                                                                                                                                                      |
| Request-side throttling                                      | **Adopted** → §9f.                                                                                                                                                                                      |
| Embedded in-process model                                    | **Deferred, not built** → §9b.                                                                                                                                                                          |
| Semantic Drift Ratio (replaces shipped Tier B commit-cap D5) | **Partially adopted (amended 2026-07-18)** → §9g, §9m-1. Blast-radius component rejected (expensive, new tunable); blob/diff-size component adopted (cheap — reuses data Tier A already computes).      |
| `tierBQueue` staleness/eviction policy                       | **Deferred to a later reliability slice** → §9h. Queue is already deduped-by-file and bounded by repo file count; not urgent.                                                                           |
| Docker-compose historical-replay E2E harness                 | **Rejected as scoped; shrunk, timing fixed (amended 2026-07-18)** → §9i, §9m-2. Validates Tier B, not Tier C; disproportionate to this slice. A worktree script substitutes, run before Slice 5 starts. |
| L3 distribution strategy (snapshot packing)                  | **Confirmed Phase 2, not blocking** → §9j. One guardrail noted for Slice 4's persistence shape.                                                                                                         |

### 9b. E1 — Embedded in-process model: DEFER, do not build in Slice 4

All Tier C LLM traffic routes through the CLIProxyAPI bridge only (§8i, unchanged). The
Slice 3 provider seam's "Provider 2: small-model compensation" stays a documented seam, not
code. Rationale: §8i only obligated Slice 4 to _decide_, not build; there is no measured
evidence CLIProxyAPI is too slow/costly/unavailable for Tier C's workload, and an in-process
model opens a second, uncontrolled inference path (weights distribution, loading cost,
platform matrix) — the same class of speculative infrastructure this project has rejected
before (idle timer, resident LSP daemon, self-built scope resolution). **Concrete re-entry
trigger** (measured, not speculative): (a) Tier B degradation JSONL lines show LSP-absent/
timeout on ≥25% of batches over a sustained real-usage window, or (b) Tier C's daily budget
(§9c) is measurably exhausted by routine extraction volume such that per-file compensation
through the bridge is demonstrably unaffordable. Until either number exists, this stays parked.

### 9c. E2 — Queue/budget storage shape

Follow the `docuvia_meta` precedent Tier B set (`tierBQueue`, `lastTierBBatchSha`) — no new
table, no migration:

- `tierCQueue`: JSON array, deduped by target (commit sha for commit-message extraction,
  node_key for `CONTRACT_CHANGED` symbols), same stage-then-finalize discipline as Tier B
  (cleared only after successful persistence).
- `tierCBudget`: JSON object `{"date": "YYYY-MM-DD", "calls": N, "tokens": M}`. Reset is
  **lazy**, not scheduled: on every dispatch, if the stored date ≠ today (UTC, documented),
  zero the counters before checking against the configured daily caps. "Reset at midnight"
  is a daemon-shaped requirement; lazy reset-on-first-read is the daemonless equivalent and
  behaves identically for budgeting purposes.

### 9d. E3 — Consumption trigger: fold into the existing pre-push composition, hard wall-clock cap

No new command (owner convergence principle). Extend the Tier B pre-push composition —
`analyze --escalate-to-lsp && snapshot` — so the same escalation pass also drains `tierCQueue`
within budget (§9c) and within a strict per-run wall-clock cap (config-tunable; e.g. ~10–15s
or N items, whichever binds first). Leftovers stay queued; cleared only after a successful
persist/snapshot (stage-then-finalize, same as Tier B). Budget exhausted, system load high
(§9f), or bridge unreachable → skip with a JSONL line, exit 0 — the honest-degradation contract
already established for Tier B applies verbatim to Tier C.

### 9e. E4 — Commit semantic filter: pure-function denylist + regex + length floor, applied at enqueue

Applied where Tier A/B enqueue candidates (post-commit hook / Tier B queueing), not at
consumption time, so junk never occupies queue space:

- Drop if the parsed conventional-commit type ∈ `{chore, style, ci, build, docs, test}`
  (config-overridable list).
- Drop if the subject matches `/^(wip|fixup!|squash!|typo|lint|format|merge branch)/i`.
- Drop if the subject (after stripping any type prefix) is under ~10 characters.

Deliberately dumb and a pure function (unit-testable, no LLM pre-classification — spending
budget to save budget is self-defeating). Per the project's measured-pain discipline,
sophistication waits for evidence this misfilters in practice.

### 9f. E5 — Request-side throttling

- **Concurrency = 1**: reuse the PLAT-006 single-flight lock pattern (PID-stamped lockfile
  with staleness takeover), held for the dispatch window — the same discipline `init` already
  uses, extended to Tier C's drain step.
- **Daily budget**: §9c's `tierCBudget`, checked before each dispatch.
- **System-load check**: one-shot `os.loadavg()[0] / os.cpus().length > threshold` (default
  0.8) sampled once before dispatch — no polling loop, no watcher. `os.loadavg()` returns
  zeros on Windows; ship this as a **documented no-op on Windows** (log a JSONL note rather
  than fabricating a signal) until real contention is reported on a platform where the primary
  dev environment can observe it — itself a measured-pain call.

### 9g. E6 — Semantic Drift Ratio proposal: REJECTED, park on watchlist

> **Amended 2026-07-18 — see §9m-1.** This rejection's cost objection (adds computation to a
> hot path, new arbitrary tunable) is valid against the proposal's blast-radius component but
> was over-applied to its blob/diff-size component, which turns out to be effectively free.
> Text below is the original reasoning, kept for the audit trail; §9m-1 is the amended ruling.

Do not reopen Tier B's shipped, verified, owner-ruled commit-cap (§8f D5:
`rev-list --count lastTierBBatchSha..HEAD >= 20`, config-tunable). The composite score (diff
size excl. docs/binaries + impact-analysis blast radius + commit-count multiplier) adds
computation to a hot path, introduces an arbitrary new tunable (15% threshold), and its core
complaint — "20 doc-only commits ≠ drift" — is already answerable with a one-line cheap tweak
_if pain ever materializes_ (exclude doc-only commits from the rev-list count), which is why
the composite version is premature now. **Re-entry trigger**: JSONL evidence from real usage
that batch timing (too eager or too late) is materially wrong.

### 9h. E7 — `tierBQueue` staleness/eviction: deferred; log queue size only

Not Slice 4 scope (it's a Tier B concern, and Slice 4 ships Tier C). The "infinitely growing
backlog" premise is overstated — the queue is already deduped by file and bounded by repo file
count. The one cheap addition worth making in Slice 4's own logging pass: include queue size
in the existing Tier B JSONL batch-summary line, so a future eviction decision (if one is ever
needed) is made from data rather than speculation.

### 9i. E8 — Docker-compose historical-replay harness: rejected as scoped; substitute a worktree script

> **Amended 2026-07-18 — see §9m-2.** The scope rejection (docker-compose vs. worktree script)
> stands. The timing this section originally gave the substitute ("if that manual run shows
> surprising numbers") had no forcing function and is replaced with a fixed anchor.

Standing up a docker-compose replay environment validates Tier B's LSP edge-repair hit-rate,
not anything Slice 4 ships — disproportionate infrastructure for this slice. Proportionate
substitute (not a Slice 4 deliverable, but the recommended path when this question is picked
up): a throwaway script against a `git worktree` clone (already provides the isolation the
docker proposal was reaching for) that replays commits and reads the repair/degradation JSONL
lines the system already emits. If that manual run shows surprising numbers, a repeatable
harness earns its own slice then — not before.

### 9j. E9 — L3 distribution strategy: confirmed Phase 2, one Slice 4 guardrail

Confirmed out of Slice 4 scope — it touches `SnapshotWorkflow`, `HydrationService`, and
merge/conflict semantics that Tier C's generation work does not depend on. Slice 4's only
obligation: L3 rows persisted via `upsertDecision` (Slice 1) must carry no machine-local
identity — repo-relative `source_files`, commit shas in `source_commits`, and the existing
content-hash dedup key are already the right merge-ready shape. This is a "keep doing what
`upsertDecision` already does" constraint, not new work.

### 9k. Gating tests

1. Semantic filter: unit tests for each denylist/regex/length-floor rule (drop and keep cases).
2. Budget lazy-reset: crossing the UTC date boundary between two dispatches zeroes counters
   before the next check; budget exhaustion mid-run skips remaining items with a JSONL line.
3. Concurrency lock: a second concurrent dispatch attempt during an active Tier C drain is
   rejected/deferred, following the existing PLAT-006 lock test pattern.
4. Wall-clock cap: a drain that would exceed the per-run cap persists what completed and
   re-queues the remainder (stage-then-finalize; idempotent re-run).
5. Honest degradation: budget exhausted / system load high / bridge unreachable → queue
   untouched except for completed items, JSONL event written, exit 0.
6. Persistence: extracted decisions land as `l3_nodes` rows via the existing `upsertDecision`
   path with full provenance (reuses Slice 1's acceptance tests, not re-derived here).

**Acceptance for Slice 4:** build + full suite green (ESLint complexity budget ≤ 10 respected).
On a real repo: qualifying commits (post-filter) and `CONTRACT_CHANGED` symbols accumulate in
`tierCQueue` → pre-push batch drains within budget and wall-clock cap → `l3_nodes` rows appear
with provenance → queue reflects only what wasn't processed. Budget exhaustion, load-check
trip, or bridge unreachability degrade honestly (exit 0, logged, no partial/fake decisions).
A concurrent second dispatch is safely rejected. No embedded model is built; the provider seam
stays documented-only per §9b.

> **Status update (2026-07-18):** Slice 4 implemented (build green; full suite 105 files / 680
> tests green). The implementer flagged six judgment calls where §9 left a gap; owner rulings
> below.

### 9l. Dispatch implementer — post-implementation rulings (2026-07-18)

1. **Token budget is char-estimated (4 chars/token), not provider-measured — accepted for
   now.** `ILlmClient`/`FetchLlmClient` never surfaced a `usage` field from the CLIProxyAPI
   response, so exact accounting would mean extending a Slice-3-shipped contract interface.
   Ruling: ship the heuristic, documented as advisory not billing-grade (already done in code
   comments). Revisit — thread real `usage` through `ChatCompletionResult` — only if the
   estimate is ever observed materially over/under real spend (measured-pain rule, consistent
   with §9b/§9g's re-entry-trigger discipline).
2. **Commit-message anchor resolution (walk the commit's changed-file list for the first file
   with an L2 node; no L2 node in any changed file → stays queued, never a synthetic anchor) —
   accepted.** Correct extrapolation of §3b's own "directory target → first collected file with
   a node, else persist nothing" rule to a commit's file list; no different rule is needed.
3. **Prompt shape for both extraction kinds (new `TIER_C_COMMIT_MESSAGE_SYSTEM_PROMPT` /
   `TIER_C_CONTRACT_SYMBOL_SYSTEM_PROMPT`, same JSON contract as the existing
   `DECISION_EXTRACTION_SYSTEM_PROMPT`, parsing logic factored into shared
   `decision-parsing.ts`) — accepted as shipped.** §7b explicitly left this open and §9 never
   closed it, so there was no contract to deviate from. Not validated against a live model;
   folded into the existing watchlist item for a live-model smoke test (§7d style) before this
   sees real usage at volume — not blocking Slice 4 completion.
4. **No `tierCBatchPending`-style staging key; per-item persist-then-dequeue instead — accepted,
   confirmed as the correct reading.** §9j already establishes L3 rows never ride the snapshot,
   so there is no later step for a pending record to wait on; the L3 write is the durable effect,
   synchronous within the same run. Tier B's staging exists specifically because its queue-clear
   depends on a _separate later command_ (`snapshot`) succeeding — Tier C has no equivalent
   separation. If Phase 2 ever makes L3 ride the knowledge branch (§9j), reopen this then; not
   before.
5. **Redundant `tierBQueueLength` field — rejected, reverted.** Duplicated `filesQueued`'s value
   under a second name in the same JSONL line; removed (`run-tier-b-batch.ts`). §9h's intent
   (queue size visible in the batch-summary line for a future eviction decision) was already
   satisfied by the pre-existing `filesQueued` field since Slice 3 — nothing further was needed.
6. **"Bridge unreachable" detected via first failed `chatCompletion` call, not a pre-flight
   `checkAvailability()`-style probe — accepted, gap noted for Slice 5.** `ILlmClient` has no
   reachability-check method today (unlike Tier B's `IEdgeResolutionProvider.checkAvailability`),
   so building parity would mean a new contracts-layer interface method — out of scope for a
   dispatch that was told not to touch Slice-3-adjacent shipped interfaces. The shipped behavior
   (stop draining on a bridge-unreachable failure classification, leave untried items queued,
   log the reason) satisfies the honest-degradation _outcome_ even though the _detection timing_
   is weaker than Tier B's pre-flight guarantee. Added to the §7d-style watchlist: a real
   `ILlmClient.checkAvailability()` probe is Slice 5 (`doctor` reliability) scope — that's
   already where LLM endpoint reachability was assigned (§7c).

### 9m. Owner-requested amendments to §9g and §9i (2026-07-18, post-Slice-4 review)

Raised in review of §9's rulings, after Slice 4 shipped. Both amendments below are owner-ruled
(not routed to a Fable consult — narrow enough to decide directly), and both revise reasoning
this same document rendered earlier in §9, so the original text is left in place with a pointer
here rather than rewritten, matching this document's audit-trail convention (cf. §6d/§8/§9l).

1. **§9g amended: commit-cap trigger switches from raw commit count to cumulative blob/diff
   size (adopted); blast-radius component stays rejected.** §9g's original rejection bundled
   two different signals from the recommendations doc's composite proposal — diff size and
   impact-analysis blast radius — and rejected both on the same cost/complexity grounds. That
   bundling doesn't hold: the two signals have very different cost profiles and the rejection's
   own counter-example only defends against one of them.
   - **Blast radius: rejection stands.** Running impact analysis per commit is genuinely
     expensive and introduces a new tunable (the 15% threshold) with no measured need.
   - **Blob/diff size: reopened, adopted.** §9g's stated cheap fix for the composite proposal's
     complaint — "exclude doc-only commits from the rev-list count, if pain ever materializes" —
     only addresses over-triggering (many trivial commits inflating the count). It does not
     address the composite proposal's own motivating example, a **single** large refactor commit
     causing severe drift, which raw commit count structurally cannot detect regardless of any
     doc-exclusion tweak: one commit is one commit no matter how many lines it touches. That gap
     in the original reasoning is why the raw-commit-count trigger (§8f D5) is not sound merely
     because it's already shipped.
   - **Why this is cheap, not speculative infrastructure**: `IGitProvider.getChangedFilesSince`
     and `getChangedLineRanges` (`git.interfaces.ts`) are already called on every commit for Tier
     A's AST delta processing (`SemanticDiffDetector`). A cumulative changed-lines/changed-files
     counter (excluding `.md`/docs and binaries, same exclusion §9g's own counter-fix already
     conceded was worth doing) can be accumulated from data Tier A computes anyway — this is not
     new work on the hot path, unlike the blast-radius component.
   - **Scope**: implementation (replacing `isTierBCommitCapExceeded`'s `rev-list --count`
     comparison in `tier-b-commit-cap.ts` with a blob-size-based check, and picking the new
     threshold) is deferred to whichever slice next touches Tier B's commit-cap — not a Slice 4
     or Slice 5 deliverable by itself. This section settles the _design direction_ so the next
     touch doesn't re-litigate it.
2. **§9i amended: worktree-script validation gets a fixed timing anchor — before Slice 5
   starts, not "if surprising numbers ever show up."** The scoped-down substitute (worktree
   script instead of docker-compose) stands. Its original timing condition was reactive with no
   forcing function — nothing would ever proactively trigger someone to check the JSONL
   degradation lines it depends on, so "later" could mean "never." Tier B (the thing this
   validates) shipped in Slice 3 (2026-07-17); Slice 4 is now verified (2026-07-18); Slice 5 is
   next. Binding the run to "before Slice 5 starts" also merges it with the pre-existing,
   previously separate outstanding item from Slice 3's report §7d row 2 ("real-LSP e2e
   acceptance run outstanding ... run once on real TS repo before Slice 5, check
   METHOD/CONSTRUCTOR node_key hit-rate") — that item is a single-point-in-time correctness
   check, this one is a longitudinal hit-rate-over-commits check; both were waiting on the same
   "real TS repo, before Slice 5" precondition and should run together rather than as two
   separately-forgettable todos.

### 9n. §9m-2's validation run — executed 2026-07-18, findings

Run against Docuvia2's own history (dogfooding): a local clone (not a `git worktree` — see
finding 1) seeded at `9f1b05f`, walking forward 24 commits to `daa7bfd` with plain `analyze` at
each step and `analyze --escalate-to-lsp && snapshot` after `14c33ce` (the magic-strings sweep —
a rename/dedupe-heavy commit), `056939a` (the complexity-budget method-split refactor), and at
final HEAD. `typescript-language-server@5.3.0` installed into a throwaway `npm --prefix` outside
the repo, pointed at via `DOCUVIA_LSP_BINARY` (no changes to Docuvia2's own devDependencies).

**Finding 1 — `git worktree` is not a usable isolation substrate for Docuvia today.**
`IGitProvider.acquireKnowledgeLock` (`libgit2-provider.ts`) does
`path.join(cwd, ".git", "docuvia-knowledge.lock")`, assuming `<cwd>/.git` is always a real
directory. In a secondary `git worktree`, `.git` is a **file** containing a `gitdir:` pointer,
not a directory — so the join produces an unusable path and `init`/`analyze` fail immediately
with `ENOENT`, before any real work happens. This invalidates §9i/§9m-2's own "worktree script"
framing as literally stated — worked around here by using a plain local `git clone` instead
(same isolation property, no `.git`-file complication). Not fixed as part of this validation
(out of scope — validation, not implementation); worth a `doctor` check or a fix if Docuvia is
ever expected to run from a worktree (CI matrices and some review-bot setups do this routinely).

**Finding 2 — Tier B's LSP escalation cannot spawn `typescript-language-server` on Windows at
all, in any configuration tested. This is the headline result — more consequential than a
hit-rate number, because hit-rate was unmeasurable: 0 of 3 batch attempts got past spawning the
server.** All three `--escalate-to-lsp` runs (after `14c33ce`, `056939a`, and final HEAD)
degraded identically: `LSP unavailable ... Failed to spawn LSP server "...\typescript-language-
server.cmd": spawn EINVAL`. Root cause isolated directly (not inferred): `LspJsonRpcClient.start`
(`lsp-json-rpc-client.ts`) calls `spawn(options.command, options.args, { cwd, stdio })` with no
`shell` option. On Windows, `child_process.spawn` cannot execute a `.cmd`/`.bat` file directly —
Node throws `EINVAL` synchronously — and `resolveLspBinary`'s own
`WINDOWS_BIN_EXTENSIONS = [".cmd", ".CMD", ".exe", ""]` tries `.cmd` **first**, which is exactly
what any real `npm`/`pnpm` install of `typescript-language-server` produces in
`node_modules/.bin` on Windows (confirmed: no `.exe` variant exists for this package — it's pure
JS). So the _preferred_, documented-as-working resolution path is the one that's broken; a
minimal reproduction (`spawn(cmdPath, ["--version"])` with vs. without `shell: true`) confirms
`shell: true` alone fixes it (returns `5.3.0` instead of throwing). The existing real-subprocess
test (`lsp-json-rpc-client.unit.test.ts`) never exercises this path — it spawns `process.execPath`
(the `node` binary itself, a real `.exe`) against a fixture server, not a `.cmd`-shimmed binary,
so this gap has no test coverage in either direction. **Practical implication**: on every Windows
dev machine, Tier B has been silently degrading to AST-only on every batch since Slice 3 shipped,
regardless of whether `typescript-language-server` is installed correctly — the honest-degradation
contract (exit 0, log the reason) worked exactly as designed and is why nobody's push ever broke,
but it also means the "core quality engine" (IMPT-003's own description) has not run successfully
on Windows even once. `node_key`/METHOD/CONSTRUCTOR hit-rate remains unmeasured pending a fix —
re-run this validation once a Windows-safe spawn path ships to get the real number the original
watchlist item asked for.

**Resolved same day (2026-07-18), owner chose "fix now."** `LspJsonRpcClient.start`
(`lsp-json-rpc-client.ts`) now branches: `.cmd`/`.bat`/`.ps1` targets on `win32` spawn through a
single individually-quoted command string with `shell: true`; every other command (including
genuinely unresolvable binaries) spawns exactly as before, preserving the existing synchronous
`ENOENT`-style failure contract `TypescriptLspEdgeProvider.runBatch()` relies on. `cross-spawn`
was evaluated and rejected — direct comparison testing showed it silently defers a bad-binary
failure from an immediate `error` event to an async `exit code 1` re-interpretation, which would
have broken that contract. New regression coverage added: a real `.cmd`-wrapper spawn test
(previously only `process.execPath`, a real `.exe`, was exercised — zero coverage of the shim
path in either direction before this). `task-verifier` independently re-confirmed the quoting
against embedded spaces/quotes/shell metacharacters (including a `&& calc.exe` injection probe)
and re-ran the full build + `lib/core` suite (183/183) clean. One non-blocking note from
verification: `.ps1` is listed in the shell-wrapper extension set per the original ask, but bare
`cmd.exe` doesn't actually execute `.ps1` on this machine's default file association (inert, not
an error) — moot today since `resolveLspBinary()` never emits a `.ps1` candidate, but worth
remembering if that ever changes.

**Re-ran §9n's validation batch (final HEAD checkpoint) against the fix — full success, closing
the open item.** Same clone, same accumulated Tier B queue (nothing else changed): `filesQueued:
135, filesProcessed: 135, filesFailed: 0, edgesApplied: 287, edgesPruned: 146, degraded: false`.
100% of queued files processed, zero spawn/resolution failures. This is the first time Tier B has
completed successfully against a real batch in this project's history. **Caveat on the original
ask's framing**: a granular METHOD-vs-CONSTRUCTOR `node_key` hit-rate specifically (as opposed to
the aggregate edges-applied/pruned counts above) is not extractable after the fact — `l2_nodes`
persists a `type` column that's always `"module"` for every ingested symbol (file/function-level
categorization only); the LSP-side `SymbolKind` distinction (`LspSymbolKinds.METHOD`/
`CONSTRUCTOR`) is used transiently inside `typescript-lsp-edge-provider.ts`'s resolution pass and
never persisted or logged per-kind. Getting that specific breakdown would need new
instrumentation in the edge-resolution provider — not done here (out of scope for a validation
run); the aggregate numbers above are the honest substitute and are unambiguously positive.
