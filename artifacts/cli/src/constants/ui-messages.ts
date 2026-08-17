/**
 * `INIT_*`/general-CLI/filesystem-helper messages, plus `CLEAN_*`/`STATUS_*`/`PUBLISH_*`/`ANALYZE_*`
 * for the commands rebuilt so far — old Docuvia's ~100+ message file also carried `QUERY_*`/
 * `IMPACT_*`/`REVIEW_*`/`SNAPSHOT_*`/`EXPORT_*` for commands that don't exist in this milestone.
 * Port the rest in alongside each command as it's rebuilt.
 */
export const UI_MESSAGES = {
  // General CLI
  CLI_HEADER: "Docuvia Knowledge Graph",
  CLI_PROMPT_ACTION: "What would you like to do?",
  CLI_UNKNOWN_COMMAND: "Unknown command: ",
  CLI_FATAL_ERROR: "Fatal error: ",
  // IFCE-004: interactive prompts are opt-in (--interactive/-i) only.
  CLI_INTERACTIVE_NO_TTY:
    "--interactive requires a real terminal and is disabled under CI -- cannot launch the wizard menu.",
  CLI_INTERACTIVE_UNAVAILABLE:
    "--interactive was requested, but this session has no usable TTY (or is running under CI) -- continuing non-interactively.",

  // Init Command
  INIT_HEADER: "Initialize Docuvia",
  INIT_CONFIRM: "Initialize Docuvia in this workspace?",
  INIT_ABORTED: "Initialization aborted.",
  INIT_START: "Starting initialization...",
  INIT_FAILED: "Initialization failed: ",
  INIT_AGENT_HOOKS: "Initializing AI Agent integrations for Docuvia...",
  INIT_LOCK_WAITING:
    "Another `docuvia init` is already running in this workspace; waiting for it to finish...",

  // Init Agent Hooks
  INIT_HOOKS_CONFIG_MCP: "Configuring MCP Servers...",
  INIT_HOOKS_REGISTERED_MCP: "Registered MCP server in: ",
  INIT_HOOKS_FAIL_CURSOR_MCP: "Could not configure Cursor MCP: ",
  INIT_HOOKS_SUCCESS: "Docuvia Agent Integrations successfully installed!",
  INIT_HOOKS_SUPPORTED:
    "Supported platforms: Claude Code, Cursor, GitHub Copilot, Codex, Continue, Hermes Agent.",
  INIT_HOOKS_FAIL: "Failed to initialize agent integrations: ",
  INIT_HOOKS_SELECT: "Which AI Agent integrations would you like to install?",
  INIT_HOOKS_NONE_SELECTED:
    "No platforms selected. Skipping agent integrations.",
  // IFCE-002: Docuvia never writes machine-global state — print the snippet, let the user paste it.
  INIT_CLAUDE_MCP_MANUAL_SNIPPET:
    "To use Docuvia from Claude Desktop, add this to your global MCP config",

  // Filesystem write helper (writeOrAppend)
  FS_APPENDED: "Appended instructions to: ",
  FS_ALREADY_EXISTS: "Instructions already exist in: ",
  FS_CREATED: "Created: ",
  FS_READ_ERROR: "Could not read ",
  FS_READ_ERROR_UNKNOWN_CODE: "unknown error",
  FS_BLOCK_REMOVED_PREFIX: "Removed block from ",
  FS_BLOCK_REMOVED_SUFFIX: " (backup created)",
  /** Guards a write path (e.g. mergeDocuviaHookIntoProjectSettings) that finds a key already
   *  present with an unexpected (non-array) shape it can't safely merge into -- never coerce or
   *  overwrite a shape it can't trust, just warn and leave the file untouched. */
  FS_UNEXPECTED_SHAPE: (key: string, settingsPath: string) =>
    `Unexpected shape for "${key}" in ${settingsPath} (expected an array); leaving it untouched`,

  // Clean Command
  CLEAN_HEADER: "Clean Docuvia Database",
  CLEAN_CONFIRM:
    "This will permanently delete the local Docuvia database. Continue?",
  CLEAN_ABORTED: "Clean aborted.",
  CLEAN_START: "Cleaning database...",
  CLEAN_SUCCESS: "Clean complete. ",
  CLEAN_FAIL: "Clean failed: ",

  // Status Command
  STATUS_START: "Getting status...",
  STATUS_SUCCESS: "Status retrieved.",
  STATUS_FAIL: "Failed to get status: ",
  STATUS_HEADER: "Docuvia Status",
  STATUS_COL_METRIC: "Metric",
  STATUS_COL_VALUE: "Value",
  STATUS_METRIC_PROJECTS: "Projects",
  STATUS_METRIC_L2_NODES: "L2 Nodes",
  STATUS_METRIC_L3_DECISIONS: "L3 Decisions",
  STATUS_METRIC_TIER_B_COVERAGE: "Tier B Coverage",
  // Issue #58: pending Tier C (LLM-inferred L3) candidates -- surfaced so a permanently-empty
  // queue is visible rather than silent.
  STATUS_METRIC_TIER_C_QUEUE: "Tier C Queue",

  // Publish Command (IFCE-005: renamed from `sync`)
  PUBLISH_HEADER: "Publish to Docuvia",
  PUBLISH_MISSING_PROJECT_ID:
    "Project ID is required when not running interactively.",
  PUBLISH_NO_PROJECT_ID_PROVIDED: "No project ID provided.",
  PUBLISH_PROMPT_PROJECT_ID: "Enter the project ID to publish to: ",
  PUBLISH_PROJECT_ID_REQUIRED: "Project ID is required.",
  PUBLISH_MISSING_ENV: "DOCUVIA_API_URL and/or MCP_PAT are not set.",
  PUBLISH_SKIP: "Skipping publish.",
  PUBLISH_START: "Starting publish for project ",
  PUBLISH_SUCCESS: "Publish complete.",
  PUBLISH_FAIL: "Publish failed: ",

  // Analyze Command
  ANALYZE_HEADER: "Analyze Project",
  ANALYZE_START: "Analyzing project...",
  ANALYZE_SUCCESS: "Analysis complete.",
  ANALYZE_FAIL: "Analysis failed: ",
  ANALYZE_PROJECT_TYPE: "Project Type: ",
  ANALYZE_SUGGESTED_TAGS: "Suggested Tags: ",
  ANALYZE_NONE: "none",
  // Auto mode (PLAT-007 Tier A) — no-arg `analyze`'s three outcomes.
  ANALYZE_AUTO_FULL_SUCCESS: "Full ingestion complete.",
  ANALYZE_AUTO_FULL_SUMMARY: (
    filesParsed: number,
    filesRequested: number,
    filesFailed: number,
  ) =>
    `Parsed ${filesParsed}/${filesRequested} file(s) (${filesFailed} failed).`,
  ANALYZE_AUTO_DELTA_SUCCESS: "Delta ingestion complete.",
  ANALYZE_AUTO_DELTA_SUMMARY: (
    filesReparsed: number,
    filesDeleted: number,
    tierBQueued: number,
  ) =>
    `Re-parsed ${filesReparsed} file(s), dropped ${filesDeleted} deleted file(s)` +
    (tierBQueued > 0 ? `, queued ${tierBQueued} file(s) for Tier B.` : "."),
  ANALYZE_AUTO_NOOP_SUCCESS: "Already up to date.",
  /** 2026-07-24 C# benchmark follow-up: the fast-path is HEAD-sha-based and can't see uncommitted
   *  edits by design (PLAT-007) -- this variant tells an interactive human that explicitly instead
   *  of reporting the same "up to date" as a clean tree. */
  ANALYZE_AUTO_NOOP_DIRTY_WORKTREE_SUCCESS:
    "Already up to date with HEAD -- uncommitted changes in the working tree were not analyzed (commit them, then re-run).",
  ANALYZE_LLM_MISSING_ENV:
    "AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL and a model (AI_DOCUVIA_MODEL or AI_DOCUVIA_FAST_MODEL) must be set to analyze a specific path.",
  ANALYZE_FOCUSED_HEADER: "Analyze Path",
  ANALYZE_FOCUSED_START: "Extracting decisions from ",
  ANALYZE_FOCUSED_SUCCESS: "Decision extraction complete.",
  ANALYZE_FOCUSED_FAIL: "Decision extraction failed: ",
  ANALYZE_FOCUSED_NONE: "No decision-worthy content found.",
  ANALYZE_FOCUSED_PERSISTED: (persisted: number, deduped: number) =>
    `${persisted} persisted, ${deduped} deduplicated`,
  /** One decision line, e.g. "Use exitCode not exit() (rule, confidence: 0.85)" -- matches the
   *  "primary fact (parenthetical detail)" convention used by doctor/impact's table+prose output. */
  ANALYZE_DECISION_LINE: (
    nodeType: string,
    title: string,
    confidence: number,
  ) => `${title} (${nodeType}, confidence: ${confidence})`,
  ANALYZE_DECISION_CONTENT_PREFIX: "    ",

  // --escalate-to-lsp (PLAT-007 Tier B; phase1-decision-integration.md §8)
  ANALYZE_TIER_B_HEADER: "Analyze -- Tier B (LSP escalation)",
  ANALYZE_TIER_B_START: "Running the Tier B LSP escalation batch...",
  ANALYZE_TIER_B_SUCCESS: "Tier B batch complete.",
  ANALYZE_TIER_B_FAIL: "Tier B batch failed: ",
  ANALYZE_TIER_B_SUMMARY: (
    filesProcessed: number,
    edgesApplied: number,
    filesFailed: number,
    filesFailedPermanent: number,
    zeroProgressWatchdogTripped: boolean,
  ) =>
    `${filesProcessed} file(s) processed, ${edgesApplied} corrected edge(s) applied` +
    (filesFailed > 0
      ? `, ${filesFailed} file(s) left queued for the next batch`
      : "") +
    (filesFailedPermanent > 0
      ? `, ${filesFailedPermanent} file(s) permanently failed (not re-queued)`
      : "") +
    (zeroProgressWatchdogTripped
      ? ", zero-progress watchdog tripped: no next-batch re-queue remains"
      : "") +
    ".",
  ANALYZE_TIER_B_DEGRADED: (reason: string) =>
    `LSP unavailable -- AST-level edges left untouched (${reason})`,
  /** D2's mandatory pre-flight gate (phase1-decision-integration.md §8c). Shown only on an
   *  interactive terminal (`-i`/`--interactive`); a non-interactive invocation gets
   *  `ANALYZE_TIER_B_GATE_FAILED` instead (hard failure, no prompt). */
  ANALYZE_TIER_B_GATE_NOT_READY: (reason: string) =>
    `LSP prerequisites are not ready: ${reason}`,
  ANALYZE_TIER_B_GATE_PROMPT:
    "Continue with AST-only precision (skip the LSP-corrected cross-file edges this batch)?",
  ANALYZE_TIER_B_GATE_DECLINED:
    "Aborted -- install typescript-language-server as a project devDependency (or pass --fallback-ast) and try again.",
  /** Non-interactive equivalent of `ANALYZE_TIER_B_GATE_NOT_READY` -- a bare `analyze
   *  --escalate-to-lsp` (no `-i`, no `--fallback-ast`) with an unready environment now fails
   *  outright rather than silently degrading and reporting success (2026-07 C#/TS benchmark
   *  finding: a target project that was never built produced wasted, inaccurate runs because
   *  nothing surfaced this before the batch ran). The pre-push hook opts out via
   *  `--fallback-ast` and never reaches this message. */
  ANALYZE_TIER_B_GATE_FAILED: (reason: string) =>
    `LSP prerequisites are not ready: ${reason}\n` +
    `Build/compile the target project (Docuvia's Tier B relies on a working language server), ` +
    `then run 'docuvia doctor' to confirm. Pass --fallback-ast to proceed with AST-only ` +
    `precision instead.`,

  // Tier C's budgeted async LLM decision-extraction drain, folded into --escalate-to-lsp
  // (phase1-decision-integration.md §9) -- no separate header/spinner; its summary is appended
  // after Tier B's own.
  ANALYZE_TIER_C_SUMMARY: (
    processed: number,
    persisted: number,
    failed: number,
  ) =>
    `Tier C: ${processed} candidate(s) processed, ${persisted} decision(s) persisted` +
    (failed > 0 ? `, ${failed} left queued for the next run.` : "."),
  ANALYZE_TIER_C_SKIPPED: (reason: string) =>
    `Tier C: drain skipped this run (${reason}).`,

  // --agent-authored (issue #42, roadmap items 32-34): a pure data write of an AI coding agent's
  // own already-produced decisions, no LLM call. Reuses ANALYZE_FOCUSED_* for the spinner
  // header/start/success text and printFocusedResult() as-is -- the printed result shape is
  // identical to the LLM path's (analyze-result.ts's DECISION_EXTRACTION kind).
  ANALYZE_AGENT_AUTHORED_MISSING_TARGET:
    "--agent-authored requires a target path, e.g. docuvia analyze <path> --agent-authored",
  ANALYZE_AGENT_AUTHORED_MISSING_PAYLOAD:
    "No decisions payload found -- pipe JSON via stdin or pass --decisions-file=<path>",
  ANALYZE_AGENT_AUTHORED_INVALID_JSON: (err: string) =>
    `--agent-authored payload is not valid JSON: ${err}`,
  ANALYZE_AGENT_AUTHORED_INVALID_SHAPE: (err: string) =>
    `--agent-authored payload does not match the expected shape: ${err}`,

  // Issue #74: DOCUVIA_LSP_ARGS config errors. A leading '[' opts into the JSON-array form, so a
  // malformed JSON array there is a loud operator error, not something to silently re-parse.
  ANALYZE_LSP_ARGS_INVALID_JSON: (err: string) =>
    `DOCUVIA_LSP_ARGS starts with '[' but is not valid JSON -- use a JSON array of strings, or plain space-separated args: ${err}`,
  ANALYZE_LSP_ARGS_INVALID_SHAPE:
    "DOCUVIA_LSP_ARGS JSON array must contain only strings",

  // --stage (issue #42, Decision 2's two-stage stage-and-flush design §8.1) -- a variant of the
  // --agent-authored dispatch above: appends to .docuvia/pending-l3-decisions.json instead of
  // writing straight to l3_nodes.
  ANALYZE_STAGE_HEADER: "Stage Decisions",
  ANALYZE_STAGE_START: "Staging decisions from ",
  ANALYZE_STAGE_SUCCESS: "Staged.",
  ANALYZE_STAGE_SUMMARY: (staged: number) =>
    `${staged} decision(s) staged -- flushed automatically on the next commit that touches this file.`,

  // --flush-staged-l3 (issue #42 §8.2) -- the post-commit hook's drain of
  // .docuvia/pending-l3-decisions.json.
  ANALYZE_FLUSH_STAGED_L3_HEADER: "Flush Staged L3 Decisions",
  ANALYZE_FLUSH_STAGED_L3_START: "Flushing staged L3 decisions...",
  ANALYZE_FLUSH_STAGED_L3_SUCCESS: "Flush complete.",
  ANALYZE_FLUSH_STAGED_L3_DISABLED_SUCCESS:
    "commit-l3-write is disabled -- nothing flushed.",
  ANALYZE_FLUSH_STAGED_L3_SUMMARY: (
    flushed: number,
    deduped: number,
    stillPending: number,
  ) =>
    `${flushed} flushed, ${deduped} deduplicated` +
    (stillPending > 0
      ? `, ${stillPending} left staged for a future commit.`
      : "."),
  /** Issue #57: printed (as a warn) after the flush summary when at least one persist attempt hit
   *  the no-graph-to-attach path -- the actionable guidance `ANALYZE_MESSAGES.NO_GRAPH_TO_ATTACH`
   *  previously existed only in the JSONL log, leaving a manual `--flush-staged-l3` on a
   *  never-ingested graph with an unexplained "0 flushed, N left staged". */
  ANALYZE_FLUSH_STAGED_L3_NO_GRAPH_ADVICE:
    "Some staged decisions could not be attached: the knowledge graph is empty (or hasn't ingested this file yet). Run `docuvia init` first -- decisions need a graph to attach to. They stay staged and retry on the next flush.",

  // Review Command
  REVIEW_HEADER: "Review Changes",
  REVIEW_START: "Analyzing changes...",
  REVIEW_SUCCESS: "Analysis complete.",
  REVIEW_AGAINST: " against ",
  REVIEW_FAIL: "Review failed: ",
  REVIEW_FILES_CHANGED: "Files changed: ",
  REVIEW_RISK_PREFIX: "Risk level: ",
  REVIEW_WHY_HEADER: "Why (L3 decisions/context)",
  REVIEW_WHY_PREFIX: "Decision: ",

  // Impact Command
  IMPACT_HEADER: "Impact Analysis",
  IMPACT_MISSING_TARGET: "A target symbol/module name is required.",
  IMPACT_START: "Resolving blast radius for ",
  IMPACT_SUCCESS: "Resolved blast radius for ",
  IMPACT_FAIL: "Impact analysis failed: ",
  IMPACT_NOT_FOUND: "No matching node found for ",
  IMPACT_BLAST_RADIUS_HEADER: "Blast Radius",
  IMPACT_NO_DEPENDENTS: "No dependents found.",
  IMPACT_RISK_PREFIX: "Risk level: ",
  IMPACT_WHY_PREFIX: "Decision: ",
  IMPACT_COL_NAME: "Name",
  IMPACT_COL_TYPE: "Type",
  /** Labels the "why" block for one blast-radius entry -- printed below the Name/Type table
   *  (`ui.table`), since a table row can't hold prose-length L3 decision content. */
  IMPACT_ENTRY_WHY_LABEL: (name: string) => `${name}:`,
  /** typescript-cli-benchmark.md §5.3/§5.7 item 2 -- printed alongside `IMPACT_NO_DEPENDENTS` when
   *  an empty blast radius might mean "never looked at" rather than "confirmed zero" (some
   *  tracked file hasn't been Tier B-processed yet). */
  IMPACT_TIER_B_INCOMPLETE: (unprocessed: number, total: number) =>
    `${unprocessed} of ${total} tracked file(s) have never been Tier B-processed -- this may be incomplete, not confirmed zero. Run \`docuvia analyze --escalate-to-lsp --full\` to resync.`,

  // Uninstall Command
  UNINSTALL_HEADER: "Uninstall Docuvia2 Integrations",
  UNINSTALL_START: "Uninstalling Docuvia2 integrations...",
  UNINSTALL_SUCCESS_CLEAN: "Cleaned Docuvia: ",
  UNINSTALL_FAIL_CLEAN: "Failed to clean Docuvia directory: ",
  UNINSTALL_SUCCESS:
    "Docuvia2 uninstalled successfully. Backup files (.bak) were created for modified Markdown files.",
  UNINSTALL_FAIL: "Uninstall failed: ",
  UNINSTALL_HOOKS_SELECT:
    "Which AI Agent integrations would you like to uninstall?",
  UNINSTALL_KEEP_DB: "Skipping local database cleanup (--keep-db).",
  UNINSTALL_INVALID_WORKSPACE_ROOT: "Workspace root must not be empty.",
  UNINSTALL_PLATFORM_FAIL: "Failed to uninstall hooks for ",
  UNINSTALL_PLATFORM_FAIL_MID: ": ",
  UNINSTALL_PARTIAL: "Uninstall completed with failures: ",
  UNINSTALL_DB_CLEANUP_FAILURE_NAME: "local database cleanup",
  UNINSTALL_HOOKS_FAIL_LOG: "uninstallHooks failed for platform ",
  UNINSTALL_DB_CLEANUP_FAIL_LOG: "uninstall's database cleanup failed",
  UNINSTALL_FAIL_LOG: "uninstall failed",
  UNINSTALL_REMOVED_FILE_PREFIX: "Removed ",
  UNINSTALL_REMOVED_MCP_SERVER_PREFIX: "Removed MCP server from ",
  UNINSTALL_REMOVED_HOOK_FROM_SETTINGS_PREFIX:
    "Removed the Docuvia hook entry from ",
  // IFCE-002: Docuvia never writes machine-global state — print a reminder instead of editing
  // Claude Desktop's own (machine-global) config file.
  UNINSTALL_CLAUDE_MCP_MANUAL_REMINDER:
    "To finish uninstalling, manually remove the Docuvia MCP server entry from your global MCP config",

  // Uninstall Command -- git hooks removal (phase1-decision-integration.md §10a)
  UNINSTALL_GIT_HOOKS_SUCCESS: (
    postCommitRemoved: boolean,
    prePushRemoved: boolean,
  ) =>
    `Removed git hooks (post-commit: ${postCommitRemoved ? "removed" : "not present"}, pre-push: ${prePushRemoved ? "removed" : "not present"}).`,
  UNINSTALL_GIT_HOOKS_FAIL: "Failed to remove git hooks: ",
  UNINSTALL_GIT_HOOKS_FAIL_LOG: "uninstall's git hooks removal failed",
  UNINSTALL_GIT_HOOKS_FAILURE_NAME: "git hooks removal",
  UNINSTALL_KNOWLEDGE_BRANCH_DELETED:
    "Deleted the hidden docuvia-knowledge git branch.",

  // Uninstall Command -- full .docuvia/ directory removal
  UNINSTALL_DOCUVIA_DIR_REMOVED: "Removed the .docuvia/ directory.",
  UNINSTALL_DOCUVIA_DIR_FAIL: "Failed to remove the .docuvia/ directory: ",
  UNINSTALL_DOCUVIA_DIR_FAIL_LOG:
    "uninstall's .docuvia/ directory removal failed",
  UNINSTALL_DOCUVIA_DIR_FAILURE_NAME: ".docuvia/ directory removal",

  // Doctor Command
  DOCTOR_HEADER: "Docuvia Doctor Diagnostics",
  DOCTOR_START: "Running diagnostics...",
  DOCTOR_FAIL: "Doctor failed: ",
  DOCTOR_SUMMARY_PASSED: (passed: number, total: number) =>
    `Summary: ${passed}/${total} checks passed.`,
  DOCTOR_FIX_HINT:
    "Tip: run `docuvia doctor --fix` to attempt automatic repair.",

  // Doctor Report -- table column headers (`ui.table`, `doctor-report.ts`)
  DOCTOR_COL_CHECK: "Check",
  DOCTOR_COL_STATUS: "Status",
  DOCTOR_COL_MESSAGE: "Message",
  DOCTOR_COL_FIX: "Suggested Fix",

  // Doctor Report -- Status column cell labels
  DOCTOR_STATUS_PASS: "PASS",
  DOCTOR_STATUS_FAIL: "FAIL",

  // Doctor Report -- diagnostic category section headers (`ui.section`)
  DOCTOR_CATEGORY_DATABASE: "Database",
  DOCTOR_CATEGORY_GIT: "Git",
  DOCTOR_CATEGORY_GIT_HOOKS: "Git Hooks",
  DOCTOR_CATEGORY_LOGS: "Logs",
  DOCTOR_CATEGORY_TIER_B: "Tier B Batch",
  DOCTOR_CATEGORY_TIER_B_COVERAGE: "Tier B Coverage",
  DOCTOR_CATEGORY_LLM: "LLM Integration",
  DOCTOR_CATEGORY_LSP: "LSP Providers",
  DOCTOR_CATEGORY_AGENT_HOOKS: "AI Agent Hooks",
  DOCTOR_CATEGORY_OTHER: "Other",

  // Query Command
  QUERY_HEADER: "Query Knowledge Graph",
  QUERY_PROMPT_TARGET: "What would you like to query? ",
  QUERY_MISSING_TARGET: "A query target is required (pass it as an argument).",
  QUERY_MISSING_TARGET_NON_TTY: "A query target is required.",
  QUERY_START: "Querying local knowledge graph for ",
  QUERY_FOUND: "Query resolved for ",
  QUERY_FAIL: "Query failed: ",
  QUERY_CONTEXT_HEADER: "Query Results",
  QUERY_L2_PREFIX: "Module: ",
  QUERY_NO_L2: "No matching module found.",
  QUERY_L3_PREFIX: "Decision: ",
  QUERY_UNKNOWN_STATUS: "unknown",
  QUERY_INCOMING_HEADER: "Incoming (callers/dependents)",
  QUERY_OUTGOING_HEADER: "Outgoing (dependencies)",
  QUERY_COL_NAME: "Name",
  QUERY_COL_RELATION: "Relation",
  QUERY_INVALID_LIMIT:
    "Ignoring invalid --limit value (must be a positive integer): ",
  /** typescript-cli-benchmark.md §5.3/§5.7 item 2 -- printed under the Incoming/Outgoing section
   *  header when the corresponding edge list is empty but might mean "never looked at" rather
   *  than "confirmed zero" (human-readable mirror of `formatPromptOutput`'s `tier_b_status`
   *  attribute). */
  QUERY_TIER_B_INCOMING_UNPROCESSED: (unprocessed: number, total: number) =>
    `No callers found, but ${unprocessed} of ${total} tracked file(s) have never been Tier B-processed -- this may be incomplete, not confirmed zero. Run \`docuvia analyze --escalate-to-lsp --full\` to resync.`,
  QUERY_TIER_B_OUTGOING_UNPROCESSED:
    "No callees found, but this symbol's own file has never been Tier B-processed -- this may be incomplete, not confirmed zero. Run `docuvia analyze --escalate-to-lsp --full` to resync.",
  /** Human-readable mirror of the prompt-format `match_type` attribute -- tells an agent/human
   *  reading the CLI output directly whether the returned module is a confident exact match or a
   *  lower-confidence keyword/neighbor guess that should be cross-checked with Grep/Glob. */
  QUERY_MATCH_TYPE_EXACT: " (exact match)",
  QUERY_MATCH_TYPE_KEYWORD:
    " (keyword match -- verify with Grep/Glob if unsure)",
  QUERY_MATCH_TYPE_NEIGHBOR: " (neighbor match)",

  // Export Topology Command
  EXPORT_HEADER: "Export Topology",
  EXPORT_START: "Exporting topology...",
  EXPORT_SUCCESS: "Exported topology to ",
  EXPORT_FAIL: "Export failed: ",
  EXPORT_STATS_LINE: (nodes: number, links: number, groups: number) =>
    `Nodes: ${nodes}, Links: ${links}, Groups: ${groups}`,
  EXPORT_COLLAPSED_LINE: "Collapsed: yes (fewer nodes than the raw graph).",
  EXPORT_FOLDED_LINE: (foldedLinkCount: number) =>
    `Folded links: ${foldedLinkCount} more relationship(s) folded within files at this ` +
    "granularity; pass --collapse=symbol for the full symbol-level view.",
  EXPORT_HTML_PATH_LINE: (htmlPath: string) => `HTML viewer: ${htmlPath}`,

  // Snapshot Command
  SNAPSHOT_HEADER: "Snapshot Knowledge Graph",
  SNAPSHOT_START: "Packing knowledge graph snapshot...",
  SNAPSHOT_SUCCESS: "Snapshot packed onto the knowledge branch.",
  SNAPSHOT_FAIL: "Snapshot failed: ",
  SNAPSHOT_NODES_WRITTEN_LINE: (n: number) => `Nodes written: ${n}`,
  SNAPSHOT_EDGES_WRITTEN_LINE: (n: number) => `Edges written: ${n}`,
  SNAPSHOT_MARKDOWN_WRITTEN_LINE: (n: number) => `Markdown files written: ${n}`,

  // Hydrate Command
  HYDRATE_HEADER: "Hydrate Local Database",
  HYDRATE_START: "Hydrating local database from the knowledge branch...",
  HYDRATE_SUCCESS: "Hydrated local database.",
  HYDRATE_NOTHING: 'Nothing to hydrate from yet — run "docuvia init" first.',
  HYDRATE_FAIL: "Hydrate failed: ",
  HYDRATE_NODES_LOADED_LINE: (n: number) => `Nodes loaded: ${n}`,
  HYDRATE_EDGES_LOADED_LINE: (n: number) => `Edges loaded: ${n}`,
  HYDRATE_EDGES_DROPPED_LINE: (n: number) => `Dangling edges dropped: ${n}`,
  HYDRATE_REFUSED: (reason?: string) =>
    `Refused to hydrate: ${
      reason === "pending-local-write"
        ? "a knowledge-branch write from this workspace hasn't been confirmed yet"
        : "this would replace local.db's graph with a drastically smaller one"
    }. Local data was left untouched. Re-run with --force if you're sure.`,

  // Sync Knowledge Command
  SYNC_KNOWLEDGE_HEADER: "Sync Knowledge Branch",
  SYNC_KNOWLEDGE_START: "Reconciling the knowledge branch with the remote...",
  SYNC_KNOWLEDGE_NO_REMOTE:
    "No remote reachable — nothing to reconcile (offline or no origin configured).",
  SYNC_KNOWLEDGE_UP_TO_DATE:
    "Knowledge branch is already up to date with the remote.",
  SYNC_KNOWLEDGE_FAST_FORWARDED:
    "Fast-forwarded the local knowledge branch to the remote.",
  SYNC_KNOWLEDGE_PUSHED: "Pushed the local knowledge branch to the remote.",
  SYNC_KNOWLEDGE_MERGED:
    "Merged the diverged knowledge branch and pushed the result.",
  SYNC_KNOWLEDGE_FAIL: "Knowledge branch sync failed: ",

  // Hooks Command (issue #42 §7.4) -- docuvia hooks list/enable/disable/check
  HOOKS_HEADER: "Docuvia Hooks",
  HOOKS_COL_NAME: "Hook",
  HOOKS_COL_STATUS: "Status",
  HOOKS_STATUS_ENABLED: "enabled",
  HOOKS_STATUS_DISABLED: "disabled",
  HOOKS_LIST_FAIL: "Failed to list hooks: ",
  HOOKS_SET_FAIL: "Failed to update hook: ",
  HOOKS_ENABLED: (hookName: string) => `Enabled hook: ${hookName}`,
  HOOKS_DISABLED: (hookName: string) => `Disabled hook: ${hookName}`,
  HOOKS_INVALID_NAME: (hookName: string | undefined, validNames: string[]) =>
    `Unknown hook '${hookName ?? ""}' -- valid names: ${validNames.join(", ")}`,
  HOOKS_UNKNOWN_SUBCOMMAND: (subcommand: string | undefined) =>
    `Unknown 'docuvia hooks' subcommand '${subcommand ?? ""}' -- expected list, enable, disable, or check`,
};
