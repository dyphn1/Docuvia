/**
 * Only `init` and `mcp` are wired for this milestone (per the migration plan's step 8-9)
 * — the dispatch shape (`CLI_COMMANDS`/`CLI_COMMAND_DESCRIPTIONS`/`getUsageText`/
 * `COMMAND_HANDLERS` in `cli.ts`) is intentionally kept general so `analyze`, `status`,
 * `clean`, `review`, `sync`, `snapshot`, `query`, `export`, `impact` can each be added as
 * one more entry per command in a later pass, without restructuring dispatch.
 */
export const CLI_COMMANDS = {
  INIT: "init",
  MCP: "mcp",
} as const;

export type CliCommand = (typeof CLI_COMMANDS)[keyof typeof CLI_COMMANDS];

export const CLI_COMMAND_DESCRIPTIONS: Record<CliCommand, string> = {
  [CLI_COMMANDS.INIT]: "Initialize local project and agent hooks",
  [CLI_COMMANDS.MCP]: "Start the local MCP stdio server",
};

export function getUsageText(): string {
  return [
    "Usage:",
    `  docuvia ${CLI_COMMANDS.INIT.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.INIT]}`,
    `  docuvia ${CLI_COMMANDS.MCP.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.MCP]}`,
  ].join("\n");
}
