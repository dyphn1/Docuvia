import { GIT_DEFAULT_REMOTE_NAME } from "@workspace/contracts";

/** Docuvia-specific git conventions — the domain semantics layered on top of `IGitProvider`'s raw primitives. */
export const GitConstants = {
  KNOWLEDGE_ROOT: "docuvia-knowledge",
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
   */
  POST_COMMIT_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n` +
    `# Non-intrusively extracts AST deltas in the background\n` +
    `if command -v npx > /dev/null 2>&1; then\n` +
    `  # Fire and forget (do not block commit)\n` +
    `  npx --no-install docuvia analyze > /dev/null 2>&1 &\n` +
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
   *  `@workspace/contracts`'s `GIT_DEFAULT_REMOTE_NAME` per the Virtual Contracts rule that
   *  values needed by both a Domain Core and a Tech Provider package live in contracts. */
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
   * Phase 2 sync-knowledge-scheduling.md SKSCHED-001: composes `sync-knowledge` onto the same
   * pre-push batch Tier B already occupies, after `snapshot` — reconciliation only makes sense
   * once a fresh local snapshot commit exists to reconcile. Wired here (not post-commit) so the
   * knowledge branch is fetched once per push, never once per commit (SKSCHED-001's whole reason
   * for picking this composition point over a second hook or a separate scheduler).
   */
  /** `> /dev/null 2>&1` (portable), not `&>` (bash-only) — see `POST_COMMIT_HOOK_CONTENT`'s doc
   *  comment on why: husky's shim runs a redirected hook via `sh -e`, not bash. */
  PRE_PUSH_HOOK_CONTENT:
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
} as const;

/** Log messages and human-readable report text shared across the `git/` domain services. */
export const GitMessages = {
  DETECTED_CHANGES: "Detected changes",
  WORKING_TREE_HEAD: "working tree (HEAD)",
  NO_LOCAL_GRAPH_IMPACT:
    "No local graph impact detected for the changed files.",
  TOP_AFFECTED_FILES: "Top affected files:",
  analysisBase: (base: string) => `Base: ${base}`,
  analysisFilesChanged: (count: number) => `Files changed: ${count}`,
  analysisRiskLevel: (riskLevel: string) => `Risk level: ${riskLevel}`,
  analysisImpactedNodes: (totalImpacted: number, fileCount: number) =>
    `Impacted nodes: ${totalImpacted} across ${fileCount} changed file(s).`,
  analysisAffectedFileLine: (file: string, depCount: number, names: string) =>
    `  - ${file}: ${depCount} dependent(s) [${names}]`,

  KNOWLEDGE_BRANCH_ALREADY_EXISTS: "Knowledge branch already exists",
  CONCURRENT_INITIAL_COMMIT_SKIPPED:
    "Knowledge branch was created by a concurrent process; skipping duplicate initial commit",
  CREATED_KNOWLEDGE_BRANCH: "Created hidden knowledge branch",
  NO_GIT_HOOKS_DIR:
    "No .git/hooks directory; skipping post-commit hook install",
  POST_COMMIT_HOOK_ALREADY_INSTALLED: "Post-commit hook already installed",
  CONCURRENT_HOOK_INSTALL_SKIPPED:
    "Post-commit hook was installed by a concurrent process; skipping duplicate append",
  FAILED_TO_INSTALL_HOOK: "Failed to install post-commit hook",
  INSTALLED_POST_COMMIT_HOOK: "Installed post-commit hook",
  UPGRADED_LEGACY_POST_COMMIT_HOOK:
    "Upgraded legacy post-commit hook (docuvia snapshot -> docuvia analyze)",
  PRE_PUSH_HOOK_ALREADY_INSTALLED: "Pre-push hook already installed",
  CONCURRENT_PRE_PUSH_HOOK_INSTALL_SKIPPED:
    "Pre-push hook was installed by a concurrent process; skipping duplicate append",
  FAILED_TO_INSTALL_PRE_PUSH_HOOK: "Failed to install pre-push hook",
  INSTALLED_PRE_PUSH_HOOK: "Installed pre-push hook",
  UPGRADED_LEGACY_PRE_PUSH_HOOK:
    "Upgraded legacy pre-push hook (added sync-knowledge step)",

  /** `uninstall`'s hook-removal messages (phase1-decision-integration.md §10a). */
  REMOVED_POST_COMMIT_HOOK: "Removed post-commit hook",
  REMOVED_PRE_PUSH_HOOK: "Removed pre-push hook",
  NO_POST_COMMIT_HOOK_TO_REMOVE: "No Docuvia post-commit hook to remove",
  NO_PRE_PUSH_HOOK_TO_REMOVE: "No Docuvia pre-push hook to remove",
  FAILED_TO_REMOVE_POST_COMMIT_HOOK: "Failed to remove post-commit hook",
  FAILED_TO_REMOVE_PRE_PUSH_HOOK: "Failed to remove pre-push hook",

  /** `doctor --fix`'s repair messages (phase1-decision-integration.md §10d). */
  REPAIRED_DUPLICATE_POST_COMMIT_HOOK:
    "Repaired duplicate post-commit hook block",
  NOTHING_TO_REPAIR: "Nothing to repair -- post-commit hook is not duplicated",
  PACKED_SNAPSHOT_ONTO_BRANCH: "Packed snapshot onto knowledge branch",
  NO_REMOTE_SKIP_RECONCILIATION:
    "No remote configured; skipping knowledge branch reconciliation",
  FAILED_TO_FETCH_CONTINUING_OFFLINE:
    "Failed to fetch knowledge branch from remote; continuing offline",
  /** Git's own stable porcelain message for "the ref you asked to fetch doesn't exist on that
   *  remote" (unchanged across git versions) -- distinguishes a brand-new, never-yet-pushed
   *  knowledge branch (a normal, expected state on a fresh project) from a genuine network/auth
   *  failure. Conflating the two used to mean a project's very first `sync-knowledge` could never
   *  push its knowledge branch to origin at all: the first fetch always hits this exact error
   *  (found via dogfooding Docuvia on Docuvia2 itself, 2026-07-21). */
  REMOTE_REF_NOT_FOUND_TEXT: "couldn't find remote ref",
  REMOTE_KNOWLEDGE_BRANCH_NOT_YET_ON_REMOTE:
    "Knowledge branch does not exist on remote yet; treating as first-ever push",
  ADOPTED_REMOTE_BRANCH:
    "Adopted remote knowledge branch (no local copy existed)",
  FAST_FORWARDED_LOCAL_BRANCH:
    "Fast-forwarded local knowledge branch to remote",
  MERGED_DIVERGED_BRANCH: "Merged diverged knowledge branch",
  FAILED_TO_PUSH_WILL_RETRY:
    "Failed to push knowledge branch to remote; will retry on next sync",
  SNAPSHOT_UNKNOWN: "Snapshot [unknown]",
  MERGE_WINNER_LOCAL: "local",
  MERGE_WINNER_REMOTE: "remote",
  mergeCommitMessage: (winnerIsLocal: boolean) =>
    `Merge knowledge branch (${winnerIsLocal ? "local" : "remote"} wins)`,
  snapshotCommitMessage: (sourceSha: string) =>
    `Snapshot [${sourceSha.slice(0, 7)}]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: ${sourceSha}`,

  NOTHING_TO_HYDRATE:
    "Nothing to hydrate from yet — knowledge branch doesn't exist",
  HYDRATED_KNOWLEDGE_GRAPH: "Hydrated knowledge graph from git",
  /** `IMPORTED_L3_CARDS`'s `logger.info` call (phase2-l3-distribution.md L3DIST-007) — shared by
   *  `HydrationService.hydrate()` and `sync-knowledge`'s post-reconcile import step. */
  IMPORTED_L3_CARDS: "Imported L3 decision cards from knowledge branch",

  failedToWriteMarkdown: (id: string, name: string, errMessage: string) =>
    `Failed to write markdown for node ${id} (${name}): ${errMessage}`,
  sanitizedPathEscapesKnowledgeDir: (relPath: string) =>
    `Sanitized markdown path escapes knowledge directory: ${relPath}`,
  markdownFrontmatter: (
    id: string,
    kind: string,
    name: string,
    filePath: string | undefined,
  ) =>
    "---\n" +
    `id: ${id}\n` +
    `type: ${kind}\n` +
    `name: ${name}\n` +
    (filePath ? `filePath: ${filePath}\n` : "") +
    "---\n",
  markdownFileBody: (name: string, filePath: string | undefined) =>
    `# File: ${name}\n\nPath: \`${filePath ?? name}\`\n`,
  markdownSymbolBody: (name: string, filePath: string | undefined) =>
    `# Symbol: ${name}\n\nFile: \`${filePath ?? ""}\`\n`,
} as const;
