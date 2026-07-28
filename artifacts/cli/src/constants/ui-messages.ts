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
  STATUS_PROJECTS: "Projects: ",
  STATUS_L2_NODES: "L2 Nodes: ",
  STATUS_L3_DECISIONS: "L3 Decisions: ",

  // Publish Command (IFCE-005: renamed from `sync`)
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
  ANALYZE_DECISION_PREFIX: "[",
  ANALYZE_DECISION_MID: "] ",
  ANALYZE_DECISION_CONFIDENCE_PREFIX: " (confidence: ",
  ANALYZE_DECISION_CONFIDENCE_SUFFIX: ")",
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
  ) =>
    `${filesProcessed} file(s) processed, ${edgesApplied} corrected edge(s) applied` +
    (filesFailed > 0
      ? `, ${filesFailed} file(s) left queued for the next batch.`
      : "."),
  ANALYZE_TIER_B_DEGRADED: (reason: string) =>
    `LSP unavailable -- AST-level edges left untouched (${reason})`,
  /** D2's mandatory pre-flight gate for an interactive/manual invocation
   *  (phase1-decision-integration.md §8c) -- never shown for a non-interactive (pre-push hook)
   *  invocation, which always degrades honestly without asking. */
  ANALYZE_TIER_B_GATE_NOT_READY: (reason: string) =>
    `LSP prerequisites are not ready: ${reason}`,
  ANALYZE_TIER_B_GATE_PROMPT:
    "Continue with AST-only precision (skip the LSP-corrected cross-file edges this batch)?",
  ANALYZE_TIER_B_GATE_DECLINED:
    "Aborted -- install typescript-language-server as a project devDependency (or pass --fallback-ast) and try again.",

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
  DOCTOR_DB_NOT_FOUND: "Local database not found at ",
  DOCTOR_DB_NO_RUNNER: "DiagnosticRunnerDb not registered",
  DOCTOR_GIT_NO_RUNNER: "DiagnosticRunnerGit not registered",
  DOCTOR_GIT_FAIL: "Git remote reachability check failed: ",
  DOCTOR_ALL_PASSED: "\nAll diagnostics passed.",
  DOCTOR_SOME_FAILED: "\nSome diagnostics failed.",
  DOCTOR_FAIL: "Doctor failed: ",
  DOCTOR_DIAGNOSTIC_PREFIX: "[",
  DOCTOR_DIAGNOSTIC_SUFFIX: "] ",
  DOCTOR_DETAILS_PREFIX: "    ",
  DOCTOR_SUGGESTION_PREFIX: "    💡 Fix: ",

  // Doctor Log Analysis
  DOCTOR_LOGS_HEADER: "Checking Log Files...",
  DOCTOR_LOGS_ERRORS_FOUND: "Errors found in logs:",
  DOCTOR_LOGS_NO_ERRORS: "No critical errors found in recent logs.",

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
  QUERY_INVALID_LIMIT:
    "Ignoring invalid --limit value (must be a positive integer): ",

  // Export Topology Command
  EXPORT_START: "Exporting topology...",
  EXPORT_SUCCESS: "Exported topology to ",
  EXPORT_FAIL: "Export failed: ",
  EXPORT_STATS_PREFIX: " (",
  EXPORT_STATS_NODES: " nodes, ",
  EXPORT_STATS_LINKS: " links, ",
  EXPORT_STATS_GROUPS: " groups",
  EXPORT_STATS_COLLAPSED: ", collapsed",
  EXPORT_STATS_SUFFIX: ")",
  EXPORT_STATS_FOLDED_PREFIX: " — ",
  EXPORT_STATS_FOLDED_SUFFIX:
    " more relationship(s) folded within files at this granularity; pass --collapse=symbol for the full symbol-level view",
  EXPORT_HTML_SEPARATOR: " and ",

  // Snapshot Command
  SNAPSHOT_START: "Packing knowledge graph snapshot...",
  SNAPSHOT_SUCCESS: "Snapshot packed onto the knowledge branch. ",
  SNAPSHOT_FAIL: "Snapshot failed: ",
  SNAPSHOT_NODES_WRITTEN: " nodes, ",
  SNAPSHOT_EDGES_WRITTEN: " edges, ",
  SNAPSHOT_MARKDOWN_WRITTEN: " markdown files",

  // Hydrate Command
  HYDRATE_START: "Hydrating local database from the knowledge branch...",
  HYDRATE_SUCCESS: "Hydrated local database. ",
  HYDRATE_NOTHING: 'Nothing to hydrate from yet — run "docuvia init" first.',
  HYDRATE_FAIL: "Hydrate failed: ",
  HYDRATE_NODES_LOADED: " nodes, ",
  HYDRATE_EDGES_LOADED: " edges",
  HYDRATE_EDGES_DROPPED_PREFIX: ", ",
  HYDRATE_EDGES_DROPPED_SUFFIX: " dangling edge(s) dropped",

  // Sync Knowledge Command
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
};
