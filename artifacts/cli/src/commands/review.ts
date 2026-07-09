import { ChangeDetectionService, DI_TOKENS, DI_KEYS } from "@workspace/core";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

export async function reviewCommand(baseRef?: string, workspaceRoot: string = process.cwd()) {
  ui.header(UI_MESSAGES.REVIEW_HEADER);
  const spinner = ui.spinner(UI_MESSAGES.REVIEW_START).start();
  try {
    const changeDetectionService = resolveConfiguredService<ChangeDetectionService>(
      DI_TOKENS.ChangeDetectionService,
      { [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot }
    );
    const result = await changeDetectionService.detectChanges(baseRef);
    spinner.succeed(
      UI_MESSAGES.REVIEW_SUCCESS + (baseRef ? `${UI_MESSAGES.REVIEW_AGAINST}${baseRef}` : "")
    );
    console.log("");
    console.log(result.analysis);
  } catch (error: any) {
    spinner.fail(UI_MESSAGES.REVIEW_FAIL + error.message);
    process.exit(1);
  }
}
