/** Diagnostic-result record keys populated by the `doctor` workflow. */
export const DOCTOR_DIAGNOSTIC_KEYS = {
  DB_RUNNER: "db_runner",
  DB_FOUND: "db_found",
  GIT_REACHABILITY: "git_reachability",
  GIT_RUNNER: "git_runner",
  LOGS: "logs",
  /** §10c's doctor-half backup for the Tier B commit-cap nudge (T3 is the Tier-A/commit-time half). */
  TIER_B_COMMIT_CAP: "tier_b_commit_cap",
  /** §10d/§7c: the legacy-hook duplicate-block / not-resolvable post-commit hook checks. */
  GIT_HOOK: "git_hook",
  /** §10e bullet 3: the Tier C CLIProxyAPI endpoint reachability pre-flight. */
  LLM_REACHABILITY: "llm_reachability",
  /** §10e bullet 4 / §7a-1: LSP binary presence, independent of whether Tier B has ever run. */
  LSP_BINARY: "lsp_binary",
} as const;

/** Extension used to identify per-command run-log files under `.docuvia/logs/`. */
export const LOG_FILE_EXTENSION = ".log";

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
  GIT_HOOK_RESOLVABLE: "Post-commit hook is installed and `docuvia` resolves.",
  GIT_HOOK_REPAIRED_NOTE:
    " Repaired via `doctor --fix` -- re-run `doctor` to confirm.",

  /** §10e bullet 3: Tier C CLIProxyAPI endpoint reachability pre-flight (T7). */
  LLM_NOT_CONFIGURED:
    "Not configured -- Tier C is inactive (AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL not set).",
  LLM_REACHABLE: "Tier C LLM endpoint is reachable.",
  LLM_UNREACHABLE: (reason: string) =>
    `Tier C LLM endpoint is configured but unreachable: ${reason}`,
  LLM_UNREACHABLE_SUGGESTION:
    "Check that the CLIProxyAPI bridge is running and AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL points at it.",

  /** §10e bullet 4 / §7a-1: LSP binary presence, independent of Tier B having run (T8). */
  LSP_BINARY_AVAILABLE:
    "LSP-precision edges available (typescript-language-server resolved).",
  LSP_BINARY_UNAVAILABLE: (reason: string) =>
    `LSP-precision edges unavailable (${reason}) -- Tier B degrades to AST-level edges.`,
} as const;
