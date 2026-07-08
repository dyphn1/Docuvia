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

export function getUsageText(): string {
  return `Usage:
  docuvia ${CLI_COMMANDS.INIT.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.INIT]}
  docuvia ${(CLI_COMMANDS.ANALYZE + " [path] [--deep]").padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.ANALYZE]}
  docuvia ${(CLI_COMMANDS.QUERY + " <target> [--local]").padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.QUERY]}
  docuvia ${(CLI_COMMANDS.REVIEW + " [--baseRef=...]").padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.REVIEW]}
  docuvia ${CLI_COMMANDS.SNAPSHOT.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.SNAPSHOT]}
  docuvia ${(CLI_COMMANDS.SYNC + " <project_id> [sha]").padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.SYNC]}
  docuvia ${CLI_COMMANDS.STATUS.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.STATUS]}
  docuvia ${CLI_COMMANDS.CLEAN.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.CLEAN]}
  docuvia ${(CLI_COMMANDS.EXPORT + " --topology [--json]").padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.EXPORT]}
  docuvia ${CLI_COMMANDS.MCP.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.MCP]}
`;
}
