#!/usr/bin/env node
import * as dotenv from "dotenv";
import process from "process";
import pc from "picocolors";

import { initCommand } from "./commands/init.js";
import { runMcpServer } from "./mcp/server.js";

import { ui } from "./ui/wizard.js";
import {
  CLI_COMMANDS,
  CLI_COMMAND_DESCRIPTIONS,
  CliCommand,
  getUsageText,
} from "./constants/cli-commands.js";
import { CLI_FLAGS } from "./constants/cli-flags.js";
import { UI_MESSAGES } from "./constants/ui-messages.js";
import { ArgParser } from "./utils/arg-parser.js";

dotenv.config();

function printUsage() {
  console.error(getUsageText());
}

interface CommandContext {
  parser: ArgParser;
  isInteractive: boolean;
  workspaceRoot: string;
}

async function handleInit(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([CLI_FLAGS.GLOBAL]);
  const allowGlobalMcpConfig = ctx.parser.hasFlag(CLI_FLAGS.GLOBAL);
  await initCommand(ctx.workspaceRoot, allowGlobalMcpConfig);
}

async function handleMcp(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  await runMcpServer();
}

/**
 * Only `init`/`mcp` are wired for this milestone. Structured so each later command
 * (`analyze`, `status`, `clean`, `review`, `sync`, `snapshot`, `query`, `export`,
 * `impact`) is added as one more `handleX` function + one more `COMMAND_HANDLERS` entry,
 * without restructuring dispatch (per the migration plan's step 8).
 */
const COMMAND_HANDLERS: Record<CliCommand, (ctx: CommandContext) => Promise<void>> = {
  [CLI_COMMANDS.INIT]: handleInit,
  [CLI_COMMANDS.MCP]: handleMcp,
};

async function resolveCommand(): Promise<{
  command: CliCommand | undefined;
  isInteractive: boolean;
}> {
  const command = process.argv[2] as CliCommand | undefined;
  if (command) {
    return { command, isInteractive: false };
  }

  if (!process.stdin.isTTY) {
    printUsage();
    process.exit(1);
  }

  ui.header(UI_MESSAGES.CLI_HEADER);
  const choices = Object.values(CLI_COMMANDS)
    // Hide MCP from the interactive menu — it's an internal/CI-facing entry point.
    .filter((cmd) => cmd !== CLI_COMMANDS.MCP)
    .map((cmd) => ({
      name: cmd,
      value: cmd,
      description: CLI_COMMAND_DESCRIPTIONS[cmd],
    }));

  const selected = (await ui.askSelect(UI_MESSAGES.CLI_PROMPT_ACTION, choices)) as CliCommand;
  return { command: selected, isInteractive: true };
}

async function main() {
  const rawArgs = process.argv.slice(3);
  const parser = new ArgParser(rawArgs);
  const workspaceRoot = process.cwd();
  const { command, isInteractive } = await resolveCommand();
  const handler = command ? COMMAND_HANDLERS[command] : undefined;

  try {
    if (!handler) {
      ui.error(UI_MESSAGES.CLI_UNKNOWN_COMMAND + command);
      printUsage();
      process.exit(1);
      return;
    }

    await handler({ parser, isInteractive, workspaceRoot });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    ui.error(UI_MESSAGES.CLI_FATAL_ERROR + msg);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    pc.red(UI_MESSAGES.CLI_FATAL_ERROR + (err instanceof Error ? err.message : String(err)))
  );
  process.exit(1);
});
