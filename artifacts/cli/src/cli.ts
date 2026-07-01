#!/usr/bin/env node
import * as dotenv from "dotenv";
import { createInterface } from "readline";
import { initCommand } from "./commands/init.js";
import { initAgent } from "./commands/init-agent.js";
import { queryCommand } from "./commands/query.js";
import { analyzeCommand } from "./commands/analyze.js";
import { extractCommand } from "./commands/extract.js";
import { statusCommand } from "./commands/status.js";
import { cleanCommand } from "./commands/clean.js";
import { detectChangesCommand } from "./commands/detect-changes.js";
import { syncCommand } from "./commands/sync.js";
import { runMcpServer } from "./mcp/server.js";

dotenv.config();

async function main() {
  const command = process.argv[2];

  if (command === "init") {
    await initCommand();
    process.exit(0);
  }

  if (command === "init-agent") {
    await initAgent();
    process.exit(0);
  }

  if (command === "analyze") {
    const deep = process.argv.includes("--deep");
    await analyzeCommand(deep);
    process.exit(0);
  }

  if (command === "extract") {
    const targetFile = process.argv[3];
    await extractCommand(targetFile);
    process.exit(0);
  }

  if (command === "status") {
    await statusCommand();
    process.exit(0);
  }

  if (command === "clean") {
    await cleanCommand();
    process.exit(0);
  }

  if (command === "detect-changes") {
    const baseRef = process.argv.find((arg) => arg.startsWith("--baseRef="))?.split("=")[1];
    await detectChangesCommand(baseRef);
    process.exit(0);
  }

  if (command === "sync") {
    const isLocal = process.argv.includes("--local");
    const argsWithoutFlags = process.argv.slice(3).filter((arg) => !arg.startsWith("--"));
    const projectId = argsWithoutFlags[0];
    const commitSha = argsWithoutFlags[1];

    if (!isLocal && !projectId) {
      console.error(
        "  docuvia init                                 # Initialize local project and DB"
      );
      console.error("Usage: docuvia sync <project_id> [commit_sha]");
      console.error(
        "       docuvia sync --local                    # Pack local knowledge to orphan branch"
      );
      console.error("       echo <commit_sha> | docuvia sync <project_id>");
      process.exit(1);
    }

    await syncCommand({ isLocal, projectId, commitSha });
    process.exit(0);
  }

  if (command === "mcp") {
    await runMcpServer();
    // Do not exit, keep process alive for stdio transport
    return;
  }

  if (command === "query") {
    const args = process.argv.slice(3);
    let target = "";
    const options: { local?: boolean; format?: "human" | "prompt" } = {};

    for (const arg of args) {
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

    if (!target) {
      console.error("Usage: docuvia query <target> [--local] [--format=prompt|human]");
      process.exit(1);
    }

    await queryCommand(target, options);
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  console.error("Usage:");
  console.error("  docuvia init                                 # Initialize local project and DB");
  console.error("  docuvia status                               # Check index database health");
  console.error("  docuvia clean                                # Wipe local.db knowledge graph");
  console.error(
    "  docuvia detect-changes [--baseRef=...]       # Detect structural changes and risk score"
  );
  console.error(
    "  docuvia analyze [--deep]                     # Analyze project (add --deep for L3 extraction)"
  );
  console.error("  docuvia extract <file_path>                  # Extract decisions from a file");
  console.error(
    "  docuvia init-agent                           # Install hooks for Claude Code and Cursor"
  );
  console.error("  docuvia sync <project_id> [commit_sha]       # Sync local changes to server");
  console.error(
    "  docuvia sync --local                         # Pack local knowledge to orphan branch"
  );
  console.error("  docuvia query <target> [--local]             # Query the knowledge graph");
  console.error(
    "  docuvia mcp                                  # Start the local MCP stdio server"
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("\x1b[31m%s\x1b[0m", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
