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

async function main() {
  // Initialize Dependency Injection
  setupDI();

  let command = process.argv[2] as CliCommand | undefined;
  const rawArgs = process.argv.slice(3);
  const parser = new ArgParser(rawArgs);

  let isInteractive = false;
  // Interactive fallback when no command is provided
  if (!command) {
    if (!process.stdin.isTTY) {
      printUsage();
      process.exit(1);
    }

    isInteractive = true;
    ui.header(UI_MESSAGES.CLI_HEADER);
    const choices = Object.values(CLI_COMMANDS)
      // Hide MCP and EXPORT from interactive menu as they are internal/CI tools
      .filter((cmd) => cmd !== CLI_COMMANDS.MCP && cmd !== CLI_COMMANDS.EXPORT)
      .map((cmd) => ({
        name: cmd,
        value: cmd,
        description: CLI_COMMAND_DESCRIPTIONS[cmd],
      }));

    command = (await ui.askSelect(UI_MESSAGES.CLI_PROMPT_ACTION, choices)) as CliCommand;
  }

  try {
    switch (command) {
      case CLI_COMMANDS.INIT:
        parser.checkUnknownFlags([]);
        await initCommand();
        break;

      case CLI_COMMANDS.ANALYZE: {
        parser.checkUnknownFlags([CLI_FLAGS.DEEP]);

        let deep = parser.hasFlag(CLI_FLAGS.DEEP);
        let targetFile = parser.getPositional(0);

        if (isInteractive && !deep && !targetFile) {
          const answer = await ui.askConfirm(
            "Would you like to enable deep scanning (extract L3 decisions)?",
            false
          );
          deep = answer;
        }

        await analyzeCommand(targetFile, deep);
        break;
      }

      case CLI_COMMANDS.STATUS:
        parser.checkUnknownFlags([]);
        await statusCommand();
        break;

      case CLI_COMMANDS.CLEAN:
        parser.checkUnknownFlags([]);
        await cleanCommand();
        break;

      case CLI_COMMANDS.REVIEW: {
        parser.checkUnknownFlags([CLI_FLAGS.BASE_REF]);
        const baseRef = parser.getFlagValue(CLI_FLAGS.BASE_REF);
        await reviewCommand(baseRef);
        break;
      }

      case CLI_COMMANDS.SNAPSHOT:
        parser.checkUnknownFlags([]);
        await snapshotCommand();
        break;

      case CLI_COMMANDS.SYNC: {
        parser.checkUnknownFlags([]);
        const projectId = parser.getPositional(0);
        const commitSha = parser.getPositional(1);
        await syncCommand({ projectId, commitSha });
        break;
      }

      case CLI_COMMANDS.EXPORT: {
        parser.checkUnknownFlags([
          CLI_FLAGS.TOPOLOGY,
          CLI_FLAGS.JSON,
          CLI_FLAGS.OUT,
          CLI_FLAGS.COLLAPSE,
        ]);

        let isTopology = parser.hasFlag(CLI_FLAGS.TOPOLOGY);
        let jsonOnly = parser.hasFlag(CLI_FLAGS.JSON);
        let out = parser.getFlagValue(CLI_FLAGS.OUT);
        let collapseVal = parser.getFlagValue(CLI_FLAGS.COLLAPSE);

        if (isInteractive) {
          isTopology = true; // Auto enable for wizard
          if (!collapseVal) {
            const collapseChoices = [
              { name: "No collapsing (Full graph)", value: "none" },
              { name: "Collapse by File", value: CLI_COLLAPSE_OPTIONS.FILE },
              { name: "Collapse by Symbol", value: CLI_COLLAPSE_OPTIONS.SYMBOL },
              { name: "Auto-collapse based on size", value: CLI_COLLAPSE_OPTIONS.AUTO },
            ];
            const res = await ui.askSelect(
              "How should the topology be collapsed?",
              collapseChoices
            );
            if (res !== "none") collapseVal = res;
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

        await exportTopologyCommand({
          jsonOnly,
          out,
          collapse,
        });
        break;
      }

      case CLI_COMMANDS.MCP:
        parser.checkUnknownFlags([]);
        await runMcpServer();
        return; // keep alive for stdio transport

      case CLI_COMMANDS.QUERY: {
        parser.checkUnknownFlags([CLI_FLAGS.LOCAL, CLI_FLAGS.FORMAT]);
        const target = parser.getPositional(0) || "";
        const isLocal = parser.hasFlag(CLI_FLAGS.LOCAL);
        const formatVal = parser.getFlagValue(CLI_FLAGS.FORMAT);

        let format: "human" | "prompt" | undefined;
        if (formatVal === CLI_FORMAT_OPTIONS.HUMAN || formatVal === CLI_FORMAT_OPTIONS.PROMPT) {
          format = formatVal as "human" | "prompt";
        }

        await queryCommand(target, { local: isLocal, format });
        break;
      }

      default:
        ui.error(UI_MESSAGES.CLI_UNKNOWN_COMMAND + command);
        printUsage();
        process.exit(1);
    }
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
