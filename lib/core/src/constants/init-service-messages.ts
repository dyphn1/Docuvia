export const INIT_SERVICE_MESSAGES = {
  INITIALIZING: (root: string) => `Initializing project in ${root}...`,
  CREATING_BRANCH: "Creating hidden docuvia-knowledge branch...",
  INSTALLING_HOOK: "Installing post-commit hook...",
  INITIALIZING_DB: "Initializing SQLite database...",
  SCANNING_WORKSPACE: "Scanning workspace files...",
  PARSING_AST: "Parsing source files via AST...",
  PROPOSING_TAGS: "Proposing L1 tags from heuristics...",
  WRITING_SNAPSHOT: "Writing cognitive snapshot to local.db...",
  INITIALIZING_TEMP_FILES: "Initializing temp file manager...",
  SUCCESS: "Project initialized successfully",
} as const;
