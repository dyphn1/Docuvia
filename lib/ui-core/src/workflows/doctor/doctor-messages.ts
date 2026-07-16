/** Diagnostic-result record keys populated by the `doctor` workflow. */
export const DOCTOR_DIAGNOSTIC_KEYS = {
  DB_RUNNER: "db_runner",
  DB_FOUND: "db_found",
  GIT_REACHABILITY: "git_reachability",
  GIT_RUNNER: "git_runner",
  LOGS: "logs",
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
} as const;
