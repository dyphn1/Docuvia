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
} as const;
