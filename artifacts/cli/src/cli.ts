#!/usr/bin/env node
import * as dotenv from "dotenv";
import process from "process";
import pc from "picocolors";

import { initCommand } from "./commands/init.js";
import { queryCommand } from "./commands/query.js";
import { analyzeCommand } from "./commands/analyze.js";
import { statusCommand } from "./commands/status.js";
import { cleanCommand } from "./commands/clean.js";
import { reviewCommand } from "./commands/review.js";
import { syncCommand } from "./commands/sync.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { exportTopologyCommand } from "./commands/export-topology.js";
import { runMcpServer } from "./mcp/server.js";

import { ui } from "./ui/wizard.js";
import {
  CLI_COMMANDS,
  CLI_COMMAND_DESCRIPTIONS,
  CliCommand,
  getUsageText,
} from "./constants/cli-commands.js";
import { CLI_FLAGS, CLI_FORMAT_OPTIONS, CLI_COLLAPSE_OPTIONS } from "./constants/cli-flags.js";
import { UI_MESSAGES } from "./constants/ui-messages.js";
import { ArgParser } from "./utils/arg-parser.js";
import { setupDI } from "./di.js";
import { TopologyCollapseMode } from "@workspace/core";

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

async function handleAnalyze(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([CLI_FLAGS.DEEP]);

  let deep = ctx.parser.hasFlag(CLI_FLAGS.DEEP);
  const targetFile = ctx.parser.getPositional(0);

  if (ctx.isInteractive && !deep && !targetFile) {
    deep = await ui.askConfirm(UI_MESSAGES.CLI_DEEP_SCAN_PROMPT, false);
  }

  await analyzeCommand(targetFile, deep, ctx.workspaceRoot);
}

async function handleStatus(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  await statusCommand(ctx.workspaceRoot);
}

async function handleClean(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  await cleanCommand(ctx.workspaceRoot);
}

async function handleReview(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([CLI_FLAGS.BASE_REF]);
  const baseRef = ctx.parser.getFlagValue(CLI_FLAGS.BASE_REF);
  await reviewCommand(baseRef, ctx.workspaceRoot);
}

async function handleSnapshot(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  await snapshotCommand(ctx.workspaceRoot);
}

async function handleSync(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  const projectId = ctx.parser.getPositional(0);
  const commitSha = ctx.parser.getPositional(1);
  await syncCommand({ projectId, commitSha }, ctx.workspaceRoot);
}

const COLLAPSE_CHOICE_NONE_VALUE = "none";

async function askExportCollapseMode(): Promise<string | undefined> {
  const collapseChoices = [
    { name: UI_MESSAGES.CLI_COLLAPSE_CHOICE_NONE, value: COLLAPSE_CHOICE_NONE_VALUE },
    { name: UI_MESSAGES.CLI_COLLAPSE_CHOICE_FILE, value: CLI_COLLAPSE_OPTIONS.FILE },
    { name: UI_MESSAGES.CLI_COLLAPSE_CHOICE_SYMBOL, value: CLI_COLLAPSE_OPTIONS.SYMBOL },
    { name: UI_MESSAGES.CLI_COLLAPSE_CHOICE_AUTO, value: CLI_COLLAPSE_OPTIONS.AUTO },
  ];
  const res = await ui.askSelect(UI_MESSAGES.CLI_COLLAPSE_PROMPT, collapseChoices);
  return res !== COLLAPSE_CHOICE_NONE_VALUE ? res : undefined;
}

async function handleExport(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([
    CLI_FLAGS.TOPOLOGY,
    CLI_FLAGS.JSON,
    CLI_FLAGS.OUT,
    CLI_FLAGS.COLLAPSE,
  ]);

  let isTopology = ctx.parser.hasFlag(CLI_FLAGS.TOPOLOGY);
  const jsonOnly = ctx.parser.hasFlag(CLI_FLAGS.JSON);
  const out = ctx.parser.getFlagValue(CLI_FLAGS.OUT);
  let collapseVal = ctx.parser.getFlagValue(CLI_FLAGS.COLLAPSE);

  if (ctx.isInteractive) {
    isTopology = true; // Auto enable for wizard
    if (!collapseVal) {
      collapseVal = await askExportCollapseMode();
    }
  }

  if (!isTopology) {
    ui.error(UI_MESSAGES.CLI_EXPORT_USAGE);
    process.exit(1);
  }

  let collapse: TopologyCollapseMode | undefined;
  if (
    collapseVal === CLI_COLLAPSE_OPTIONS.FILE ||
    collapseVal === CLI_COLLAPSE_OPTIONS.SYMBOL ||
    collapseVal === CLI_COLLAPSE_OPTIONS.AUTO
  ) {
    collapse = collapseVal as TopologyCollapseMode;
  }

  await exportTopologyCommand({ jsonOnly, out, collapse, workspaceRoot: ctx.workspaceRoot });
}

async function handleMcp(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  await runMcpServer();
}

async function handleQuery(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([CLI_FLAGS.LOCAL, CLI_FLAGS.FORMAT]);
  const target = ctx.parser.getPositional(0) || "";
  const isLocal = ctx.parser.hasFlag(CLI_FLAGS.LOCAL);
  const formatVal = ctx.parser.getFlagValue(CLI_FLAGS.FORMAT);

  let format: "human" | "prompt" | undefined;
  if (formatVal === CLI_FORMAT_OPTIONS.HUMAN || formatVal === CLI_FORMAT_OPTIONS.PROMPT) {
    format = formatVal as "human" | "prompt";
  }

  await queryCommand(target, { local: isLocal, format }, ctx.workspaceRoot);
}

const COMMAND_HANDLERS: Record<CliCommand, (ctx: CommandContext) => Promise<void>> = {
  [CLI_COMMANDS.INIT]: handleInit,
  [CLI_COMMANDS.ANALYZE]: handleAnalyze,
  [CLI_COMMANDS.STATUS]: handleStatus,
  [CLI_COMMANDS.CLEAN]: handleClean,
  [CLI_COMMANDS.REVIEW]: handleReview,
  [CLI_COMMANDS.SNAPSHOT]: handleSnapshot,
  [CLI_COMMANDS.SYNC]: handleSync,
  [CLI_COMMANDS.EXPORT]: handleExport,
  [CLI_COMMANDS.MCP]: handleMcp,
  [CLI_COMMANDS.QUERY]: handleQuery,
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
    // Hide MCP and EXPORT from interactive menu as they are internal/CI tools
    .filter((cmd) => cmd !== CLI_COMMANDS.MCP && cmd !== CLI_COMMANDS.EXPORT)
    .map((cmd) => ({
      name: cmd,
      value: cmd,
      description: CLI_COMMAND_DESCRIPTIONS[cmd],
    }));

  const selected = (await ui.askSelect(UI_MESSAGES.CLI_PROMPT_ACTION, choices)) as CliCommand;
  return { command: selected, isInteractive: true };
}

async function main() {
  setupDI();

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
