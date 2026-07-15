/** Progress/result messages for the `init` workflow — emitted as `logger.info()` events, which the Presentation layer's listener renders as spinner text, pino output, or both. */
export const INIT_MESSAGES = {
  INITIALIZING: (root: string) => `Initializing project in ${root}...`,
  INSTALLING_HOOK: "Installing post-commit hook...",
  SCANNING_WORKSPACE: "Scanning workspace files...",
  PARSING_AST: "Parsing source files via AST...",
  INITIALIZING_TEMP_FILES: "Initializing temp file manager...",
  PERSISTING_GRAPH: "Persisting knowledge graph...",
  SUCCESS: "Project initialized successfully",
  PARTIAL_SUCCESS: (failed: number, requested: number) =>
    `Project initialized — ${failed} of ${requested} files failed to parse (see .docuvia/logs/init.log)`,
  SUCCESS_WITH_SKIPPED_OVERSIZED: (skipped: number) =>
    `Project initialized successfully — ${skipped} oversized file(s) skipped (see .docuvia/logs/init.log)`,
  OPEN_DB_FAILED: "Failed to open the local database",
  TEMP_FILE_MANAGER_INITIALIZED: "Temp file manager initialized",
  TEMP_FILE_MANAGER_INIT_FAILED:
    "Failed to initialize temp file manager (non-fatal)",
  CLEANING_UP_TEMP_FILES: "Cleaning up temp files on shutdown...",
  TEMP_FILE_CLEANUP_FAILED: "Temp file cleanup on shutdown failed",
  PARSE_FAILURES_OR_SKIPPED:
    "init completed with parse failures or skipped files",
} as const;

/** Structured-log event names appended to `init.log` by the `init` workflow. */
export const INIT_EVENTS = {
  START: "init.start",
  SUMMARY: "init.summary",
  PARSE_FAILURE: "init.parse_failure",
  FILE_SKIPPED_OVERSIZED: "init.file_skipped_oversized",
} as const;
