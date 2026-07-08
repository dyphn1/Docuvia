export const CLI_COMMANDS = {
  INIT: "init",
  ANALYZE: "analyze",
  QUERY: "query",
  REVIEW: "review",
  SNAPSHOT: "snapshot",
  SYNC: "sync",
  STATUS: "status",
  CLEAN: "clean",
  EXPORT: "export",
  MCP: "mcp",
} as const;

export type CliCommand = (typeof CLI_COMMANDS)[keyof typeof CLI_COMMANDS];

export const CLI_COMMAND_DESCRIPTIONS: Record<CliCommand, string> = {
  [CLI_COMMANDS.INIT]: "Initialize local project and agent hooks",
  [CLI_COMMANDS.ANALYZE]: "Analyze project or specific file",
  [CLI_COMMANDS.QUERY]: "Query the knowledge graph",
  [CLI_COMMANDS.REVIEW]: "Detect structural changes and risk score",
  [CLI_COMMANDS.SNAPSHOT]: "Pack local knowledge to orphan branch",
  [CLI_COMMANDS.SYNC]: "Sync local changes to server",
  [CLI_COMMANDS.STATUS]: "Check index database health",
  [CLI_COMMANDS.CLEAN]: "Wipe local.db knowledge graph",
  [CLI_COMMANDS.EXPORT]: "Export topology.json + offline topology.html",
  [CLI_COMMANDS.MCP]: "Start the local MCP stdio server",
};
