import { StatusService, DI_TOKENS, DI_KEYS, container } from "@workspace/core";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

export async function statusCommand() {
  const spinner = ui.spinner(UI_MESSAGES.STATUS_START).start();
  try {
    const statusService = container.resolve<StatusService>(DI_TOKENS.StatusService);
    (statusService as any)[DI_KEYS.WORKSPACE_ROOT] = process.cwd();
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
