import { SyncService } from "@workspace/core";
import { createInterface } from "readline";

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

export async function syncCommand(projectId: string, commitShaArg?: string) {
  if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
    console.warn("⚠️  DOCUVIA_API_URL or MCP_PAT is missing in the environment.");
    console.warn(
      "   Skipping background sync. Please set these variables in your .env file or environment to enable syncing."
    );
    return;
  }

  const commitSha = commitShaArg ?? (process.stdin.isTTY ? undefined : await readStdin());

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
