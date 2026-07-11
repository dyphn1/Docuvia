/**
 * Trimmed to the messages the `docuvia_init` tool actually uses (per the migration plan's
 * step 9). Old Docuvia's file also carried messages for `context`/`impact`/`query`/
 * `analyze`/`extract`/`clean`/`status`/`detectChanges`/`sync` tools that don't exist in
 * this milestone. Port the rest in alongside each tool as it's rebuilt.
 */
export const MCP_TOOL_MESSAGES = {
  ERROR_INITIALIZING: "Error initializing Docuvia",
} as const;
