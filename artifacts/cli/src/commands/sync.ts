import { SyncService, DI_TOKENS, DI_KEYS, container } from "@workspace/core";
import { createInterface } from "readline";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

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
      ui.error(UI_MESSAGES.SYNC_MISSING_PROJECT_ID);
      process.exit(1);
    }

    // Interactive prompt for project ID if missing
    ui.info("No Project ID provided.");
    projectId = await ui.askInput(UI_MESSAGES.SYNC_PROMPT_PROJECT_ID);

    if (!projectId) {
      ui.error("Project ID is required.");
      process.exit(1);
    }
  }

  if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
    ui.warn(UI_MESSAGES.SYNC_MISSING_ENV);
    ui.warn(UI_MESSAGES.SYNC_SKIP);
    return;
  }

  const commitSha = options.commitSha ?? (process.stdin.isTTY ? undefined : await readStdin());

  const spinner = ui.spinner(UI_MESSAGES.SYNC_START + projectId + "...").start();

  const syncService = container.resolve<SyncService>(DI_TOKENS.SyncService);
  // Bind properties that were originally in the constructor
  (syncService as any)[DI_KEYS.WORKSPACE_ROOT] = process.cwd();
  (syncService as any)[DI_KEYS.API_URL] = process.env.DOCUVIA_API_URL;
  (syncService as any)[DI_KEYS.PAT] = process.env.MCP_PAT;
  (syncService as any)[DI_KEYS.LOG_CALLBACK] = (msg: string) => {
    spinner.text = msg;
  };

  try {
    await syncService.sync(projectId, commitSha);
    spinner.succeed(UI_MESSAGES.SYNC_SUCCESS);
  } catch (e: any) {
    spinner.fail(UI_MESSAGES.SYNC_FAIL + e.message);
    process.exit(1);
  }
}
