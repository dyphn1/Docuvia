export const CLI_FLAGS = {
  GLOBAL: "--global",
  COMMIT_SHA: "--commitSha=",
  BASE_REF: "--baseRef=",
  ESCALATE_TO_LSP: "--escalate-to-lsp",
  FORMAT: "--format=",
  LIMIT: "--limit=",
  OUT: "--out=",
  JSON_ONLY: "--json-only",
  COLLAPSE: "--collapse=",
  PLATFORM: "--platform=",
  KEEP_DB: "--keep-db",
  SKIP_DB: "--skip-db",
  SKIP_GIT: "--skip-git",
  SKIP_HOOKS: "--skip-hooks",
  SKIP_LOGS: "--skip-logs",
} as const;

/** Values accepted by `--format=` (`query` command) — shared between `cli.ts`'s flag cast and `query.ts`'s runtime dispatch. */
export const QUERY_OUTPUT_FORMATS = {
  HUMAN: "human",
  PROMPT: "prompt",
} as const;
export type QueryOutputFormat =
  (typeof QUERY_OUTPUT_FORMATS)[keyof typeof QUERY_OUTPUT_FORMATS];
