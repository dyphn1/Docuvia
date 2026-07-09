import { CleanService, DI_TOKENS, DI_KEYS } from "@workspace/core";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

export async function cleanCommand(workspaceRoot: string = process.cwd()) {
  ui.header(UI_MESSAGES.CLEAN_HEADER);

  if (process.stdin.isTTY) {
    const proceed = await ui.askConfirm(UI_MESSAGES.CLEAN_CONFIRM, false);
    if (!proceed) {
      ui.warn(UI_MESSAGES.CLEAN_ABORTED);
      process.exit(0);
    }
  }

  const spinner = ui.spinner(UI_MESSAGES.CLEAN_START).start();

  try {
    const cleanService = resolveConfiguredService<CleanService>(DI_TOKENS.CleanService, {
      [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot,
    });
    const result = await cleanService.clean();
    spinner.succeed(UI_MESSAGES.CLEAN_SUCCESS + " " + result.message);
  } catch (e: any) {
    spinner.fail(UI_MESSAGES.CLEAN_FAIL + e.message);
    process.exit(1);
  }
}
