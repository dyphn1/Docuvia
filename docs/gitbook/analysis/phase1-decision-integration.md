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
listed explicitly.

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

**Open sub-decisions for the Slice 3 contract** (settle first, §6-style):

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

| Item                                     | Source                   | Note                                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hydrate-then-delta optimization          | 2a ruling 1              | Empty `local.db` + populated knowledge branch currently full re-parses; hydrating then delta-ing from the `Docuvia-Source` trailer would be cheaper on big repos. Correctness is fine as-is (`markSynced` prevents stale clobber). |
| Delta log misattribution                 | 2a verifier              | Delta's reuse of `runParseAndPersist` writes `init.parse_failure`/`init.file_skipped_oversized` events to `init.log` (oversize skips double-logged). Wants an event-name/log-target parameter on the shared helper.                |
| Dirty-index hash edge                    | 2a verifier              | Delta takes blob hashes from the index but content at `headSha`; a dirty index can mismatch the `files` dedup table. Harmless today; recheck in Tier B.                                                                            |
| `getChangedFilesSince` asymmetry footgun | 2a test dispatch         | No-arg merges untracked files; explicit `baseRef` (even `"HEAD"`) does not. Documented + pinned by integration tests, but easy to misuse in future call sites.                                                                     |
| L3 never reaches the knowledge branch    | 2a verifier learning     | Snapshot packs L2/links only and hydration restores L2 only — L3 durability rests entirely on `local.db` + remote `sync`. Whether L3 belongs in the snapshot is a **Phase 2 (distribute)** design question.                        |
| Focused-path missing error-log line      | pre-merge analyze status | A `chatCompletion` throw in `analyze <targetPath>` logs `analyze.focused.error` only on some paths (the old analyze-status follow-up dropped in the upstream docs consolidation — re-verify and close or fix).                     |
| `.gitignore` `graphify-out/` line        | outside agent flow       | Appeared in the working tree unowned; deliberately left uncommitted by Slices 1–2. Commit or drop explicitly.                                                                                                                      |

Phase 2 (distribute) and Phase 3 (consume) remain as mapped in the gap analysis §6 — Phase 3's
"verify reads serve a fresh graph" check becomes actionable now that Tier A ships.
