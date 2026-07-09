export const UI_MESSAGES = {
  // General CLI
  CLI_HEADER: "Docuvia Knowledge Graph",
  CLI_PROMPT_ACTION: "What would you like to do?",
  CLI_UNKNOWN_COMMAND: "Unknown command: ",
  CLI_FATAL_ERROR: "Fatal error: ",
  CLI_EXPORT_USAGE:
    "Usage: docuvia export --topology [--json] [--out=DIR] [--collapse=file|symbol|auto]",

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

  // Analyze Command
  ANALYZE_HEADER: "Analyze Workspace",
  ANALYZE_START: "Initializing analyzer...",
  ANALYZE_SUCCESS: "Analysis complete",
  ANALYZE_FAIL: "Analysis failed: ",
  ANALYZE_FOCUSED_HEADER: "Analyze (Focused Extraction)",
  ANALYZE_FOCUSED_START: "Extracting knowledge from ",
  ANALYZE_FOCUSED_SUCCESS: "Extraction complete",
  ANALYZE_FOCUSED_FAIL: "Extraction failed: ",
  ANALYZE_PROJECT_TYPE: "Project Type: ",
  ANALYZE_SUGGESTED_TAGS: "Suggested Tags: ",
  ANALYZE_NONE: "None",

  // Clean Command
  CLEAN_HEADER: "Clean Knowledge Graph",
  CLEAN_CONFIRM: "This will wipe your local .docuvia/ database. Proceed?",
  CLEAN_ABORTED: "Clean aborted.",
  CLEAN_START: "Wiping local index...",
  CLEAN_SUCCESS: "Local index wiped successfully.",
  CLEAN_FAIL: "Clean failed: ",

  // Export Command
  EXPORT_START: "Exporting topology...",
  EXPORT_SUCCESS: "Topology exported to ",
  EXPORT_FAIL: "Export failed: ",

  // Review Command
  REVIEW_HEADER: "Review Changes",
  REVIEW_START: "Detecting changes and computing risk score...",
  REVIEW_SUCCESS: "Changes analyzed",
  REVIEW_AGAINST: " against ",
  REVIEW_FAIL: "Review failed: ",

  // Query Command
  QUERY_HEADER: "Query Knowledge Graph",
  QUERY_PROMPT_TARGET: "Enter search target (e.g., function name, concept):",
  QUERY_MISSING_TARGET: "Missing required argument: <target>",
  QUERY_MISSING_TARGET_NON_TTY: "Query target is required.",
  QUERY_START: "Querying for ",
  QUERY_NO_RESULTS: "No matching nodes found.",
  QUERY_FAIL: "Query Error: ",
  QUERY_FOUND: "Found results for ",
  QUERY_CONTEXT_HEADER: "Docuvia Context",
  QUERY_L2_PREFIX: "[L2 Module]",
  QUERY_NO_L2: "No matching L2 module found. Showing global results.",
  QUERY_L3_PREFIX: "[Decision]",
  QUERY_UNKNOWN_STATUS: "unknown",

  // Snapshot Command
  SNAPSHOT_START: "Starting local AST snapshot...",
  SNAPSHOT_DISCOVER: "Discovering source files...",
  SNAPSHOT_PARSE: "Parsing files...",
  SNAPSHOT_MAP: "Mapping AST events...",
  SNAPSHOT_PERSIST: "Persisting git-native structure...",
  SNAPSHOT_PACK: "Packing directory to docuvia-knowledge branch...",
  SNAPSHOT_SUCCESS: "Successfully packed local knowledge to branch.",
  SNAPSHOT_FAIL: "Local snapshot (packing) failed: ",

  // Status Command
  STATUS_HEADER: "Docuvia Index Status",
  STATUS_START: "Checking index status...",
  STATUS_SUCCESS: "Index Status Retrieved",
  STATUS_PROJECTS: "Projects: ",
  STATUS_L2_NODES: "L2 Nodes: ",
  STATUS_L3_DECISIONS: "L3 Decisions: ",
  STATUS_FAIL: "Failed to read index: ",

  // Sync Command
  SYNC_MISSING_PROJECT_ID: "Missing required argument: <project_id>",
  SYNC_NO_PROJECT_ID_PROVIDED: "No Project ID provided.",
  SYNC_PROJECT_ID_REQUIRED: "Project ID is required.",
  SYNC_PROMPT_PROJECT_ID: "Enter the Docuvia Project ID to sync with:",
  SYNC_MISSING_ENV: "DOCUVIA_API_URL or MCP_PAT is missing in the environment.",
  SYNC_SKIP: "Skipping remote sync. Please set these variables in your .env file or environment.",
  SYNC_START: "Syncing workspace to remote project ",
  SYNC_SUCCESS: "Remote sync completed successfully.",
  SYNC_FAIL: "Sync failed: ",
};
