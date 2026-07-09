import { StatusService, DI_TOKENS, DI_KEYS } from "@workspace/core";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

export async function statusCommand(workspaceRoot: string = process.cwd()) {
  const spinner = ui.spinner(UI_MESSAGES.STATUS_START).start();
  try {
    const statusService = resolveConfiguredService<StatusService>(DI_TOKENS.StatusService, {
      [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot,
    });
    const status = await statusService.getStatus();
    spinner.succeed(UI_MESSAGES.STATUS_SUCCESS);
    ui.header(UI_MESSAGES.STATUS_HEADER);
    ui.info(`${UI_MESSAGES.STATUS_PROJECTS}${status.projects}`);
    ui.info(`${UI_MESSAGES.STATUS_L2_NODES}${status.l2Nodes}`);
    ui.info(`${UI_MESSAGES.STATUS_L3_DECISIONS}${status.l3Nodes}`);
  } catch (error: any) {
    spinner.fail(UI_MESSAGES.STATUS_FAIL + error.message);
    process.exit(1);
  }
}
