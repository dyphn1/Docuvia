#!/usr/bin/env node
import * as dotenv from "dotenv";
import { createInterface } from "readline";
import { initAgent } from "./commands/init-agent.js";

dotenv.config();

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    let data = "";
    rl.on("line", (line) => {
      data += line + "\n";
    });
    rl.on("close", () => resolve(data.trim()));
  });
}

async function main() {
  const command = process.argv[2];

  if (command === "init-agent") {
    await initAgent();
    process.exit(0);
  }

  if (command === "sync") {
    if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
      console.warn("⚠️  DOCUVIA_API_URL or MCP_PAT is missing in the environment.");
      console.warn("   Skipping background sync. Please set these variables in your .env file or environment to enable syncing.");
      process.exit(0);
    }

    const projectId = process.argv[3];
    if (!projectId) {
      console.error("Usage: docuvia sync <project_id> [commit_sha]");
      console.error("       echo <commit_sha> | docuvia sync <project_id>");
      process.exit(1);
    }

    // Support post-commit hook: accept commit SHA as arg or stdin
    const commitSha = process.argv[4] ?? (process.stdin.isTTY ? undefined : await readStdin());

    console.log(`Syncing project ${projectId}...`);
    try {
      const apiUrl = process.env.DOCUVIA_API_URL.replace(/\/+$/, "");
      const res = await fetch(`${apiUrl}/api/projects/${projectId}/sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MCP_PAT}`,
          "Content-Type": "application/json",
        },
        body: commitSha ? JSON.stringify({ commitSha }) : undefined,
      });
      const body = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(String(body.error ?? (await res.text())));
      console.log(String(body.message ?? "Sync completed"));
    } catch (e) {
      console.error("Sync failed:", e);
      process.exit(1);
    }
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  console.error("Usage:");
  console.error("  docuvia init-agent                           # Install hooks for Claude Code and Cursor");
  console.error("  docuvia sync <project_id> [commit_sha]       # Sync local changes to server");
  process.exit(1);
}

main();
