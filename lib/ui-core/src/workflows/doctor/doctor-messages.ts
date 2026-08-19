/** Diagnostic-result record keys populated by the `doctor` workflow. */
export const DOCTOR_DIAGNOSTIC_KEYS = {
  DB_RUNNER: "db_runner",
  DB_FOUND: "db_found",
  /** Issue #57: the never-ingested state `db_found` structurally can't see -- the local.db
   *  *file* exists but the graph inside it is empty (no project row, or 0 L2 nodes). */
  GRAPH_EMPTY: "graph_empty",
  /** Issue #58: the post-commit hook's backgrounded delta ingestion may not be firing at all
   *  (fire-and-forget `&` process dying with the hook's shell) -- HEAD vs
   *  `lastIngestedSourceSha` plus recent-`analyze.log`-activity staleness check. */
  POST_COMMIT_INGESTION: "post_commit_ingestion",
  GIT_REACHABILITY: "git_reachability",
  GIT_RUNNER: "git_runner",
  LOGS: "logs",
  /** §10c's doctor-half backup for the Tier B commit-cap nudge (T3 is the Tier-A/commit-time half). */
  TIER_B_COMMIT_CAP: "tier_b_commit_cap",
  /** dogfooding-findings-fixes.md Phase 2 (roadmap item 23): workspace-wide Tier B coverage --
   *  distinct question from `TIER_B_COMMIT_CAP` above (per-commit budget vs. "% of repo ever
   *  processed"). */
  TIER_B_COVERAGE: "tier_b_coverage",
  /** §10d/§7c: the legacy-hook duplicate-block / not-resolvable post-commit hook checks. */
  GIT_HOOK: "git_hook",
  /** phase2-sync-knowledge-scheduling.md SKSCHED-005: pre-push hook staleness (installed before
   *  the `sync-knowledge` step was composed in) -- a distinct hook file from `GIT_HOOK` above. */
  PRE_PUSH_HOOK: "pre_push_hook",
  /** §10e bullet 3: the Tier C CLIProxyAPI endpoint reachability pre-flight. */
  LLM_REACHABILITY: "llm_reachability",
  /** §10e bullet 4 / §7a-1: LSP binary presence, independent of whether Tier B has ever run.
   *  multi-language-lsp-support plan, Finding A/G: one diagnostic key per registered language --
   *  Slice 0's registry only has `typescript`, so the produced key is `lsp_binary_typescript`. */
  LSP_BINARY: (languageId: string) => `lsp_binary_${languageId}`,
  /** Claude/Cursor AI-agent hook presence -- folded in from `doctor.ts`'s plain `fs.stat` logic
   *  to close the Presentation-layer asymmetry `doctor-execution-flow.md` flagged. Distinct from
   *  `GIT_HOOK` above, which is the git post-commit hook, a different "hook" concept entirely. */
  AGENT_HOOKS_CLAUDE: "agent_hooks_claude",
  AGENT_HOOKS_CURSOR: "agent_hooks_cursor",
  /** Issue #134: the permanently-stuck Tier C queue `llm_reachability`'s liveness ping can't see
   *  -- non-empty queue + a last drain that processed nothing = the bridge path analyze dials is
   *  dead, even when the bare-baseUrl GET succeeds. */
  TIER_C_QUEUE: "tier_c_queue",
  /** Issue #135: L2 semantic coverage -- % of `l2_nodes` rows carrying a non-empty `description`.
   *  Tier C (the LLM enrichment pass) is the writer; 0/6285 is the "structurally correct but
   *  semantically empty" state issue #135 documents, which `graph_empty` (count-only) can't see. */
  L2_SEMANTIC_COVERAGE: "l2_semantic_coverage",
  /** Issue #137: per-worktree knowledge-graph fragmentation -- this repo's dev flow is heavily
   *  worktree-based, and each worktree gets its own `.docuvia/local.db` with no reconciliation
   *  story, so a decision staged in one worktree may never reach the graph another queries. */
  WORKTREE_DIVERGENCE: "worktree_divergence",
  /** Issue #139: docuvia-first workflow adoption -- staged/agent-authored L3 decision counts, so
   *  "4 agent-authored decisions ever, none this week" is visible instead of silent. Always PASS
   *  (informational, soft enforcement), mirroring `TIER_B_COMMIT_CAP`'s precedent. */
  AGENT_AUTHED_ADOPTION: "agent_authored_adoption",
} as const;

/** Extension used to identify per-command run-log files under `.docuvia/logs/`. */
export const LOG_FILE_EXTENSION = ".log";

/** Human-readable AI-agent platform names interpolated into `DOCTOR_MESSAGES.AGENT_HOOKS_FOUND`/
 *  `AGENT_HOOKS_NOT_FOUND`, paired with `DOCTOR_DIAGNOSTIC_KEYS.AGENT_HOOKS_CLAUDE`/`_CURSOR`. */
export const DOCTOR_AGENT_PLATFORM_NAMES = {
  CLAUDE: "Claude",
  CURSOR: "Cursor",
} as const;

/** Diagnostic messages/suggestions for the `doctor` workflow. */
export const DOCTOR_MESSAGES = {
  DB_RUNNER_NOT_REGISTERED: "DiagnosticRunnerDb not registered",
  DB_NOT_FOUND_AT: (dbPath: string) => `Local database not found at ${dbPath}`,
  /** Issue #57: `local.db` exists but nothing was ever ingested -- the exact precondition under
   *  which `--agent-authored --stage` / `--flush-staged-l3` silently retry forever with no anchor
   *  to attach decisions to (the only visible trace being a JSONL log line). */
  GRAPH_EMPTY:
    "The knowledge graph is empty (nothing ingested yet) -- staged decisions have no L2 anchor to attach to.",
  GRAPH_EMPTY_SUGGESTION:
    "run `docuvia init` first — decisions need a graph to attach to",
  GRAPH_EMPTY_OK: (l2Nodes: number) =>
    `Knowledge graph populated (${l2Nodes} L2 node(s)).`,

  /** Issue #58: graph fully up to date with HEAD -- the post-commit hook's last delta ingestion
   *  landed. Carries the Tier C queue size so a permanently-empty queue is visible (roadmap
   *  issue #58's "surface enqueue/drain counts" ask) rather than silent. */
  POST_COMMIT_INGESTION_OK: (tierCQueued: number) =>
    `Knowledge graph is up to date with HEAD (Tier C queue: ${tierCQueued} pending).`,
  /** Issue #58: behind HEAD but an analyze run completed recently (within
   *  `DEFAULT_POST_COMMIT_INGESTION_GRACE_MS`) -- the post-commit hook's backgrounded process is
   *  likely still in flight; not yet a defect. */
  POST_COMMIT_INGESTION_RECENT: (
    lastIngestedSha: string | undefined,
    tierCQueued: number,
  ) =>
    `Delta ingestion is behind HEAD (last ingested ${lastIngestedSha ? lastIngestedSha.slice(0, 7) : "never"}) but ran recently -- likely still in flight from the post-commit hook (Tier C queue: ${tierCQueued} pending).`,
  /** Issue #58's live repro: HEAD advanced, `lastIngestedSourceSha` did not, and no analyze run
   *  completed within the grace window -- the post-commit hook's fire-and-forget backgrounding
   *  died (or never started). */
  POST_COMMIT_INGESTION_STALE: (tierCQueued: number) =>
    `The graph is behind HEAD and no analyze run has completed recently -- the post-commit hook's backgrounded ingestion may not be firing (Tier C queue: ${tierCQueued} pending).`,
  POST_COMMIT_INGESTION_STALE_SUGGESTION:
    "run `docuvia analyze` manually to ingest the pending commits, and check `.docuvia/logs/post-commit-hook.log` for hook failures",
  GIT_RUNNER_NOT_REGISTERED: "DiagnosticRunnerGit not registered",
  GIT_NETWORK_TIMEOUT_SUGGESTION:
    "The Git remote operation timed out (5000ms). Check your internet connection or DNS settings.",
  GIT_NOT_A_REPO_SUGGESTION:
    "Ensure this workspace is a valid Git repository and the remote 'origin' is set correctly.",
  GIT_REMOTE_UNREADABLE_SUGGESTION:
    "Check your SSH keys, PAT, or Git credentials for the remote repository.",
  GIT_REACHABILITY_FAILED: (message: string) =>
    `Git remote reachability check failed: ${message}`,
  GIT_NOT_A_REPO_TEXT: "does not appear to be a git repository",
  GIT_REMOTE_UNREADABLE_TEXT: "Could not read from remote repository",
  LOGS_ERRORS_FOUND: (errorsFound: number) =>
    `Found ${errorsFound} critical errors in logs.`,
  LOGS_ERRORS_FOUND_SUGGESTION:
    "Check the files in .docuvia/logs/ for details.",
  LOGS_CHECKED_CLEAN: (logsChecked: number) =>
    `Checked ${logsChecked} log files, no critical errors found.`,
  LOGS_NOT_FOUND_AT: (logPath: string) => `No logs found at ${logPath}`,

  /** §10c's doctor-half backup (T4) -- always PASS (decision 1d): a normal, expected,
   *  non-blocking state either way. */
  TIER_B_CAP_OK: "Tier B commit-cap not yet reached.",
  TIER_B_CAP_EXCEEDED:
    "Changed code since the last Tier B batch has exceeded the cap -- push, or run `docuvia analyze --escalate-to-lsp && docuvia snapshot`, to trigger it.",

  /** dogfooding-findings-fixes.md Phase 2 (roadmap item 23): workspace-wide Tier B coverage --
   *  a real, actionable gap when below `DEFAULT_TIER_B_COVERAGE_FAIL_THRESHOLD` (FAIL), unlike
   *  the always-PASS commit-cap check above. */
  TIER_B_COVERAGE_OK: (processed: number, total: number) =>
    `Tier B coverage: ${processed}/${total} files processed.`,
  TIER_B_COVERAGE_LOW: (processed: number, total: number, pct: number) =>
    `Only ${pct.toFixed(1)}% of tracked files have ever been Tier B-processed (${processed}/${total}) -- query results for the rest may show empty edges that mean "unprocessed", not "no relationships".`,
  TIER_B_COVERAGE_LOW_SUGGESTION:
    "Run `docuvia analyze --escalate-to-lsp --full` to resync.",

  /** §10d/§7c: legacy-hook duplicate-block / not-resolvable post-commit hook checks (T5). */
  GIT_HOOK_NOT_INSTALLED: "No Docuvia post-commit hook installed.",
  GIT_HOOK_DUPLICATE:
    "Duplicate hook blocks detected (both the legacy `docuvia snapshot` and current `docuvia analyze` blocks are present and will both fire on every commit).",
  GIT_HOOK_DUPLICATE_SUGGESTION: "run `docuvia doctor --fix` to repair",
  GIT_HOOK_LEGACY_ONLY:
    "The post-commit hook is still running the legacy `docuvia snapshot` command, which no longer performs Tier A delta ingestion.",
  GIT_HOOK_LEGACY_ONLY_SUGGESTION: "re-run `docuvia init` to upgrade the hook",
  /** Issue #48: a current-shaped (`docuvia analyze`) post-commit hook that predates the
   *  `--flush-staged-l3` step (#42's commit-l3-write) would silently never flush staged
   *  agent-authored L3 decisions -- a real staleness `POST_COMMIT_HOOK_MARKER` alone can't see. */
  GIT_HOOK_FLUSH_STALE:
    "The post-commit hook predates the commit-l3-write flush step -- staged agent-authored L3 decisions would never be flushed into the graph.",
  GIT_HOOK_FLUSH_STALE_SUGGESTION: "re-run `docuvia init` to upgrade the hook",
  GIT_HOOK_NOT_RESOLVABLE:
    "The post-commit hook is installed but `docuvia` is not resolvable from this workspace (the `npx --no-install` invocation would silently no-op on every commit).",
  GIT_HOOK_NOT_RESOLVABLE_SUGGESTION:
    "reinstall Docuvia as a project dependency, or check PATH",
  /** Includes the resolved hook file path (honors `core.hooksPath`/husky redirection, `IGitProvider.resolveHooksDir`) so a working
   *  hook's actual location is never silently ambiguous — found needed via dogfooding, 2026-07-21. */
  GIT_HOOK_RESOLVABLE: (hookPath: string) =>
    `Post-commit hook is installed and \`docuvia\` resolves (${hookPath}).`,
  GIT_HOOK_REPAIRED_NOTE:
    " Repaired via `doctor --fix` -- re-run `doctor` to confirm.",

  /** phase2-sync-knowledge-scheduling.md SKSCHED-005: pre-push hook staleness check. */
  PRE_PUSH_HOOK_NOT_INSTALLED: "No Docuvia pre-push hook installed.",
  PRE_PUSH_HOOK_STALE:
    "The pre-push hook predates the `sync-knowledge` step -- pushes no longer reconcile the knowledge branch with origin.",
  PRE_PUSH_HOOK_STALE_SUGGESTION: "re-run `docuvia init` to upgrade the hook",
  /** 2026-07 C#/TS benchmark environment-detection follow-up: a hook that already has the
   *  sync-knowledge step but predates `--fallback-ast` would start failing its own Tier B step
   *  (and so skip `snapshot`/`sync-knowledge`) the moment the LSP environment isn't ready. */
  PRE_PUSH_HOOK_ENV_GATE_STALE:
    "The pre-push hook predates the --fallback-ast env-gate flag -- its Tier B step will fail (skipping snapshot/sync-knowledge for that push) whenever the LSP environment isn't ready.",
  /** Issue #48: a pre-push hook that already has the sync-knowledge + env-gate steps but predates
   *  the `hooks check` gate (#42's tier-b-c-prepush toggle) would run the whole chain even when
   *  the user disabled it via `docuvia hooks disable tier-b-c-prepush`. */
  PRE_PUSH_HOOK_HOOKS_CHECK_STALE:
    "The pre-push hook predates the `hooks check` gate -- its Tier B/snapshot/sync-knowledge chain would run even when `tier-b-c-prepush` is disabled via `docuvia hooks disable`.",
  /** Includes the resolved hook file path — same reasoning as `GIT_HOOK_RESOLVABLE`. */
  PRE_PUSH_HOOK_OK: (hookPath: string) =>
    `Pre-push hook is installed and includes the sync-knowledge step (${hookPath}).`,
  PRE_PUSH_HOOK_NOT_RESOLVABLE:
    "The pre-push hook is installed but `docuvia` is not resolvable from this workspace (the `npx --no-install` invocation would silently no-op on every push -- Tier B and sync-knowledge never actually run).",
  /** Issue #133: appended to a stale pre-push hook FAIL after `doctor --fix` upgraded the hook in
   *  place -- same convention as `GIT_HOOK_REPAIRED_NOTE` (never silently claim fixed). */
  PRE_PUSH_HOOK_REPAIRED_NOTE:
    " Repaired via `doctor --fix` -- re-run `doctor` to confirm.",

  /** §10e bullet 3: Tier C CLIProxyAPI endpoint reachability pre-flight (T7) -- now exercised via
   *  `checkBridgeReachability()` (issue #134): a POST to the same `/v1/chat/completions` route
   *  Tier C's drain dials, not a GET on the bare baseUrl. */
  LLM_NOT_CONFIGURED:
    "Not configured -- Tier C is inactive (AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL or AI_DOCUVIA_MODEL not set).",
  LLM_REACHABLE:
    "Tier C LLM bridge is reachable and accepts the configured API key.",
  LLM_UNREACHABLE: (reason: string) =>
    `Tier C LLM bridge is configured but unreachable or rejecting requests: ${reason}`,
  LLM_UNREACHABLE_SUGGESTION:
    "Check that the CLIProxyAPI bridge is running, that its /v1/chat/completions route accepts the configured API key, and that AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL points at it.",

  /** Issue #134: the permanently-stuck Tier C queue. `tier_c_queue` FAILs when the queue is
   *  non-empty and the last completed drain processed nothing (or no drain ever completed) --
   *  the exact `processed: 0` evidence issue #134 reproduces. */
  TIER_C_QUEUE_OK: (queued: number, processed: number) =>
    `Tier C queue: ${queued} pending, last drain processed ${processed} item(s).`,
  TIER_C_QUEUE_STUCK: (queued: number, reason: string) =>
    `Tier C queue is stuck (${queued} pending; last drain processed 0, reason: ${reason}) -- the LLM bridge path analyze dials is not working, so L2 descriptions/validated edges will never be backfilled.`,
  TIER_C_QUEUE_STUCK_SUGGESTION:
    "Check that the CLIProxyAPI bridge is running and its /v1/chat/completions route accepts the configured API key, then run `docuvia analyze --escalate-to-lsp` to retry the drain",
  TIER_C_QUEUE_NEVER_DRAINED: (queued: number) =>
    `Tier C queue has ${queued} pending item(s) but no drain has ever completed -- either never enqueued-to-drained or permanently stuck from the start.`,
  TIER_C_QUEUE_NEVER_DRAINED_SUGGESTION:
    "Run `docuvia analyze --escalate-to-lsp` once so the drain path actually executes, and check `.docuvia/logs/analyze.log` for tierC events",

  /** Issue #135: L2 semantic coverage (see `L2_SEMANTIC_COVERAGE`'s key doc comment). */
  L2_SEMANTIC_COVERAGE_OK: (described: number, total: number) =>
    `L2 semantic coverage: ${described}/${total} node(s) carry a description.`,
  L2_SEMANTIC_COVERAGE_LOW: (described: number, total: number, pct: number) =>
    `Only ${pct.toFixed(1)}% of L2 nodes carry a description (${described}/${total}) -- the knowledge graph is structurally correct but semantically empty, so query/impact results surface little "why" content.`,
  L2_SEMANTIC_COVERAGE_LOW_SUGGESTION:
    "Run `docuvia analyze --escalate-to-lsp` (Tier C) so the LLM enrichment pass can backfill descriptions, or explicitly declare the graph structural-only",
  /** The same low-coverage state when Tier C is *not* configured -- structural-only is a
   *  legitimate, expected state (descriptions can't be written without an LLM bridge), so it's a
   *  visible PASS, not a FAIL (mirrors `LLM_NOT_CONFIGURED`'s "Tier C is inactive" convention). */
  L2_SEMANTIC_COVERAGE_STRUCTURAL_ONLY: (described: number, total: number) =>
    `L2 semantic coverage: ${described}/${total} node(s) carry a description (structural-only graph -- Tier C LLM enrichment is not configured, so descriptions cannot be written yet).`,

  /** Issue #137: per-worktree knowledge-graph fragmentation (see `WORKTREE_DIVERGENCE`'s key doc
   *  comment). FAILs when any sibling worktree carries its own `.docuvia/local.db`. */
  WORKTREE_DIVERGENCE_OK: (worktrees: number) =>
    `${worktrees} worktree(s) total; no sibling worktree carries its own .docuvia graph.`,
  WORKTREE_DIVERGENCE_FAIL: (count: number, paths: string[]) =>
    `${count} sibling worktree(s) carry their own .docuvia/local.db -- ${paths.join(", ")}: per-worktree knowledge graphs that never reconcile (decisions staged in one worktree never reach the others).`,
  WORKTREE_DIVERGENCE_SUGGESTION:
    "Point all worktrees at one graph via a shared DOCUVIA_DB_PATH (or a symlinked .docuvia), or run `docuvia sync-knowledge` from a canonical worktree before pushing",

  /** Issue #139: docuvia-first workflow adoption -- always PASS (informational/soft, mirroring
   *  `TIER_B_COMMIT_CAP`), but the numbers make a near-zero-adoption state visible. */
  AGENT_AUTHED_ADOPTION_OK: (
    staged: number,
    changedFiles: number,
    filesWithoutDecision: number,
    agentAuthoredL3: number,
  ) =>
    `Agent-authored decisions: ${agentAuthoredL3} flushed in graph, ${staged} staged pending flush; ${filesWithoutDecision} of ${changedFiles} recently-changed file(s) carry no staged decision.`,
  AGENT_AUTHED_ADOPTION_SKIPPED:
    "No recently-changed files to evaluate for agent-authored staging.",

  /** §10e bullet 4 / §7a-1: LSP binary presence, independent of Tier B having run (T8).
   *  `providerName` (multi-language-lsp-support plan, Finding A/G) is that language's provider's
   *  `IEdgeResolutionProvider.name` -- for TS/JS this is still `typescript-language-server`, so
   *  the produced message is byte-identical to before. */
  LSP_BINARY_AVAILABLE: (providerName: string) =>
    `LSP-precision edges available (${providerName} resolved).`,
  LSP_BINARY_UNAVAILABLE: (reason: string) =>
    `LSP-precision edges unavailable (${reason}).`,
  LSP_BINARY_UNAVAILABLE_SUGGESTION:
    "Build/compile the project so the language server can resolve it (install dependencies, restore/build for compiled languages), then re-run `docuvia doctor`.",

  /** Claude/Cursor agent-hooks presence -- always PASS either way (matches `LLM_NOT_CONFIGURED`'s
   *  precedent): a platform never selected at `init` is a legitimate state, not a defect. */
  AGENT_HOOKS_FOUND: (platformName: string) => `${platformName} hooks found.`,
  AGENT_HOOKS_NOT_FOUND: (platformName: string) =>
    `${platformName} hooks not found (run \`docuvia init\` to install).`,
} as const;
