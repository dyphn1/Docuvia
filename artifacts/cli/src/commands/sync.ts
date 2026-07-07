import { SyncService } from "@workspace/core";
import { createInterface } from "readline";
import process from "process";
import { ui } from "../ui/wizard.js";

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

export async function syncCommand(options: { projectId?: string; commitSha?: string }) {
  let projectId = options.projectId;

  if (!projectId) {
    if (!process.stdin.isTTY) {
      ui.error("Missing required argument: <project_id>");
      process.exit(1);
    }

    // Interactive prompt for project ID if missing
    ui.info("No Project ID provided.");
    projectId = await ui.askInput("Enter the Docuvia Project ID to sync with:");

    if (!projectId) {
      ui.error("Project ID is required.");
      process.exit(1);
    }
  }

  if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
    ui.warn("DOCUVIA_API_URL or MCP_PAT is missing in the environment.");
    ui.warn("Skipping remote sync. Please set these variables in your .env file or environment.");
    return;
  }

  const commitSha = options.commitSha ?? (process.stdin.isTTY ? undefined : await readStdin());

  const spinner = ui.spinner(`Syncing workspace to remote project ${projectId}...`).start();

  const syncService = new SyncService(
    process.cwd(),
    process.env.DOCUVIA_API_URL,
    process.env.MCP_PAT,
    (msg: string) => {
      spinner.text = msg;
    }
  );

  try {
    await syncService.sync(projectId, commitSha);
    spinner.succeed("Remote sync completed successfully.");
  } catch (e: any) {
    spinner.fail(`Sync failed: ${e.message}`);
    process.exit(1);
  }
}
