/**
 * Trimmed to just the `INIT_*`/general-CLI/filesystem-helper messages `init` actually uses
 * (per the migration plan's step 8) — old Docuvia's ~100+ message file also carried
 * `ANALYZE_*`/`QUERY_*`/`IMPACT_*`/`REVIEW_*`/`SNAPSHOT_*`/`STATUS_*`/`SYNC_*`/`CLEAN_*`/
 * `EXPORT_*` for commands that don't exist in this milestone. Port the rest in alongside
 * each command as it's rebuilt.
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
};
