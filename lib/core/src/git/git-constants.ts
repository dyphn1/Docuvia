import { GIT_DEFAULT_REMOTE_NAME } from "@workspace/contracts";

/** Docuvia-specific git conventions — the domain semantics layered on top of `IGitProvider`'s raw primitives. */
export const GitConstants = {
  KNOWLEDGE_ROOT: "docuvia-knowledge",
  KNOWLEDGE_DIR_NAME: "knowledge",
  GRAPH_DIR_NAME: "graph",
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
  POST_COMMIT_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n` +
    `# Non-intrusively extracts AST deltas in the background\n` +
    `if command -v npx &> /dev/null; then\n` +
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
  /** Git's conventional name for the default/primary remote — shared with `lib/libgit2` via
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
  /** Default Tier B commit-cap trigger threshold (§8f, D5) — config-tunable via
   *  `DOCUVIA_TIER_B_COMMIT_CAP` (read by the Presentation layer only, per the `process.env` rule). */
  DEFAULT_TIER_B_COMMIT_CAP: 20,

  PRE_PUSH_HOOK_NAME: "pre-push",
  /**
   * Fires the Tier B batch on push (phase1-decision-integration.md §8h, D7) — synchronous, with
   * a generous initial timeout (measure via JSONL logs before tightening, per the owner's
   * "function first" ruling). `docuvia snapshot` only runs when `analyze --escalate-to-lsp`
   * exits 0 (honest degradation exits 0 too, so a missing/unready LSP still lets the batch's
   * snapshot land). The trailing comment marks where Phase 2's `sync-knowledge` pre-push step
   * will be composed in, so the two don't double-fetch (§7a-5) — not wired in this slice.
   */
  PRE_PUSH_HOOK_MARKER: "docuvia analyze --escalate-to-lsp",
  PRE_PUSH_HOOK_CONTENT:
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
