import { SyncService, DI_TOKENS, DI_KEYS } from "@workspace/core";
import { createInterface } from "readline";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

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

async function resolveProjectId(projectId?: string): Promise<string> {
  if (projectId) return projectId;

  if (!process.stdin.isTTY) {
    ui.error(UI_MESSAGES.SYNC_MISSING_PROJECT_ID);
    process.exit(1);
  }

  ui.info(UI_MESSAGES.SYNC_NO_PROJECT_ID_PROVIDED);
  const enteredProjectId = await ui.askInput(UI_MESSAGES.SYNC_PROMPT_PROJECT_ID);

  if (!enteredProjectId) {
    ui.error(UI_MESSAGES.SYNC_PROJECT_ID_REQUIRED);
    process.exit(1);
  }

  return enteredProjectId;
}

export async function syncCommand(
  options: { projectId?: string; commitSha?: string },
  workspaceRoot: string = process.cwd()
) {
  const projectId = await resolveProjectId(options.projectId);

  if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
    ui.warn(UI_MESSAGES.SYNC_MISSING_ENV);
    ui.warn(UI_MESSAGES.SYNC_SKIP);
    return;
  }

  const commitSha = options.commitSha ?? (process.stdin.isTTY ? undefined : await readStdin());

  const spinner = ui.spinner(UI_MESSAGES.SYNC_START + projectId + "...").start();

  const syncService = resolveConfiguredService<SyncService>(DI_TOKENS.SyncService, {
    [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot,
    [DI_KEYS.API_URL]: process.env.DOCUVIA_API_URL,
    [DI_KEYS.PAT]: process.env.MCP_PAT,
    [DI_KEYS.LOG_CALLBACK]: (msg: string) => {
      spinner.text = msg;
    },
  });

  try {
    await syncService.sync(projectId, commitSha);
    spinner.succeed(UI_MESSAGES.SYNC_SUCCESS);
  } catch (e: any) {
    spinner.fail(UI_MESSAGES.SYNC_FAIL + e.message);
    // process.exitCode (not process.exit()) — this path follows real network calls (GET
    // l2-nodes / POST sync/push); forcing an immediate exit while fetch/undici handles are
    // still closing crashes natively on Windows. See analyze.ts for the same fix + reasoning.
    process.exitCode = 1;
  }
}
