/**
 * Plain git-configuration conventions shared across `lib/core/git`, `lib/git-local`,
 * `lib/ui-core` and `artifacts/cli`. Per
 * docs/gitbook/architecture/virtual-contracts-architecture.md, Domain Core (`lib/core`), Tech
 * Providers (`lib/git-local`), Orchestration (`lib/ui-core`) and Presentation (`artifacts/cli`)
 * sit at different layers and never import each other directly — "all shared definitions must
 * live in contracts" — so a value more than one layer needs lives here rather than being
 * duplicated per-package.
 */

/** Git's conventional name for the default/primary remote. */
export const GIT_DEFAULT_REMOTE_NAME = "origin" as const;

/** Docuvia-specific git conventions — the domain semantics layered on top of `IGitProvider`'s raw primitives. */
export const GitConstants = {
  KNOWLEDGE_ROOT: "docuvia-knowledge",
  /**
   * Shared scan depth for knowledge-branch log reads (issues #270/#283) — previously
   * copy-defined as `KNOWLEDGE_LOG_SCAN_LIMIT = 5000` in `knowledge-git.service.ts`,
   * `hydration.service.ts` and `analyze-workflow.ts`. The knowledge branch is a dedicated
   * orphan branch of small, purpose-built commits, so this comfortably bounds log scans
   * without truncating any real history.
   */
  KNOWLEDGE_LOG_SCAN_LIMIT: 5000,
  KNOWLEDGE_DIR_NAME: "knowledge",
  GRAPH_DIR_NAME: "graph",
  /** Subdirectory of `KNOWLEDGE_DIR_NAME` holding L3 decision cards (phase2-l3-distribution.md
   *  L3DIST-001): one file per `content_hash`, `knowledge/_l3/<content_hash>.md`. */
  L3_DIR_NAME: "_l3",
  NODES_JSONL_NAME: "nodes.jsonl",
  EDGES_JSONL_NAME: "edges.jsonl",
  /** Commit-message trailer key (STOR-001 point 4) carrying the full 40-char source-commit sha, read back by Phase 2's nearest-ancestor hydration lookup. */
  SOURCE_COMMIT_TRAILER_KEY: "Docuvia-Source",
  POST_COMMIT_HOOK_NAME: "post-commit",
  /**
   * `analyze` auto mode (PLAT-007 Tier A) is the hook's command as of Slice 2 dispatch 2b
   * (phase1-decision-integration.md §6c) — gated by the `analyze`+`snapshot` and `doctor`+
   * `hydrate` concurrency tests, which must exist and pass before this flip. See
   * `LEGACY_POST_COMMIT_HOOK_MARKER`/`LEGACY_POST_COMMIT_HOOK_CONTENT` for the pre-2b hook this
   * replaces in-place on an existing installation.
   */
  POST_COMMIT_HOOK_MARKER: "docuvia analyze",
  /**
   * `docuvia hooks disable commit-l3-write`'s enforcement (issue #42 §8.3) -- present only in
   * the current `POST_COMMIT_HOOK_CONTENT`, absent from `PRE_FLUSH_L3_POST_COMMIT_HOOK_CONTENT`/
   * `LEGACY_POST_COMMIT_HOOK_CONTENT` -- the marker `installPostCommitHook` uses to tell a hook
   * that already runs the `analyze --flush-staged-l3` step from one still missing it.
   */
  POST_COMMIT_FLUSH_L3_MARKER: "docuvia analyze --flush-staged-l3",
  /**
   * Issue #58: the `nohup`-backgrounded form, present only in the current `POST_COMMIT_HOOK_CONTENT`,
   * absent from `PRE_NOHUP_POST_COMMIT_HOOK_CONTENT`/`PRE_FLUSH_L3_POST_COMMIT_HOOK_CONTENT`/
   * `LEGACY_POST_COMMIT_HOOK_CONTENT` -- the marker `installPostCommitHook` uses to tell a hook
   * that already backgrounds with `nohup` + a log-file redirect (survives the hook shell's exit;
   * npx-resolution/startup failures visible in `.docuvia/logs/post-commit-hook.log`) from one
   * still using the old fire-and-forget `> /dev/null 2>&1 &` form, whose backgrounded process
   * could die with the hook's shell and silently skip delta ingestion (issue #58's root cause 1).
   */
  POST_COMMIT_NOHUP_MARKER: "nohup npx --no-install docuvia analyze",
  /** Byte-identical header line shared by `POST_COMMIT_HOOK_CONTENT`/
   *  `LEGACY_POST_COMMIT_HOOK_CONTENT` — the anchor `doctor --fix`'s marker-bounded repair (§10d,
   *  decision 1f) uses to strip every Docuvia-authored block regardless of minor hand-edits that
   *  would break exact-content matching. */
  DOCUVIA_HOOK_HEADER_COMMENT: "# Docuvia Knowledge Graph Evolver Hook",
  /**
   * `> /dev/null 2>&1` (not the bash-only `&>`) throughout this and `PRE_PUSH_HOOK_CONTENT` —
   * husky's shim (`.husky/_/h`) invokes a hook file via `sh -e "$s"`, ignoring the file's own
   * `#!/bin/bash` shebang entirely, so any bash-specific syntax silently breaks (or behaves
   * differently) once a repo's `core.hooksPath` redirects Docuvia's hook there (found via
   * dogfooding, 2026-07-21). The portable form works identically under bash and POSIX `sh`.
   *
   * Issue #58 (nohup + log-file redirect): both backgrounded lines now run under `nohup` (a
   * POSIX external command -- unlike `disown`, which is a bash builtin husky's `sh -e` shim
   * would break on, and `setsid`, which macOS doesn't ship) so the process survives the hook's
   * own shell exiting, and their output lands in `.docuvia/logs/post-commit-hook.log` instead of
   * `/dev/null` -- an `npx --no-install` resolution failure or a process that dies before it can
   * write its own JSONL is now visible there (and via doctor's `post_commit_ingestion`
   * diagnostic), where before it was swallowed entirely and `lastIngestedSourceSha` silently
   * stopped advancing.
   *
   * Second backgrounded line (issue #42 §8.3): flushes any staged agent-authored L3 decisions for
   * this commit, self-gated internally on the `commit-l3-write` toggle (see
   * `run-flush-staged-l3.ts`) -- no shell-level `docuvia hooks check` composition here, unlike
   * `PRE_PUSH_HOOK_CONTENT`'s synchronous `&&` chain, since this line is itself backgrounded
   * (`&`) and has no exit code for a `&&` composition to react to.
   *
   * Two background `npx` processes now run per commit (auto `analyze` + `--flush-staged-l3`),
   * both touching the local SQLite DB. That's an accepted, documented tradeoff (issue #53 finding
   * 7): SQLite runs in WAL mode with `busy_timeout` 10000ms (`lib/schema`), so the two processes'
   * write contention serializes rather than erroring, and the flush is a no-op fast path whenever
   * nothing is staged. Keeping them as separate backgrounded lines (rather than one process doing
   * both) preserves each line's simple fire-and-forget contract.
   */
  POST_COMMIT_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n` +
    `# Non-intrusively extracts AST deltas in the background\n` +
    `if command -v npx > /dev/null 2>&1; then\n` +
    `  mkdir -p .docuvia/logs\n` +
    `  # Fire and forget (do not block commit) -- nohup keeps the process alive after this hook's\n` +
    `  # shell exits; output goes to a log file (not /dev/null) so failures are visible (issue #58).\n` +
    `  nohup npx --no-install docuvia analyze >> .docuvia/logs/post-commit-hook.log 2>&1 &\n` +
    `  # Flush any staged agent-authored L3 decisions for this commit (roadmap items 32-34, issue #42).\n` +
    `  # Self-gated internally on the commit-l3-write toggle -- see run-flush-staged-l3.ts.\n` +
    `  nohup npx --no-install docuvia analyze --flush-staged-l3 >> .docuvia/logs/post-commit-hook.log 2>&1 &\n` +
    `fi\n`,
  /**
   * The pre-issue-#42 hook's exact content (single `docuvia analyze &` line, before the
   * `--flush-staged-l3` line was added), retained verbatim so `installPostCommitHook` can
   * recognize a hook installed before that step was composed in and replace it in place -- same
   * technique as the `LEGACY_POST_COMMIT_HOOK_CONTENT` upgrade below.
   */
  PRE_FLUSH_L3_POST_COMMIT_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n` +
    `# Non-intrusively extracts AST deltas in the background\n` +
    `if command -v npx > /dev/null 2>&1; then\n` +
    `  # Fire and forget (do not block commit)\n` +
    `  npx --no-install docuvia analyze > /dev/null 2>&1 &\n` +
    `fi\n`,
  /**
   * The pre-issue-#58 hook's exact content (the two-line `--flush-staged-l3` form, still using
   * the bare fire-and-forget `> /dev/null 2>&1 &` backgrounding), retained verbatim so
   * `installPostCommitHook` can recognize a hook installed before the `nohup` + log-redirect
   * change (issue #58) and replace it in place -- same technique as the
   * `PRE_FLUSH_L3_POST_COMMIT_HOOK_CONTENT` upgrade below.
   */
  PRE_NOHUP_POST_COMMIT_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n` +
    `# Non-intrusively extracts AST deltas in the background\n` +
    `if command -v npx > /dev/null 2>&1; then\n` +
    `  # Fire and forget (do not block commit)\n` +
    `  npx --no-install docuvia analyze > /dev/null 2>&1 &\n` +
    `  # Flush any staged agent-authored L3 decisions for this commit (roadmap items 32-34, issue #42).\n` +
    `  # Self-gated internally on the commit-l3-write toggle -- see run-flush-staged-l3.ts.\n` +
    `  npx --no-install docuvia analyze --flush-staged-l3 > /dev/null 2>&1 &\n` +
    `fi\n`,
  /**
   * The pre-Slice-2b hook's marker/content, retained verbatim so `installPostCommitHook` can
   * recognize a hook installed before the `snapshot` -> `analyze` flip and replace it in place
   * (phase1-decision-integration.md §6c) rather than appending a second, duplicate Docuvia block
   * alongside the old one.
   */
  LEGACY_POST_COMMIT_HOOK_MARKER: "docuvia snapshot",
  LEGACY_POST_COMMIT_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n` +
    `# Non-intrusively extracts AST deltas in the background\n` +
    `if command -v npx &> /dev/null; then\n` +
    `  # Fire and forget (do not block commit)\n` +
    `  npx --no-install docuvia snapshot > /dev/null 2>&1 &\n` +
    `fi\n`,
  LOCAL_REMOTE_URL_SCHEME: "file://",
  /** Git's conventional name for the default/primary remote — shared with `lib/git-local` via
   *  `GIT_DEFAULT_REMOTE_NAME` above per the Virtual Contracts rule that values needed by both a
   *  Domain Core and a Tech Provider package live in contracts. */
  DEFAULT_REMOTE_NAME: GIT_DEFAULT_REMOTE_NAME,
  /** Prefix for a remote-tracking ref path (`refs/remotes/<remote>/<branch>`), used when reading
   *  the remote's copy of the knowledge branch tip during reconciliation. */
  REMOTE_REF_PREFIX: "refs/remotes/",
  /** The special ref name for the currently checked-out commit, used when walking source HEAD's
   *  ancestry during hydration's nearest-ancestor lookup. */
  HEAD_REF: "HEAD",
  /** One project per local.db (first row created by the `init` workflow). */
  DEFAULT_LOCAL_PROJECT_ID: 1,
  /** `docuvia_meta` key storing the knowledge-branch commit sha `local.db` was last hydrated from (STOR-002). */
  META_KEY_KNOWLEDGE_TIP_SHA: "hydratedKnowledgeSha",
  /**
   * `docuvia_meta` key storing the source commit sha `local.db`'s graph was last *ingested*
   * from — distinct from `META_KEY_KNOWLEDGE_TIP_SHA`, which tracks the last git *hydration*
   * (phase1-decision-integration.md §6a; PLAT-007 Tier A). Written after every successful full or
   * delta `analyze` auto-mode ingestion; read back as the idempotency fast-path (`HEAD ===` this
   * value → no-op) and as the delta baseline (`this value -> HEAD`).
   */
  META_KEY_LAST_INGESTED_SOURCE_SHA: "lastIngestedSourceSha",
  /** `docuvia_meta` key storing the `node_key` format version (GRPH-006) the graph was last fully
   *  ingested with -- `"2"` once qualified/structural keys are in use, absent/older on a
   *  pre-qualified-key graph. Written only on a full ingestion (`stampFullIngestionForTierB`,
   *  shared by `init` and `analyze`'s empty-graph branch); read by `runDeltaIngestion`'s guard to
   *  refuse an incremental re-parse that would otherwise silently mix old-flat and new-qualified
   *  keys in the same graph. */
  META_KEY_NODE_KEY_FORMAT_VERSION: "nodeKeyFormatVersion",
  /**
   * `docuvia_meta` key holding a JSON array of `{file, commitSha}` entries, deduped by `file` —
   * the Tier B queue `analyze` auto mode's delta ingestion enqueues `CONTRACT_CHANGED` files into
   * (phase1-decision-integration.md §6b; PLAT-007 Tier B). Not consumed until Slice 3.
   */
  META_KEY_TIER_B_QUEUE: "tierBQueue",
  /** `os.tmpdir()` prefix for `ensureKnowledgeBranch`'s scratch dir used to pack the empty initial snapshot. */
  EMPTY_KNOWLEDGE_TEMP_DIR_PREFIX: "docuvia-empty-knowledge-",

  /**
   * `docuvia_meta` key storing the source commit sha the last *fully successful* Tier B batch
   * (LSP escalation + snapshot) ran against — written only by `snapshot`'s post-pack finalize
   * step, never by `analyze --escalate-to-lsp` itself (phase1-decision-integration.md §8f, D5).
   * Absent on a pre-Slice-3 workspace: the commit-cap trigger stays inactive until the first
   * batch seeds it.
   */
  META_KEY_LAST_TIER_B_BATCH_SHA: "lastTierBBatchSha",
  /**
   * `docuvia_meta` key holding a JSON `{ headSha, remainingQueue }` record staged by a successful
   * `analyze --escalate-to-lsp` run, consumed by the next successful `snapshot` (§8g, D6: "the
   * queue is cleared only after a successful snapshot"). An empty-string value is the sentinel
   * for "no pending batch" (`IMetaRepo` has no delete — `set(key, "")` is the clear).
   */
  META_KEY_TIER_B_BATCH_PENDING: "tierBBatchPending",
  /** `docuvia_meta` key marking "a knowledge-branch pack attempt from *this* local.db is in
   *  flight or last failed to land" — set immediately before `packSnapshotToKnowledgeBranch` is
   *  attempted (`pack-current-graph.ts`) and cleared only once it succeeds. Read by
   *  `HydrationService.hydrate()`'s safety guard so a same-workspace pack failure can never be
   *  mistaken for "git has newer data I should pull" (2026-08 vscode-scale data-loss finding).
   *  Empty-string sentinel for "not pending" — mirrors `META_KEY_TIER_B_BATCH_PENDING`'s
   *  existing convention (`IMetaRepo` has no delete()). */
  META_KEY_KNOWLEDGE_PACK_PENDING: "knowledgePackPending",
  /**
   * `docuvia_meta` key holding the running total of changed-file bytes (blob size at `HEAD` of
   * every file `analyze`'s delta ingestion re-parsed, summed across delta runs) since the last
   * Tier B batch — the commit-cap trigger's metric as of §9m item 1
   * (phase1-decision-integration.md), replacing the original raw-commit-count comparison. A
   * single large refactor commit inflates this even though it's only one commit, which raw commit
   * count structurally could never detect. Incremented by `run-delta-ingestion.ts`'s
   * `persistDelta` (reusing `filesToParse`'s already-computed content-length data — no new git
   * call); reset to `"0"` by `finalize-pending-tier-b-batch.ts` whenever a Tier B batch is
   * finalized. Only counts files `isDiscoverableSourceFile` already lets through delta ingestion's
   * `toReparse` filter, so docs/binaries are excluded for free.
   */
  META_KEY_TIER_B_CHANGED_BYTES: "tierBChangedBytes",
  /**
   * Default Tier B commit-cap trigger threshold, in cumulative changed-file bytes (§9m item 1) —
   * config-tunable via `DOCUVIA_TIER_B_COMMIT_CAP` (read by the Presentation layer only, per the
   * `process.env` rule; the env var name is unchanged even though its unit changed from a commit
   * count to a byte count — phase1-decision-integration.md §9m frames this as "the commit-cap"
   * throughout, just with a different metric). Unvalidated: no measured drift-vs-batch-value
   * correlation exists yet. Picked to fire once a multi-file refactor's worth of source has
   * changed (dozens of files at a few KB each) without tripping on a typical single/few-file
   * commit; tune if real usage shows it's off.
   */
  DEFAULT_TIER_B_COMMIT_CAP_BYTES: 512_000,
  /**
   * Default Tier B workspace-wide coverage-fail threshold (dogfooding-findings-fixes.md Phase 2,
   * roadmap item 23) -- a fraction (not a percentage): `doctor`'s `tier_b_coverage` diagnostic
   * FAILs when `processedFiles / totalFiles` (`IFilesRepo.getTierBCoverage()`) falls below this.
   * Placeholder value, not derived from any prior measurement -- tune if real usage shows it's off.
   */
  DEFAULT_TIER_B_COVERAGE_FAIL_THRESHOLD: 0.5,

  /**
   * Default L2 semantic-coverage fail threshold (issue #135) -- a fraction (not a percentage):
   * `doctor`'s `l2_semantic_coverage` diagnostic FAILs when `describedNodes / totalNodes`
   * (`IGraphNodesRepo.getSemanticCoverage()`) falls below this. Deliberately low (0.1): Tier C
   * enrichment is expected to be sparse on a healthy graph (not every node needs a description),
   * but 0/6285 (issue #135's live state) must read as FAIL -- that's "semantically dead", not
   * "normal". Placeholder value, not derived from any prior measurement -- tune if real usage
   * shows it's off.
   */
  DEFAULT_L2_SEMANTIC_COVERAGE_FAIL_THRESHOLD: 0.1,

  /**
   * How long an entry may sit in `.docuvia/pending-l3-decisions.json` before `doctor`'s
   * `staged_l3_decisions` check calls it stranded (issue #134/#42).
   *
   * `--stage`'s contract is "flushes at the next commit whose diff contains this file". A day is
   * therefore already well past that contract on any active repo, while still tolerating a
   * stage-tonight/commit-tomorrow flow -- it is a "this condition is never going to become true"
   * line, not a latency budget. Deliberately not zero: an entry staged minutes ago is in flight,
   * not stranded. Measured motivation: two entries sat for 5 days across twelve flushes, each
   * logging `flushed: 0`, which is not an error and which nothing surfaced.
   */
  DEFAULT_STAGED_L3_STRANDED_AFTER_MS: 24 * 60 * 60 * 1000,

  /**
   * `docuvia_meta` key holding the count of *consecutive* Tier B batches that drained an
   * attemptable set and produced zero progress (0 files processed AND 0 edges applied) -- the
   * zero-progress watchdog's cross-batch accumulator (2026-08 moby benchmark follow-up, issue #22
   * split item 2 "batch-deadline safety net"). Written by `run-tier-b-batch` after every batch
   * that had something to process: any progress resets it to `"0"`, another zero-progress batch
   * increments it, and once it reaches `DEFAULT_TIER_B_ZERO_PROGRESS_MAX_BATCHES` the batch's
   * still-retryable `failedEntries` are treated as permanently-failed and dropped from the
   * re-queue -- the safety net for the "same files hit their per-file deadline on every batch,
   * zero edges forever" case the per-file `retryable: false` classification can't reach (those
   * files report `retryable: true` because the whole-batch deadline, not the file, cut them
   * short). Absent -> treated as `0`.
   */
  META_KEY_TIER_B_ZERO_PROGRESS_BATCHES: "tierBZeroProgressBatches",
  /**
   * Default Tier B zero-progress watchdog threshold (see `META_KEY_TIER_B_ZERO_PROGRESS_BATCHES`
   * above) -- consecutive zero-progress batches before the still-retryable remainder is declared
   * permanently-failed and dropped from the re-queue. Mirrors Tier C's own poison-pill cap
   * (`DEFAULT_TIER_C_MAX_ITEM_FAILURES: 3`) -- N matches the project's established "three
   * consecutive tries then give up" convention for queue entries that never progress. Not
   * config-tunable yet; a placeholder value like the commit-cap / coverage-threshold defaults --
   * tune if real usage shows it's off.
   */
  DEFAULT_TIER_B_ZERO_PROGRESS_MAX_BATCHES: 3,
  /**
   * Doctor's `post_commit_ingestion` grace window (issue #58), in milliseconds -- how recent an
   * `analyze.log` event must be for a `lastIngestedSourceSha !== HEAD` mismatch to be treated as
   * "ingestion in flight / just ran" (PASS-with-note) rather than "the post-commit hook never
   * fires" (FAIL). Tier A delta ingestion is designed to be sub-second, so ten minutes is a
   * deliberately generous bound against a just-committed-but-still-backgrounded run, not a
   * correctness requirement.
   */
  DEFAULT_POST_COMMIT_INGESTION_GRACE_MS: 600_000,

  /**
   * `docuvia_meta` key holding a JSON `Record<filePath, CallResolutionStats>` map (issue #221) —
   * the Tier A call-site resolution counters `GraphPersisterService.persist()` now returns,
   * accumulated by the orchestration layer after every full/delta/init parse+persist run. Full
   * ingestion replaces the whole map (it reparses everything); delta upserts just the re-parsed
   * files' entries and removes deleted files' entries, so the map never accumulates rows for
   * files that left the worktree. Read by `doctor`'s `call_graph_resolution` diagnostic.
   */
  META_KEY_CALL_RESOLUTION_STATS: "callResolutionStats",
  /**
   * Default call-graph resolution note threshold (issue #221) -- a fraction (not a percentage):
   * `doctor`'s `call_graph_resolution` diagnostic notes when `resolved / (total -
   * selfDiscarded)` from `META_KEY_CALL_RESOLUTION_STATS` falls below this. Informational-only
   * for now (always PASS): member-expression call sites (`obj.method()`) are structurally
   * unresolvable under the current same-file/import resolution model and constructor calls
   * aren't even extracted yet (#192), so the "right" healthy baseline is unknown until both land.
   * Placeholder value, not derived from any prior measurement -- tune once #192 fixes the
   * extractor blind spot.
   */
  DEFAULT_CALL_RESOLUTION_NOTE_THRESHOLD: 0.5,

  /**
   * Minimum applicable call sites (total minus self-discarded) a file needs before its
   * resolution rate is statistically meaningful for issue #221's consumers (`doctor`'s note
   * and `impact`'s empty-result why-note): below this, one or two unresolved calls would flip
   * the verdict on an otherwise-fine file. Placeholder value -- tune if real usage shows it's
   * off.
   */
  DEFAULT_CALL_RESOLUTION_MIN_SAMPLE: 5,

  /**
   * Issue #221 P3: how many `l2_nodes` names `doctor`'s canary self-test samples
   * (`IGraphNodesRepo.getCanarySample`). Large enough that a lookup/FTS regression is very
   * likely to hit at least one sampled row, small enough to stay free even at 100k+ nodes.
   * Placeholder value -- tune if real usage shows it's off.
   */
  DEFAULT_CANARY_SAMPLE_SIZE: 20,

  PRE_PUSH_HOOK_NAME: "pre-push",
  /**
   * Fires the Tier B batch on push (phase1-decision-integration.md §8h, D7) — synchronous, with
   * a generous initial timeout (measure via JSONL logs before tightening, per the owner's
   * "function first" ruling). `docuvia snapshot` only runs when `analyze --escalate-to-lsp`
   * exits 0 (honest degradation exits 0 too, so a missing/unready LSP still lets the batch's
   * snapshot land). Present in both `PRE_PUSH_HOOK_CONTENT` and `LEGACY_PRE_PUSH_HOOK_CONTENT`
   * (below) — "installed at all" detection, not "which version" detection; use
   * `PRE_PUSH_SYNC_KNOWLEDGE_MARKER` to tell the two apart.
   */
  PRE_PUSH_HOOK_MARKER: "docuvia analyze --escalate-to-lsp",
  /**
   * Phase 2 sync-knowledge-scheduling.md SKSCHED-001/003: present only in the current
   * `PRE_PUSH_HOOK_CONTENT`, absent from `LEGACY_PRE_PUSH_HOOK_CONTENT` — the marker
   * `installPrePushHook` uses to tell an up-to-date hook from a pre-Phase-2 one that still needs
   * the in-place upgrade.
   */
  PRE_PUSH_SYNC_KNOWLEDGE_MARKER: "docuvia sync-knowledge",
  /**
   * Present only in the current `PRE_PUSH_HOOK_CONTENT`, absent from
   * `SYNC_KNOWLEDGE_PRE_PUSH_HOOK_CONTENT`/`LEGACY_PRE_PUSH_HOOK_CONTENT` — the marker
   * `installPrePushHook` uses to tell a hook that already opts `analyze --escalate-to-lsp` out of
   * D2's non-interactive hard-fail gate (`--fallback-ast` — phase1-decision-integration.md §8c,
   * the 2026-07 C#/TS benchmark environment-detection follow-up). Without this flag the pre-push
   * hook's own Tier B step would start failing the moment the LSP environment isn't ready, which
   * would skip `snapshot`/`sync-knowledge` for that push (the hook's own trailing `exit 0` still
   * keeps `git push` itself from being blocked either way).
   */
  PRE_PUSH_ENV_GATE_MARKER: "--fallback-ast",
  /**
   * `docuvia hooks disable tier-b-c-prepush`'s enforcement (issue #42 §7.5) -- present only in
   * the current `PRE_PUSH_HOOK_CONTENT`, absent from `ENV_GATE_PRE_PUSH_HOOK_CONTENT`/
   * `SYNC_KNOWLEDGE_PRE_PUSH_HOOK_CONTENT`/`LEGACY_PRE_PUSH_HOOK_CONTENT` -- the marker
   * `installPrePushHook` uses to tell a hook that already gates the batch on the `tier-b-c-prepush`
   * toggle from one still missing it.
   */
  PRE_PUSH_HOOKS_CHECK_MARKER: "docuvia hooks check",
  /**
   * Phase 2 sync-knowledge-scheduling.md SKSCHED-001: composes `sync-knowledge` onto the same
   * pre-push batch Tier B already occupies, after `snapshot` — reconciliation only makes sense
   * once a fresh local snapshot commit exists to reconcile. Wired here (not post-commit) so the
   * knowledge branch is fetched once per push, never once per commit (SKSCHED-001's whole reason
   * for picking this composition point over a second hook or a separate scheduler).
   */
  /** `> /dev/null 2>&1` (portable), not `&>` (bash-only) — see `POST_COMMIT_HOOK_CONTENT`'s doc
   *  comment on why: husky's shim runs a redirected hook via `sh -e`, not bash.
   *
   *  `docuvia hooks check tier-b-c-prepush &&` composed onto the front of the existing `&&` chain
   *  (issue #42 §7.5): a genuine no-op gate, not a filter -- exiting `1` when disabled simply
   *  short-circuits the rest of the chain (`analyze --escalate-to-lsp`/`snapshot`/`sync-knowledge`
   *  never run that push), while the hook's own trailing `exit 0` (unchanged) still means `git
   *  push` itself is never blocked either way. The toggle gates the automatic trigger, never the
   *  underlying CLI capability -- a developer can still run `docuvia analyze --escalate-to-lsp`
   *  manually at any time regardless of whether `tier-b-c-prepush` is disabled. */
  PRE_PUSH_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Tier B Batch Hook (LSP escalation + snapshot + knowledge sync)\n` +
    `# Runs synchronously (generous timeout) so pushed code carries corrected knowledge -- see\n` +
    `# docs/gitbook/analysis/phase1-decision-integration.md §8h and\n` +
    `# docs/gitbook/analysis/phase2-sync-knowledge-scheduling.md.\n` +
    `if command -v npx > /dev/null 2>&1; then\n` +
    `  npx --no-install docuvia hooks check tier-b-c-prepush && npx --no-install docuvia analyze --escalate-to-lsp --fallback-ast && npx --no-install docuvia snapshot && npx --no-install docuvia sync-knowledge\n` +
    `fi\n` +
    `# Never blocks the push on a Tier B/sync-knowledge failure -- PLAT-007's reliability\n` +
    `# requirement (failures only ever surface via JSONL logs / doctor, never to the pushing\n` +
    `# developer).\n` +
    `exit 0\n`,
  /**
   * The pre-issue-#42 hook's exact content (with `--fallback-ast`, before `docuvia hooks check
   * tier-b-c-prepush` was composed onto the front of its `&&` chain) -- retained verbatim so
   * `installPrePushHook` can recognize a hook installed before that gate was added and replace it
   * in place, same technique as the `SYNC_KNOWLEDGE_PRE_PUSH_HOOK_CONTENT`/
   * `LEGACY_PRE_PUSH_HOOK_CONTENT` upgrades below.
   */
  ENV_GATE_PRE_PUSH_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Tier B Batch Hook (LSP escalation + snapshot + knowledge sync)\n` +
    `# Runs synchronously (generous timeout) so pushed code carries corrected knowledge -- see\n` +
    `# docs/gitbook/analysis/phase1-decision-integration.md §8h and\n` +
    `# docs/gitbook/analysis/phase2-sync-knowledge-scheduling.md.\n` +
    `if command -v npx > /dev/null 2>&1; then\n` +
    `  npx --no-install docuvia analyze --escalate-to-lsp --fallback-ast && npx --no-install docuvia snapshot && npx --no-install docuvia sync-knowledge\n` +
    `fi\n` +
    `# Never blocks the push on a Tier B/sync-knowledge failure -- PLAT-007's reliability\n` +
    `# requirement (failures only ever surface via JSONL logs / doctor, never to the pushing\n` +
    `# developer).\n` +
    `exit 0\n`,
  /**
   * The sync-knowledge-era hook's exact content (SKSCHED-003), before `--fallback-ast` was added
   * to its `analyze --escalate-to-lsp` invocation -- retained verbatim so `installPrePushHook` can
   * recognize a hook installed before that flag was composed in and replace it in place, same
   * technique as the `LEGACY_PRE_PUSH_HOOK_CONTENT` upgrade below.
   */
  SYNC_KNOWLEDGE_PRE_PUSH_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Tier B Batch Hook (LSP escalation + snapshot + knowledge sync)\n` +
    `# Runs synchronously (generous timeout) so pushed code carries corrected knowledge -- see\n` +
    `# docs/gitbook/analysis/phase1-decision-integration.md §8h and\n` +
    `# docs/gitbook/analysis/phase2-sync-knowledge-scheduling.md.\n` +
    `if command -v npx > /dev/null 2>&1; then\n` +
    `  npx --no-install docuvia analyze --escalate-to-lsp && npx --no-install docuvia snapshot && npx --no-install docuvia sync-knowledge\n` +
    `fi\n` +
    `# Never blocks the push on a Tier B/sync-knowledge failure -- PLAT-007's reliability\n` +
    `# requirement (failures only ever surface via JSONL logs / doctor, never to the pushing\n` +
    `# developer).\n` +
    `exit 0\n`,
  /**
   * The pre-Phase-2 hook's exact content, retained verbatim so `installPrePushHook` can recognize
   * a hook installed before the `sync-knowledge` step was composed in and replace it in place
   * (phase2-sync-knowledge-scheduling.md SKSCHED-003) rather than appending a second, duplicate
   * Docuvia block alongside the old one — mirrors `LEGACY_POST_COMMIT_HOOK_CONTENT`'s precedent.
   */
  LEGACY_PRE_PUSH_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Tier B Batch Hook (LSP escalation + snapshot)\n` +
    `# Runs synchronously (generous timeout) so pushed code carries corrected knowledge -- see\n` +
    `# docs/gitbook/analysis/phase1-decision-integration.md §8h.\n` +
    `if command -v npx &> /dev/null; then\n` +
    `  npx --no-install docuvia analyze --escalate-to-lsp && npx --no-install docuvia snapshot\n` +
    `  # Phase 2: a sync-knowledge step composes here -- must not double-fetch (see §7a-5).\n` +
    `fi\n` +
    `# Never blocks the push on a Tier B failure -- PLAT-007's reliability requirement (failures\n` +
    `# only ever surface via JSONL logs / doctor, never to the pushing developer).\n` +
    `exit 0\n`,

  /**
   * `docuvia_meta` key holding a JSON array of Tier C candidates (phase1-decision-integration.md
   * §9c, E2) -- deduped by `target` (a commit sha for commit-message candidates, a `node_key` for
   * `CONTRACT_CHANGED` symbol candidates). Enqueued by Tier A's delta ingestion (the same
   * `runDeltaIngestion` step that populates `tierBQueue`); drained by `analyze --escalate-to-lsp`
   * (the same pre-push composition Tier B drains from), item-by-item, each item dequeued only
   * once its extraction is durably persisted to `l3_nodes` (§9c's "same stage-then-finalize
   * discipline as Tier B" -- adapted to Tier C's own unit of durability, since L3 rows are
   * written immediately and don't wait on a snapshot the way Tier B's edges do).
   */
  META_KEY_TIER_C_QUEUE: "tierCQueue",
  /**
   * `docuvia_meta` key holding a JSON `{ date, calls, tokens }` record (phase1-decision-integration.md
   * §9c, E2) -- `date` is a UTC `YYYY-MM-DD` stamp. Reset is lazy: on every read, if `date` is not
   * today (UTC), the counters are treated as zero before any budget check, rather than a
   * scheduled/timer-driven reset (this project has no resident process to run one).
   */
  META_KEY_TIER_C_BUDGET: "tierCBudget",
  /** Default Tier C daily LLM call-budget cap (§9c/§9f) -- config-tunable via
   *  `DOCUVIA_TIER_C_DAILY_CALL_CAP` (read by the Presentation layer only). */
  DEFAULT_TIER_C_DAILY_CALL_CAP: 50,
  /** Default Tier C daily estimated-token-budget cap (§9c/§9f) -- config-tunable via
   *  `DOCUVIA_TIER_C_DAILY_TOKEN_CAP`. Tokens are estimated (the CLIProxyAPI bridge's wire format
   *  carries no `usage` field today), not read back from the provider -- see
   *  `tier-c-token-estimate.ts`'s doc comment. */
  DEFAULT_TIER_C_DAILY_TOKEN_CAP: 100_000,
  /** Default Tier C per-run wall-clock cap, in milliseconds (§9d) -- config-tunable via
   *  `DOCUVIA_TIER_C_WALL_CLOCK_MS`. Whichever of this or `DEFAULT_TIER_C_ITEM_CAP` binds first
   *  stops the drain; leftovers stay queued for the next run. */
  DEFAULT_TIER_C_WALL_CLOCK_MS: 12_000,
  /** Default Tier C per-run item-count cap (§9d) -- config-tunable via `DOCUVIA_TIER_C_ITEM_CAP`. */
  DEFAULT_TIER_C_ITEM_CAP: 20,
  /** Default Tier C system-load-check threshold (§9f) -- `os.loadavg()[0] / os.cpus().length`
   *  above this skips the drain. Config-tunable via `DOCUVIA_TIER_C_LOAD_THRESHOLD`. A documented
   *  no-op on Windows (`os.loadavg()` always returns zeros there) -- see `tier-c-throttle.ts`. */
  DEFAULT_TIER_C_LOAD_THRESHOLD: 0.8,
  /** Default retry budget (consecutive per-item extraction failures, across `analyze` runs)
   *  before a permanently-failing Tier C queue entry is evicted instead of blocking every item
   *  behind it forever -- `recordTierCQueueFailure`'s poison-pill cap. */
  DEFAULT_TIER_C_MAX_ITEM_FAILURES: 3,
} as const;
