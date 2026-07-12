import crypto from "node:crypto";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { selectPlatforms } from "../utils/platform-selection.js";
import { docuviaMemory, DocuviaError } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import "../registration.js";

export async function uninstallCommand(
  workspaceRoot: string,
  allowGlobalMcpConfig: boolean,
  platformFilter?: string,
  keepDb: boolean = false,
): Promise<void> {
  try {
    ui.header(UI_MESSAGES.UNINSTALL_HEADER);
    ui.info(UI_MESSAGES.UNINSTALL_START);

    const selectedPlatforms = await selectPlatforms(
      UI_MESSAGES.UNINSTALL_HOOKS_SELECT,
      platformFilter,
    );
    for (const platform of selectedPlatforms) {
      await platform.uninstallHooks(workspaceRoot, allowGlobalMcpConfig);
    }

    if (keepDb) {
      ui.info(UI_MESSAGES.UNINSTALL_KEEP_DB);
    } else {
      const scopeId = crypto.randomUUID();
      const logger = createPinoBackedLogger();

      docuviaMemory.createScope(scopeId);
      docuviaMemory.set(scopeId, "workspaceRoot", workspaceRoot);

      try {
        const result = await docuviaApi.clean(scopeId, logger);
        ui.success(UI_MESSAGES.UNINSTALL_SUCCESS_CLEAN + result.message);
      } catch (error: unknown) {
        const message =
          error instanceof DocuviaError || error instanceof Error
            ? error.message
            : String(error);
        ui.warn(UI_MESSAGES.UNINSTALL_FAIL_CLEAN + message);
        throw error;
      } finally {
        docuviaMemory.deleteScope(scopeId);
      }
    }

    ui.success(UI_MESSAGES.UNINSTALL_SUCCESS);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    ui.warn(UI_MESSAGES.UNINSTALL_FAIL + errorMessage);
    process.exitCode = 1;
  }
}
