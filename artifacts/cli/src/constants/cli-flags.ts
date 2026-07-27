export const CLI_FLAGS = {
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
  /** `analyze --escalate-to-lsp`'s D2 gate (phase1-decision-integration.md §8c): skips the
   *  interactive "continue with AST-only fallback?" prompt when the LSP environment isn't ready
   *  for a manual/interactive invocation -- proceeds straight to the degrade-and-log path. */
  FALLBACK_AST: "--fallback-ast",
  /** `doctor --fix` (phase1-decision-integration.md §10d, T6) -- the only `doctor` flag that
   *  mutates workspace files, and only for the legacy-hook duplicate-block condition. */
  FIX: "--fix",
  HELP: "--help",
  HELP_SHORT: "-h",
  VERSION: "--version",
  VERSION_SHORT: "-v",
  /** IFCE-004: interactive prompts (wizard menu, confirmations, missing-arg input) are opt-in
   *  only -- a bare `stdin.isTTY` check false-positives inside pty-wrapping agent/terminal
   *  integrations that never deliver real keypresses, hanging the process forever. A command
   *  only prompts when the caller explicitly passes this flag (and stdin is actually usable). */
  INTERACTIVE: "--interactive",
  INTERACTIVE_SHORT: "-i",
} as const;

/** Values accepted by `--format=` (`query` command) — shared between `cli.ts`'s flag cast and `query.ts`'s runtime dispatch. */
export const QUERY_OUTPUT_FORMATS = {
  HUMAN: "human",
  PROMPT: "prompt",
} as const;
export type QueryOutputFormat =
  (typeof QUERY_OUTPUT_FORMATS)[keyof typeof QUERY_OUTPUT_FORMATS];
