/**
 * `init`/`mcp`/`clean`/`status`/`sync`/`analyze`/`review`/`impact`/`query`/`export-topology`/
 * `snapshot` are wired so far — the dispatch shape (`CLI_COMMANDS`/`CLI_COMMAND_DESCRIPTIONS`/
 * `getUsageText`/`COMMAND_HANDLERS` in `cli.ts`) is intentionally kept general so future
 * commands can be added as one more entry in a later pass, without restructuring dispatch.
 */
export const CLI_COMMANDS = {
  INIT: "init",
  MCP: "mcp",
  CLEAN: "clean",
  STATUS: "status",
  SYNC: "sync",
  ANALYZE: "analyze",
  REVIEW: "review",
  IMPACT: "impact",
  QUERY: "query",
  EXPORT_TOPOLOGY: "export-topology",
  SNAPSHOT: "snapshot",
  HYDRATE: "hydrate",
  SYNC_KNOWLEDGE: "sync-knowledge",
} as const;

export type CliCommand = (typeof CLI_COMMANDS)[keyof typeof CLI_COMMANDS];

export const CLI_COMMAND_DESCRIPTIONS: Record<CliCommand, string> = {
  [CLI_COMMANDS.INIT]: "Initialize local project and agent hooks",
  [CLI_COMMANDS.MCP]: "Start the local MCP stdio server",
  [CLI_COMMANDS.CLEAN]: "Wipe the local Docuvia SQLite database",
  [CLI_COMMANDS.STATUS]: "Show local knowledge graph row counts",
  [CLI_COMMANDS.SYNC]: "Push locally-generated decisions to the remote backend",
  [CLI_COMMANDS.ANALYZE]: "Detect project type/tags from config files",
  [CLI_COMMANDS.REVIEW]: "Detect changed-file blast radius and risk level",
  [CLI_COMMANDS.IMPACT]: "Show the blast radius/risk level for a symbol or module",
  [CLI_COMMANDS.QUERY]: "Query the local knowledge graph (keyword + structural search)",
  [CLI_COMMANDS.EXPORT_TOPOLOGY]: "Export the knowledge graph as topology.json/topology.html",
  [CLI_COMMANDS.SNAPSHOT]: "Pack the local knowledge graph onto the hidden knowledge branch",
  [CLI_COMMANDS.HYDRATE]: "Rebuild the local database from the hidden knowledge branch",
  [CLI_COMMANDS.SYNC_KNOWLEDGE]: "Reconcile the hidden knowledge branch with the remote (fetch/merge/push)",
};

export function getUsageText(): string {
  return [
    "Usage:",
    ...Object.values(CLI_COMMANDS).map(
      (cmd) => `  docuvia ${cmd.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[cmd]}`
    ),
  ].join("\n");
}
