#!/usr/bin/env node
import * as dotenv from "dotenv";
import process from "process";
import pc from "picocolors";

import "./registration.js";
import { initCommand } from "./commands/init.js";
import { cleanCommand } from "./commands/clean.js";
import { statusCommand } from "./commands/status.js";
import { syncCommand } from "./commands/sync.js";
import { analyzeCommand } from "./commands/analyze.js";
import { reviewCommand } from "./commands/review.js";
import { impactCommand } from "./commands/impact.js";
import { queryCommand } from "./commands/query.js";
import { exportTopologyCommand } from "./commands/export-topology.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { hydrateCommand } from "./commands/hydrate.js";
import { runMcpServer } from "./mcp/server.js";
import type { TopologyCollapseMode } from "@workspace/contracts";

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

async function handleClean(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  await cleanCommand(ctx.workspaceRoot);
}

async function handleStatus(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  await statusCommand(ctx.workspaceRoot);
}

async function handleSync(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([CLI_FLAGS.COMMIT_SHA]);
  const projectId = ctx.parser.getPositional(0);
  const commitSha = ctx.parser.getFlagValue(CLI_FLAGS.COMMIT_SHA);
  await syncCommand({ projectId, commitSha }, ctx.workspaceRoot);
}

async function handleAnalyze(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  const targetPath = ctx.parser.getPositional(0);
  await analyzeCommand(targetPath, ctx.workspaceRoot);
}

async function handleReview(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  const baseRef = ctx.parser.getPositional(0);
  await reviewCommand(baseRef, ctx.workspaceRoot);
}

async function handleImpact(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([CLI_FLAGS.ESCALATE_TO_LSP]);
  const target = ctx.parser.getPositional(0);
  if (!target) {
    ui.error(UI_MESSAGES.IMPACT_MISSING_TARGET);
    process.exitCode = 1;
    return;
  }
  const escalateToLsp = ctx.parser.hasFlag(CLI_FLAGS.ESCALATE_TO_LSP);
  await impactCommand(target, { escalateToLsp }, ctx.workspaceRoot);
}

async function handleQuery(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([CLI_FLAGS.FORMAT, CLI_FLAGS.LIMIT]);
  const target = ctx.parser.getPositional(0);
  const format = ctx.parser.getFlagValue(CLI_FLAGS.FORMAT) as "human" | "prompt" | undefined;
  const limitRaw = ctx.parser.getFlagValue(CLI_FLAGS.LIMIT);
  const limit = limitRaw ? Number(limitRaw) : undefined;
  await queryCommand(target, { format, limit }, ctx.workspaceRoot);
}

async function handleExportTopology(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([CLI_FLAGS.OUT, CLI_FLAGS.JSON_ONLY, CLI_FLAGS.COLLAPSE]);
  const out = ctx.parser.getFlagValue(CLI_FLAGS.OUT);
  const jsonOnly = ctx.parser.hasFlag(CLI_FLAGS.JSON_ONLY);
  const collapse = ctx.parser.getFlagValue(CLI_FLAGS.COLLAPSE) as TopologyCollapseMode | undefined;
  await exportTopologyCommand({ out, jsonOnly, collapse }, ctx.workspaceRoot);
}

async function handleSnapshot(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  await snapshotCommand(ctx.workspaceRoot);
}

async function handleHydrate(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags([]);
  await hydrateCommand(ctx.workspaceRoot);
}

/**
 * `init`/`mcp`/`clean`/`status`/`sync`/`analyze`/`review`/`impact`/`query`/`export-topology`/
 * `snapshot`/`hydrate` are wired so far. Structured so each later command is added as one more
 * `handleX` function + one more `COMMAND_HANDLERS` entry, without restructuring dispatch.
 */
const COMMAND_HANDLERS: Record<CliCommand, (ctx: CommandContext) => Promise<void>> = {
  [CLI_COMMANDS.INIT]: handleInit,
  [CLI_COMMANDS.MCP]: handleMcp,
  [CLI_COMMANDS.CLEAN]: handleClean,
  [CLI_COMMANDS.STATUS]: handleStatus,
  [CLI_COMMANDS.SYNC]: handleSync,
  [CLI_COMMANDS.ANALYZE]: handleAnalyze,
  [CLI_COMMANDS.REVIEW]: handleReview,
  [CLI_COMMANDS.IMPACT]: handleImpact,
  [CLI_COMMANDS.QUERY]: handleQuery,
  [CLI_COMMANDS.EXPORT_TOPOLOGY]: handleExportTopology,
  [CLI_COMMANDS.SNAPSHOT]: handleSnapshot,
  [CLI_COMMANDS.HYDRATE]: handleHydrate,
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
