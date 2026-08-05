/** Diagnostic-result record keys populated by the `doctor` workflow. */
export const DOCTOR_DIAGNOSTIC_KEYS = {
  DB_RUNNER: "db_runner",
  DB_FOUND: "db_found",
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
  /** Includes the resolved hook file path — same reasoning as `GIT_HOOK_RESOLVABLE`. */
  PRE_PUSH_HOOK_OK: (hookPath: string) =>
    `Pre-push hook is installed and includes the sync-knowledge step (${hookPath}).`,
  PRE_PUSH_HOOK_NOT_RESOLVABLE:
    "The pre-push hook is installed but `docuvia` is not resolvable from this workspace (the `npx --no-install` invocation would silently no-op on every push -- Tier B and sync-knowledge never actually run).",

  /** §10e bullet 3: Tier C CLIProxyAPI endpoint reachability pre-flight (T7). */
  LLM_NOT_CONFIGURED:
    "Not configured -- Tier C is inactive (AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL not set).",
  LLM_REACHABLE: "Tier C LLM endpoint is reachable.",
  LLM_UNREACHABLE: (reason: string) =>
    `Tier C LLM endpoint is configured but unreachable: ${reason}`,
  LLM_UNREACHABLE_SUGGESTION:
    "Check that the CLIProxyAPI bridge is running and AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL points at it.",

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
