#!/usr/bin/env node
import * as dotenv from "dotenv";
import process from "process";

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
import { CLI_COMMANDS, CLI_COMMAND_DESCRIPTIONS, CliCommand } from "@workspace/core";

dotenv.config();

function printUsage() {
  console.error("Usage:");
  console.error(
    `  docuvia ${CLI_COMMANDS.INIT.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.INIT]}`
  );
  console.error(
    `  docuvia ${CLI_COMMANDS.ANALYZE + " [path] [--deep]"} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.ANALYZE]}`.replace(
      " #",
      "".padEnd(21) + "#"
    )
  );
  console.error(
    `  docuvia ${CLI_COMMANDS.QUERY + " <target> [--local]"}`.padEnd(49) +
      `# ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.QUERY]}`
  );
  console.error(
    `  docuvia ${CLI_COMMANDS.REVIEW + " [--baseRef=...]"}`.padEnd(49) +
      `# ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.REVIEW]}`
  );
  console.error(
    `  docuvia ${CLI_COMMANDS.SNAPSHOT.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.SNAPSHOT]}`
  );
  console.error(
    `  docuvia ${CLI_COMMANDS.SYNC + " <project_id> [sha]"}`.padEnd(49) +
      `# ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.SYNC]}`
  );
  console.error(
    `  docuvia ${CLI_COMMANDS.STATUS.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.STATUS]}`
  );
  console.error(
    `  docuvia ${CLI_COMMANDS.CLEAN.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.CLEAN]}`
  );
  console.error(
    `  docuvia ${CLI_COMMANDS.EXPORT + " --topology [--json]"}`.padEnd(49) +
      `# ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.EXPORT]}`
  );
  console.error(
    `  docuvia ${CLI_COMMANDS.MCP.padEnd(40)} # ${CLI_COMMAND_DESCRIPTIONS[CLI_COMMANDS.MCP]}`
  );
}

async function main() {
  let command = process.argv[2] as CliCommand | undefined;

  // Interactive fallback when no command is provided
  if (!command) {
    if (!process.stdin.isTTY) {
      printUsage();
      process.exit(1);
    }

    ui.header("Docuvia Knowledge Graph");
    const choices = Object.values(CLI_COMMANDS)
      // Hide MCP and EXPORT from interactive menu as they are internal/CI tools
      .filter((cmd) => cmd !== CLI_COMMANDS.MCP && cmd !== CLI_COMMANDS.EXPORT)
      .map((cmd) => ({
        name: cmd,
        value: cmd,
        description: CLI_COMMAND_DESCRIPTIONS[cmd],
      }));

    command = (await ui.askSelect("What would you like to do?", choices)) as CliCommand;
  }

  switch (command) {
    case CLI_COMMANDS.INIT:
      await initCommand();
      process.exit(0);
      break;

    case CLI_COMMANDS.ANALYZE: {
      const deep = process.argv.includes("--deep");
      // Find the target path: it's the first positional arg after 'analyze'
      const args = process.argv.slice(2);
      const idx = args.indexOf(CLI_COMMANDS.ANALYZE);
      let targetFile: string | undefined;
      for (let i = idx + 1; i < args.length; i++) {
        if (!args[i].startsWith("-")) {
          targetFile = args[i];
          break;
        }
      }
      await analyzeCommand(targetFile, deep);
      process.exit(0);
      break;
    }

    case CLI_COMMANDS.STATUS:
      await statusCommand();
      process.exit(0);
      break;

    case CLI_COMMANDS.CLEAN:
      await cleanCommand();
      process.exit(0);
      break;

    case CLI_COMMANDS.REVIEW: {
      const baseRef = process.argv.find((arg) => arg.startsWith("--baseRef="))?.split("=")[1];
      await reviewCommand(baseRef);
      process.exit(0);
      break;
    }

    case CLI_COMMANDS.SNAPSHOT:
      await snapshotCommand();
      process.exit(0);
      break;

    case CLI_COMMANDS.SYNC: {
      const argsWithoutFlags = process.argv.slice(3).filter((arg) => !arg.startsWith("--"));
      const projectId = argsWithoutFlags[0];
      const commitSha = argsWithoutFlags[1];
      await syncCommand({ projectId, commitSha });
      process.exit(0);
      break;
    }

    case CLI_COMMANDS.EXPORT: {
      const isTopology = process.argv.includes("--topology");
      if (!isTopology) {
        ui.error(
          "Usage: docuvia export --topology [--json] [--out=DIR] [--collapse=file|symbol|auto]"
        );
        process.exit(1);
      }
      const collapseArg = process.argv.find((arg) => arg.startsWith("--collapse="))?.split("=")[1];
      const collapse =
        collapseArg === "file" || collapseArg === "symbol" || collapseArg === "auto"
          ? collapseArg
          : undefined;
      await exportTopologyCommand({
        jsonOnly: process.argv.includes("--json"),
        out: process.argv.find((arg) => arg.startsWith("--out="))?.split("=")[1],
        collapse,
      });
      process.exit(0);
      break;
    }

    case CLI_COMMANDS.MCP:
      await runMcpServer();
      return; // keep alive for stdio transport

    case CLI_COMMANDS.QUERY: {
      const args = process.argv.slice(2);
      const idx = args.indexOf(CLI_COMMANDS.QUERY);
      let target = "";
      const options: { local?: boolean; format?: "human" | "prompt" } = {};

      for (let i = idx + 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--local") {
          options.local = true;
        } else if (arg.startsWith("--format=")) {
          const format = arg.substring("--format=".length);
          if (format === "human" || format === "prompt") {
            options.format = format as "human" | "prompt";
          }
        } else if (!arg.startsWith("-") && !target) {
          target = arg;
        }
      }

      await queryCommand(target, options);
      process.exit(0);
      break;
    }

    default:
      ui.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("\x1b[31m%s\x1b[0m", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
