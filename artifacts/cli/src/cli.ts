#!/usr/bin/env node
import * as dotenv from "dotenv";
import process from "process";
import pc from "picocolors";
import { createRequire } from "node:module";

import "./registration.js";
import { initCommand } from "./commands/init.js";
import { cleanCommand } from "./commands/clean.js";
import { statusCommand } from "./commands/status.js";
import { publishCommand } from "./commands/publish.js";
import { analyzeCommand } from "./commands/analyze.js";
import { reviewCommand } from "./commands/review.js";
import { impactCommand } from "./commands/impact.js";
import { queryCommand } from "./commands/query.js";
import { exportTopologyCommand } from "./commands/export-topology.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { hydrateCommand } from "./commands/hydrate.js";
import { syncKnowledgeCommand } from "./commands/sync-knowledge.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { doctorCommand } from "./commands/doctor.js";
import { runMcpServer } from "./mcp/server.js";
import type { TopologyCollapseMode } from "@workspace/contracts";

import { ui } from "./ui/wizard.js";
import {
  CLI_COMMANDS,
  CLI_COMMAND_DESCRIPTIONS,
  CLI_COMMAND_FLAGS,
  CliCommand,
  getUsageText,
  getCommandUsageText,
} from "./constants/cli-commands.js";
import { CLI_FLAGS, type QueryOutputFormat } from "./constants/cli-flags.js";
import { UI_MESSAGES } from "./constants/ui-messages.js";
import { ArgParser } from "./utils/arg-parser.js";

dotenv.config({ quiet: true });

// Resolved via `require()` (not a static `import ... from "../package.json"`) so esbuild
// inlines the parsed JSON at build time without needing `resolveJsonModule` in tsconfig.
const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

function printUsage() {
  ui.error(getUsageText());
}

function getVersion(): string {
  return packageJson.version;
}

function isHelpArg(arg: string | undefined): boolean {
  return arg === CLI_FLAGS.HELP || arg === CLI_FLAGS.HELP_SHORT;
}

function isVersionArg(arg: string | undefined): boolean {
  return arg === CLI_FLAGS.VERSION || arg === CLI_FLAGS.VERSION_SHORT;
}

function isInteractiveArg(arg: string | undefined): boolean {
  return arg === CLI_FLAGS.INTERACTIVE || arg === CLI_FLAGS.INTERACTIVE_SHORT;
}

interface CommandContext {
  parser: ArgParser;
  isInteractive: boolean;
  workspaceRoot: string;
}

async function handleInit(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.INIT]);
  const platform = ctx.parser.getFlagValue(CLI_FLAGS.PLATFORM);
  await initCommand(ctx.workspaceRoot, platform, ctx.isInteractive);
}

async function handleMcp(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.MCP]);
  await runMcpServer();
}

async function handleClean(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.CLEAN]);
  await cleanCommand(ctx.workspaceRoot, ctx.isInteractive);
}

async function handleStatus(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.STATUS]);
  await statusCommand(ctx.workspaceRoot);
}

async function handlePublish(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.PUBLISH]);
  const projectId = ctx.parser.getPositional(0);
  const commitSha = ctx.parser.getFlagValue(CLI_FLAGS.COMMIT_SHA);
  await publishCommand(
    { projectId, commitSha },
    ctx.workspaceRoot,
    ctx.isInteractive,
  );
}

async function handleAnalyze(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.ANALYZE]);
  const targetPath = ctx.parser.getPositional(0);
  const escalateToLsp = ctx.parser.hasFlag(CLI_FLAGS.ESCALATE_TO_LSP);
  const fallbackAst = ctx.parser.hasFlag(CLI_FLAGS.FALLBACK_AST);
  const full = ctx.parser.hasFlag(CLI_FLAGS.FULL);
  const force =
    ctx.parser.hasFlag(CLI_FLAGS.FORCE) ||
    ctx.parser.hasFlag(CLI_FLAGS.FORCE_SHORT);
  const lspTimeoutRaw = ctx.parser.getFlagValue(CLI_FLAGS.LSP_TIMEOUT);
  const lspTimeoutMs =
    lspTimeoutRaw !== undefined ? Number(lspTimeoutRaw) : undefined;
  const lspProcessesRaw = ctx.parser.getFlagValue(CLI_FLAGS.LSP_PROCESSES);
  const lspProcesses =
    lspProcessesRaw !== undefined ? Number(lspProcessesRaw) : undefined;
  const agentAuthored = ctx.parser.hasFlag(CLI_FLAGS.AGENT_AUTHORED);
  const decisionsFile = ctx.parser.getFlagValue(CLI_FLAGS.DECISIONS_FILE);
  await analyzeCommand(targetPath, ctx.workspaceRoot, {
    escalateToLsp,
    fallbackAst,
    isInteractive: ctx.isInteractive,
    force,
    lspTimeoutMs,
    lspProcesses,
    full,
    agentAuthored,
    decisionsFile,
  });
}

async function handleReview(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.REVIEW]);
  const baseRef = ctx.parser.getPositional(0);
  await reviewCommand(baseRef, ctx.workspaceRoot);
}

async function handleImpact(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.IMPACT]);
  const target = ctx.parser.getPositional(0);
  if (!target) {
    ui.error(UI_MESSAGES.IMPACT_MISSING_TARGET);
    process.exitCode = 1;
    return;
  }
  await impactCommand(target, ctx.workspaceRoot);
}

async function handleQuery(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.QUERY]);
  const target = ctx.parser.getPositional(0);
  const format = ctx.parser.getFlagValue(CLI_FLAGS.FORMAT) as
    QueryOutputFormat | undefined;
  const limitRaw = ctx.parser.getFlagValue(CLI_FLAGS.LIMIT);
  const limit = limitRaw ? Number(limitRaw) : undefined;
  await queryCommand(
    target,
    { format, limit },
    ctx.workspaceRoot,
    ctx.isInteractive,
  );
}

async function handleExportTopology(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.EXPORT_TOPOLOGY]);
  const out = ctx.parser.getFlagValue(CLI_FLAGS.OUT);
  const jsonOnly = ctx.parser.hasFlag(CLI_FLAGS.JSON_ONLY);
  const collapse = ctx.parser.getFlagValue(CLI_FLAGS.COLLAPSE) as
    TopologyCollapseMode | undefined;
  await exportTopologyCommand({ out, jsonOnly, collapse }, ctx.workspaceRoot);
}

async function handleSnapshot(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.SNAPSHOT]);
  await snapshotCommand(ctx.workspaceRoot);
}

async function handleHydrate(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.HYDRATE]);
  const force =
    ctx.parser.hasFlag(CLI_FLAGS.FORCE) ||
    ctx.parser.hasFlag(CLI_FLAGS.FORCE_SHORT);
  await hydrateCommand(ctx.workspaceRoot, { force });
}

async function handleUninstall(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.UNINSTALL]);
  const platform = ctx.parser.getFlagValue(CLI_FLAGS.PLATFORM);
  const keepDb = ctx.parser.hasFlag(CLI_FLAGS.KEEP_DB);
  await uninstallCommand(
    ctx.workspaceRoot,
    platform,
    keepDb,
    ctx.isInteractive,
  );
}

async function handleDoctor(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.DOCTOR]);
  const skipDb = ctx.parser.hasFlag(CLI_FLAGS.SKIP_DB);
  const skipGit = ctx.parser.hasFlag(CLI_FLAGS.SKIP_GIT);
  const skipHooks = ctx.parser.hasFlag(CLI_FLAGS.SKIP_HOOKS);
  const skipLogs = ctx.parser.hasFlag(CLI_FLAGS.SKIP_LOGS);
  const skipLsp = ctx.parser.hasFlag(CLI_FLAGS.SKIP_LSP);
  const skipLlm = ctx.parser.hasFlag(CLI_FLAGS.SKIP_LLM);
  const fix = ctx.parser.hasFlag(CLI_FLAGS.FIX);
  await doctorCommand(ctx.workspaceRoot, {
    skipDb,
    skipGit,
    skipHooks,
    skipLogs,
    skipLsp,
    skipLlm,
    fix,
  });
}

async function handleSyncKnowledge(ctx: CommandContext): Promise<void> {
  ctx.parser.checkUnknownFlags(CLI_COMMAND_FLAGS[CLI_COMMANDS.SYNC_KNOWLEDGE]);
  await syncKnowledgeCommand(ctx.workspaceRoot);
}

/**
 * `init`/`mcp`/`clean`/`status`/`publish`/`analyze`/`review`/`impact`/`query`/`export-topology`/
 * `snapshot`/`hydrate`/`sync-knowledge` are wired so far. Structured so each later command is
 * added as one more `handleX` function + one more `COMMAND_HANDLERS` entry, without restructuring
 * dispatch.
 */
const COMMAND_HANDLERS: Record<
  CliCommand,
  (ctx: CommandContext) => Promise<void>
> = {
  [CLI_COMMANDS.INIT]: handleInit,
  [CLI_COMMANDS.MCP]: handleMcp,
  [CLI_COMMANDS.CLEAN]: handleClean,
  [CLI_COMMANDS.STATUS]: handleStatus,
  [CLI_COMMANDS.PUBLISH]: handlePublish,
  [CLI_COMMANDS.ANALYZE]: handleAnalyze,
  [CLI_COMMANDS.REVIEW]: handleReview,
  [CLI_COMMANDS.IMPACT]: handleImpact,
  [CLI_COMMANDS.QUERY]: handleQuery,
  [CLI_COMMANDS.EXPORT_TOPOLOGY]: handleExportTopology,
  [CLI_COMMANDS.SNAPSHOT]: handleSnapshot,
  [CLI_COMMANDS.HYDRATE]: handleHydrate,
  [CLI_COMMANDS.SYNC_KNOWLEDGE]: handleSyncKnowledge,
  [CLI_COMMANDS.UNINSTALL]: handleUninstall,
  [CLI_COMMANDS.DOCTOR]: handleDoctor,
};

/**
 * IFCE-004: interactive prompts are opt-in (`--interactive`/`-i`) only — a bare `stdin.isTTY`
 * auto-trigger (the prior IFCE-001 design) false-positives inside pty-wrapping agent/terminal
 * integrations that never deliver real keypresses, hanging the process forever. `wantsInteractive`
 * is "did the caller ask"; `interactiveEligible` additionally requires an actually-usable TTY and
 * a non-CI run, same safety floor the old auto-trigger used, now gating the opt-in rather than
 * triggering it.
 */
async function resolveCommand(
  firstArg: string | undefined,
  wantsInteractive: boolean,
  interactiveEligible: boolean,
): Promise<CliCommand | undefined> {
  const command = isInteractiveArg(firstArg)
    ? undefined
    : (firstArg as CliCommand | undefined);

  if (command) {
    return command;
  }

  if (!wantsInteractive) {
    printUsage();
    process.exit(1);
  }

  if (!interactiveEligible) {
    ui.error(UI_MESSAGES.CLI_INTERACTIVE_NO_TTY);
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

  const selected = (await ui.askSelect(
    UI_MESSAGES.CLI_PROMPT_ACTION,
    choices,
  )) as CliCommand;
  return selected;
}

/** Prints help/version output for the bare `--help`/`--version` invocations. Returns whether one was handled. */
function handleGlobalFlags(firstArg: string | undefined): boolean {
  if (isHelpArg(firstArg)) {
    ui.log(getUsageText());
    return true;
  }
  if (isVersionArg(firstArg)) {
    ui.log(getVersion());
    return true;
  }
  return false;
}

function computeInteractivity(firstArg: string | undefined, parser: ArgParser) {
  const wantsInteractive =
    isInteractiveArg(firstArg) ||
    parser.hasFlag(CLI_FLAGS.INTERACTIVE) ||
    parser.hasFlag(CLI_FLAGS.INTERACTIVE_SHORT);
  const interactiveEligible =
    wantsInteractive && !!process.stdin.isTTY && !process.env.CI;
  return { wantsInteractive, interactiveEligible };
}

async function runCommand(
  command: CliCommand | undefined,
  handler: ((ctx: CommandContext) => Promise<void>) | undefined,
  parser: ArgParser,
  wantsInteractive: boolean,
  interactiveEligible: boolean,
  workspaceRoot: string,
) {
  if (!command || !handler) {
    ui.error(UI_MESSAGES.CLI_UNKNOWN_COMMAND + command);
    printUsage();
    process.exit(1);
    return;
  }

  if (parser.hasFlag(CLI_FLAGS.HELP) || parser.hasFlag(CLI_FLAGS.HELP_SHORT)) {
    ui.log(getCommandUsageText(command));
    return;
  }

  if (wantsInteractive && !interactiveEligible) {
    ui.warn(UI_MESSAGES.CLI_INTERACTIVE_UNAVAILABLE);
  }

  await handler({
    parser,
    isInteractive: interactiveEligible,
    workspaceRoot,
  });
}

async function main() {
  const firstArg = process.argv[2];
  if (handleGlobalFlags(firstArg)) return;

  const rawArgs = process.argv.slice(3);
  const parser = new ArgParser(rawArgs);
  const workspaceRoot = process.cwd();

  const { wantsInteractive, interactiveEligible } = computeInteractivity(
    firstArg,
    parser,
  );

  const command = await resolveCommand(
    firstArg,
    wantsInteractive,
    interactiveEligible,
  );
  const handler = command ? COMMAND_HANDLERS[command] : undefined;

  try {
    await runCommand(
      command,
      handler,
      parser,
      wantsInteractive,
      interactiveEligible,
      workspaceRoot,
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    ui.error(UI_MESSAGES.CLI_FATAL_ERROR + msg);
    process.exit(1);
  }
}

main().catch((err) => {
  ui.error(
    UI_MESSAGES.CLI_FATAL_ERROR +
      (err instanceof Error ? err.message : String(err)),
  );
  process.exit(1);
});
