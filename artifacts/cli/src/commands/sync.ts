import { SyncService, LocalOrphanBranchWriter } from "@workspace/core";
import { createInterface } from "readline";
import process from "process";

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

export async function syncCommand(options: { isLocal: boolean; projectId?: string; commitSha?: string }) {
  if (options.isLocal) {
    console.log("[docuvia] Packing local knowledge graph to orphan branch...");
    try {
      const workspaceRoot = process.cwd();
      const localWriter = new LocalOrphanBranchWriter(workspaceRoot);
      await localWriter.packToBranch();
      console.log("[docuvia] Successfully packed local knowledge to branch.");
    } catch (e: any) {
      console.error("Local sync (packing) failed:", e.message);
      process.exit(1);
    }
    return;
  }

  const projectId = options.projectId;
  if (!projectId) {
    console.error("Usage: docuvia sync <project_id> [commit_sha]");
    process.exit(1);
  }

  if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
    console.warn("⚠️  DOCUVIA_API_URL or MCP_PAT is missing in the environment.");
    console.warn(
      "   Skipping background sync. Please set these variables in your .env file or environment to enable syncing."
    );
    return;
  }

  const commitSha = options.commitSha ?? (process.stdin.isTTY ? undefined : await readStdin());

  const syncService = new SyncService(
    process.cwd(),
    process.env.DOCUVIA_API_URL,
    process.env.MCP_PAT,
    (msg: string) => console.log(msg)
  );

  try {
    await syncService.sync(projectId, commitSha);
  } catch (e: any) {
    console.error("Sync failed:", e);
    process.exit(1);
  }
}
