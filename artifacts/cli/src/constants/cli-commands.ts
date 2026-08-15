import { CLI_FLAGS } from "./cli-flags.js";

/**
 * `init`/`mcp`/`clean`/`status`/`publish`/`analyze`/`review`/`impact`/`query`/`export-topology`/
 * `snapshot` are wired so far — the dispatch shape (`CLI_COMMANDS`/`CLI_COMMAND_DESCRIPTIONS`/
 * `getUsageText`/`COMMAND_HANDLERS` in `cli.ts`) is intentionally kept general so future
 * commands can be added as one more entry in a later pass, without restructuring dispatch.
 */
export const CLI_COMMANDS = {
  INIT: "init",
  MCP: "mcp",
  CLEAN: "clean",
  STATUS: "status",
  PUBLISH: "publish",
  ANALYZE: "analyze",
  REVIEW: "review",
  IMPACT: "impact",
  QUERY: "query",
  EXPORT_TOPOLOGY: "export-topology",
  SNAPSHOT: "snapshot",
  HYDRATE: "hydrate",
  SYNC_KNOWLEDGE: "sync-knowledge",
  UNINSTALL: "uninstall",
  DOCTOR: "doctor",
} as const;

export type CliCommand = (typeof CLI_COMMANDS)[keyof typeof CLI_COMMANDS];

export const CLI_COMMAND_DESCRIPTIONS: Record<CliCommand, string> = {
  [CLI_COMMANDS.INIT]: "Initialize local project and agent hooks",
  [CLI_COMMANDS.MCP]: "Start the local MCP stdio server",
  [CLI_COMMANDS.CLEAN]: "Wipe the local Docuvia SQLite database",
  [CLI_COMMANDS.STATUS]: "Show local knowledge graph row counts",
  [CLI_COMMANDS.PUBLISH]:
    "Push locally-generated decisions to the remote backend",
  [CLI_COMMANDS.ANALYZE]:
    "Detect project type/tags and run full AST ingestion into the knowledge graph",
  [CLI_COMMANDS.REVIEW]: "Detect changed-file blast radius and risk level",
  [CLI_COMMANDS.IMPACT]:
    "Show the blast radius/risk level for a symbol or module",
  [CLI_COMMANDS.QUERY]:
    "Query the local knowledge graph (keyword + structural search)",
  [CLI_COMMANDS.EXPORT_TOPOLOGY]:
    "Export the knowledge graph as topology.json/topology.html",
  [CLI_COMMANDS.SNAPSHOT]:
    "Pack the local knowledge graph onto the hidden knowledge branch",
  [CLI_COMMANDS.HYDRATE]:
    "Rebuild the local database from the hidden knowledge branch",
  [CLI_COMMANDS.SYNC_KNOWLEDGE]:
    "Reconcile the hidden knowledge branch with the remote (fetch/merge/push)",
  [CLI_COMMANDS.UNINSTALL]: "Uninstall Docuvia2 integrations and local DB",
  [CLI_COMMANDS.DOCTOR]: "Run diagnostic checks on Docuvia2 setup",
};

/**
 * Single source of truth for each command's own flags — shared by `cli.ts`'s
 * `checkUnknownFlags()` calls and `getCommandUsageText()` below, so the two can never drift
 * apart the way a duplicated list would.
 */
export const CLI_COMMAND_FLAGS: Record<CliCommand, string[]> = {
  [CLI_COMMANDS.INIT]: [
    CLI_FLAGS.PLATFORM,
    CLI_FLAGS.INTERACTIVE,
    CLI_FLAGS.INTERACTIVE_SHORT,
  ],
  [CLI_COMMANDS.MCP]: [],
  [CLI_COMMANDS.CLEAN]: [CLI_FLAGS.INTERACTIVE, CLI_FLAGS.INTERACTIVE_SHORT],
  [CLI_COMMANDS.STATUS]: [],
  [CLI_COMMANDS.PUBLISH]: [
    CLI_FLAGS.COMMIT_SHA,
    CLI_FLAGS.INTERACTIVE,
    CLI_FLAGS.INTERACTIVE_SHORT,
  ],
  [CLI_COMMANDS.ANALYZE]: [
    CLI_FLAGS.ESCALATE_TO_LSP,
    CLI_FLAGS.FALLBACK_AST,
    CLI_FLAGS.LSP_TIMEOUT,
    CLI_FLAGS.LSP_PROCESSES,
    CLI_FLAGS.FULL,
    CLI_FLAGS.INTERACTIVE,
    CLI_FLAGS.INTERACTIVE_SHORT,
    CLI_FLAGS.FORCE,
    CLI_FLAGS.FORCE_SHORT,
    CLI_FLAGS.AGENT_AUTHORED,
    CLI_FLAGS.DECISIONS_FILE,
  ],
  [CLI_COMMANDS.REVIEW]: [],
  [CLI_COMMANDS.IMPACT]: [],
  [CLI_COMMANDS.QUERY]: [
    CLI_FLAGS.FORMAT,
    CLI_FLAGS.LIMIT,
    CLI_FLAGS.INTERACTIVE,
    CLI_FLAGS.INTERACTIVE_SHORT,
  ],
  [CLI_COMMANDS.EXPORT_TOPOLOGY]: [
    CLI_FLAGS.OUT,
    CLI_FLAGS.JSON_ONLY,
    CLI_FLAGS.COLLAPSE,
  ],
  [CLI_COMMANDS.SNAPSHOT]: [],
  [CLI_COMMANDS.HYDRATE]: [CLI_FLAGS.FORCE, CLI_FLAGS.FORCE_SHORT],
  [CLI_COMMANDS.SYNC_KNOWLEDGE]: [],
  [CLI_COMMANDS.UNINSTALL]: [
    CLI_FLAGS.PLATFORM,
    CLI_FLAGS.KEEP_DB,
    CLI_FLAGS.INTERACTIVE,
    CLI_FLAGS.INTERACTIVE_SHORT,
  ],
  [CLI_COMMANDS.DOCTOR]: [
    CLI_FLAGS.SKIP_DB,
    CLI_FLAGS.SKIP_GIT,
    CLI_FLAGS.SKIP_HOOKS,
    CLI_FLAGS.SKIP_LOGS,
    CLI_FLAGS.SKIP_LSP,
    CLI_FLAGS.SKIP_LLM,
    CLI_FLAGS.FIX,
  ],
};

export function getUsageText(): string {
  return [
    "Usage:",
    ...Object.values(CLI_COMMANDS).map(
      (cmd) => `  docuvia ${cmd.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[cmd]}`,
    ),
    "",
    "Options:",
    "  docuvia --help, -h                        # Show this help",
    "  docuvia --version, -v                     # Show the installed version",
    "  docuvia <command> --help, -h              # Show flags for a specific command",
    "  docuvia -i, --interactive                 # Launch the wizard menu (requires a real terminal)",
    "  docuvia <command> -i, --interactive       # Allow that command to prompt instead of using its non-interactive default",
  ].join("\n");
}

/** `docuvia <command> --help`/`-h` — short per-command help, sourced from the same
 *  `CLI_COMMAND_DESCRIPTIONS`/`CLI_COMMAND_FLAGS` data `getUsageText()` and `checkUnknownFlags()`
 *  already use, so it can never list a flag a command doesn't actually accept. */
export function getCommandUsageText(command: CliCommand): string {
  const flags = CLI_COMMAND_FLAGS[command];
  const lines = [
    `docuvia ${command}`,
    `  ${CLI_COMMAND_DESCRIPTIONS[command]}`,
  ];
  if (flags.length > 0) {
    lines.push("", "Flags:", ...flags.map((flag) => `  ${flag}`));
  }
  return lines.join("\n");
}
