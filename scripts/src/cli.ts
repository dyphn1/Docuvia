#!/usr/bin/env node
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const command = process.argv[2];

  if (command === "sync") {
    if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
      console.error("DOCUVIA_API_URL and MCP_PAT must be set");
      process.exit(1);
    }
    const projectId = process.argv[3];
    if (!projectId) {
      console.error("Usage: docuvia sync <project_id>");
      process.exit(1);
    }

    console.log(`Triggering ingestion for project ${projectId}...`);
    try {
      const res = await fetch(`${process.env.DOCUVIA_API_URL}/api/projects/${projectId}/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.MCP_PAT}` },
      });
      if (!res.ok) throw new Error(await res.text());
      console.log("Ingestion triggered successfully");
    } catch (e) {
      console.error("Sync failed:", e);
      process.exit(1);
    }
    process.exit(0);
  }

  console.error("Unknown command");
  process.exit(1);
}

main();
