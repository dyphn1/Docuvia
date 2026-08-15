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
  /** `doctor`'s LSP-binary-readiness check (§10e bullet 4 / §7a-1, T8) -- skips it entirely,
   *  mirroring `SKIP_GIT`'s existing precedent for a fixture that deliberately has no LSP
   *  environment set up (e.g. a concurrency test only interested in SQLite behavior). */
  SKIP_LSP: "--skip-lsp",
  /** `doctor`'s Tier C LLM endpoint reachability probe -- a real network call with its own
   *  timeout, so this skips it entirely, mirroring `SKIP_GIT`/`SKIP_LSP`'s existing precedent for
   *  a fixture/test that isn't exercising LLM connectivity (e.g. a concurrency test spawning
   *  several `doctor` processes at once, where several simultaneous network probes can time out
   *  under real contention). */
  SKIP_LLM: "--skip-llm",
  /** `analyze --escalate-to-lsp`'s D2 gate (phase1-decision-integration.md §8c): skips the gate
   *  entirely when the LSP environment isn't ready -- interactive, this skips the "continue with
   *  AST-only fallback?" prompt; non-interactive, this skips the hard failure -- and proceeds
   *  straight to the degrade-and-log path either way. The pre-push hook always passes this (see
   *  `PRE_PUSH_HOOK_CONTENT` in git-constants.ts) so a push is never blocked by an unready LSP
   *  environment. */
  FALLBACK_AST: "--fallback-ast",
  /** `analyze --escalate-to-lsp`'s §8b/§8h LSP timeout override, in milliseconds -- takes
   *  precedence over the `DOCUVIA_LSP_TIMEOUT_MS` env var. `0` means "never time out" (some
   *  servers, e.g. csharp-ls on a large Roslyn/MSBuild solution, have no known upper bound on how
   *  long a first response can take). */
  LSP_TIMEOUT: "--lsp-timeout=",
  /** `analyze --escalate-to-lsp`'s Tier B multi-process sharding override -- how many independent
   *  LSP server processes to shard the Tier B batch across (`--lsp-processes=N`; default: the
   *  provider auto-derives a core-and-memory-bounded count per PRJ-004, pass an explicit `1` for
   *  a single server). The throughput lever that sidesteps a single server process's serial
   *  compute; memory scales linearly with the count. Takes precedence over the
   *  `DOCUVIA_LSP_MAX_PROCESSES` env var. */
  LSP_PROCESSES: "--lsp-processes=",
  /** `analyze --escalate-to-lsp --full`'s full-resync trigger (typescript-cli-benchmark.md
   *  §5.3/§5.7 item 1): queues every currently-tracked file into `tierBQueue` before draining it,
   *  instead of just whatever a delta/full ingestion already queued -- the only way to force Tier
   *  B to (re-)compute a symbol's incoming `calls` edges for callers that haven't been touched by
   *  a commit since Tier B started working (or since the graph predates commit `4232439f`).
   *  Ignored outside `--escalate-to-lsp`. Can be slow/expensive on a large repo -- an explicit,
   *  occasional operator action, not part of the default per-commit path. */
  FULL: "--full",
  /** `doctor --fix` (phase1-decision-integration.md §10d, T6) -- the only `doctor` flag that
   *  mutates workspace files, and only for the legacy-hook duplicate-block condition. */
  FIX: "--fix",
  HELP: "--help",
  HELP_SHORT: "-h",
  VERSION: "--version",
  VERSION_SHORT: "-v",
  FORCE: "--force",
  FORCE_SHORT: "-f",
  /** IFCE-004: interactive prompts (wizard menu, confirmations, missing-arg input) are opt-in
   *  only -- a bare `stdin.isTTY` check false-positives inside pty-wrapping agent/terminal
   *  integrations that never deliver real keypresses, hanging the process forever. A command
   *  only prompts when the caller explicitly passes this flag (and stdin is actually usable). */
  INTERACTIVE: "--interactive",
  INTERACTIVE_SHORT: "-i",
  /** `analyze <targetPath> --agent-authored` (issue #42, roadmap items 32-34): skips
   *  `resolveAnalyzeLlmConfig()`/the LLM call entirely -- the decisions JSON is read from stdin
   *  (default) or --decisions-file and persisted verbatim with source='agent-authored'. */
  AGENT_AUTHORED: "--agent-authored",
  /** Reads the `--agent-authored` payload from a file instead of stdin -- for shells where piping
   *  is awkward (e.g. Windows PowerShell). Ignored when `--agent-authored` is not also set. */
  DECISIONS_FILE: "--decisions-file=",
  /** `analyze <targetPath> --agent-authored --stage` (issue #42, Decision 2's two-stage stage-
   *  and-flush design §8.1): instead of writing straight to `l3_nodes`, appends the payload's
   *  decisions into `.docuvia/pending-l3-decisions.json` for the post-commit hook's
   *  `--flush-staged-l3` step to drain later. Valid only combined with `--agent-authored`;
   *  ignored otherwise (same "ignored, not an error" precedent as `--decisions-file` without
   *  `--agent-authored`). */
  STAGE: "--stage",
  /** `docuvia analyze --flush-staged-l3` (issue #42 §8.2) -- a fourth, mutually-exclusive
   *  `analyze` mode alongside auto/`targetPath`/`--escalate-to-lsp`: no `targetPath`, no
   *  `--escalate-to-lsp`. Drains `.docuvia/pending-l3-decisions.json` entries whose `filePath` is
   *  in the current (post-commit) HEAD's changed-file list. Self-gated internally on the
   *  `commit-l3-write` toggle -- see `run-flush-staged-l3.ts`. */
  FLUSH_STAGED_L3: "--flush-staged-l3",
} as const;

/** Values accepted by `--format=` (`query` command) — shared between `cli.ts`'s flag cast and `query.ts`'s runtime dispatch. */
export const QUERY_OUTPUT_FORMATS = {
  HUMAN: "human",
  PROMPT: "prompt",
} as const;
export type QueryOutputFormat =
  (typeof QUERY_OUTPUT_FORMATS)[keyof typeof QUERY_OUTPUT_FORMATS];
