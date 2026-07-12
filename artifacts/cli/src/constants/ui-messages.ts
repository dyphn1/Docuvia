/**
 * `INIT_*`/general-CLI/filesystem-helper messages, plus `CLEAN_*`/`STATUS_*`/`SYNC_*`/`ANALYZE_*`
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

  // Init Command
  INIT_HEADER: "Initialize Docuvia",
  INIT_CONFIRM: "Initialize Docuvia in this workspace?",
  INIT_ABORTED: "Initialization aborted.",
  INIT_START: "Starting initialization...",
  INIT_FAILED: "Initialization failed: ",
  INIT_AGENT_HOOKS: "Initializing AI Agent integrations for Docuvia...",

  // Init Agent Hooks
  INIT_HOOKS_CONFIG_MCP: "Configuring MCP Servers...",
  INIT_HOOKS_REGISTERED_MCP: "Registered MCP server in: ",
  INIT_HOOKS_FAIL_CURSOR_MCP: "Could not configure Cursor MCP: ",
  INIT_HOOKS_FAIL_CLAUDE_MCP: "Could not configure Claude Desktop MCP: ",
  INIT_HOOKS_SUCCESS: "Docuvia Agent Integrations successfully installed!",
  INIT_HOOKS_SUPPORTED:
    "Supported platforms: Claude Code, Cursor, GitHub Copilot, Windsurf, Zed, Continue, OpenCode, Gemini CLI.",
  INIT_HOOKS_FAIL: "Failed to initialize agent integrations: ",
  INIT_HOOKS_SELECT: "Which AI Agent integrations would you like to install?",
  INIT_HOOKS_NONE_SELECTED: "No platforms selected. Skipping agent integrations.",
  INIT_GLOBAL_MCP_CONFIRM:
    "Register Docuvia's MCP server in the machine-global Claude Desktop config (affects every project, not just this repo)?",
  INIT_GLOBAL_MCP_SKIPPED:
    "Skipped global Claude Desktop MCP registration. Re-run with --global to enable, or add it manually — see docs/gitbook/packages/cli.md.",

  // Filesystem write helper (writeOrAppend)
  FS_APPENDED: "Appended instructions to: ",
  FS_ALREADY_EXISTS: "Instructions already exist in: ",
  FS_CREATED: "Created: ",

  // Clean Command
  CLEAN_HEADER: "Clean Docuvia Database",
  CLEAN_CONFIRM: "This will permanently delete the local Docuvia database. Continue?",
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

  // Sync Command
  SYNC_MISSING_PROJECT_ID: "Project ID is required when not running interactively.",
  SYNC_NO_PROJECT_ID_PROVIDED: "No project ID provided.",
  SYNC_PROMPT_PROJECT_ID: "Enter the project ID to sync to: ",
  SYNC_PROJECT_ID_REQUIRED: "Project ID is required.",
  SYNC_MISSING_ENV: "DOCUVIA_API_URL and/or MCP_PAT are not set.",
  SYNC_SKIP: "Skipping sync.",
  SYNC_START: "Starting sync for project ",
  SYNC_SUCCESS: "Sync complete.",
  SYNC_FAIL: "Sync failed: ",

  // Analyze Command
  ANALYZE_HEADER: "Analyze Project",
  ANALYZE_START: "Analyzing project...",
  ANALYZE_SUCCESS: "Analysis complete.",
  ANALYZE_FAIL: "Analysis failed: ",
  ANALYZE_PROJECT_TYPE: "Project Type: ",
  ANALYZE_SUGGESTED_TAGS: "Suggested Tags: ",
  ANALYZE_NONE: "none",
  ANALYZE_TARGET_PATH_NOT_SUPPORTED:
    "Analyzing a specific file/path (decision extraction) is not yet supported in this build. Run `docuvia analyze` with no path for a project-wide config scan.",

  // Review Command
  REVIEW_HEADER: "Review Changes",
  REVIEW_START: "Analyzing changes...",
  REVIEW_SUCCESS: "Analysis complete.",
  REVIEW_AGAINST: " against ",
  REVIEW_FAIL: "Review failed: ",

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

  // Export Topology Command
  EXPORT_START: "Exporting topology...",
  EXPORT_SUCCESS: "Exported topology to ",
  EXPORT_FAIL: "Export failed: ",

  // Snapshot Command
  SNAPSHOT_START: "Packing knowledge graph snapshot...",
  SNAPSHOT_SUCCESS: "Snapshot packed onto the knowledge branch. ",
  SNAPSHOT_FAIL: "Snapshot failed: ",

  // Hydrate Command
  HYDRATE_START: "Hydrating local database from the knowledge branch...",
  HYDRATE_SUCCESS: "Hydrated local database. ",
  HYDRATE_NOTHING: "Nothing to hydrate from yet — run \"docuvia init\" first.",
  HYDRATE_FAIL: "Hydrate failed: ",

  // Sync Knowledge Command
  SYNC_KNOWLEDGE_START: "Reconciling the knowledge branch with the remote...",
  SYNC_KNOWLEDGE_NO_REMOTE: "No remote reachable — nothing to reconcile (offline or no origin configured).",
  SYNC_KNOWLEDGE_UP_TO_DATE: "Knowledge branch is already up to date with the remote.",
  SYNC_KNOWLEDGE_FAST_FORWARDED: "Fast-forwarded the local knowledge branch to the remote.",
  SYNC_KNOWLEDGE_PUSHED: "Pushed the local knowledge branch to the remote.",
  SYNC_KNOWLEDGE_MERGED: "Merged the diverged knowledge branch and pushed the result.",
  SYNC_KNOWLEDGE_FAIL: "Knowledge branch sync failed: ",
};
