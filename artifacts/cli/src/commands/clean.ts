import process from "process";
import crypto from "node:crypto";
import { docuviaMemory, DocuviaError } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

/** Thin caller of `docuviaApi.clean()` — mirrors `init.ts`'s Presentation-layer responsibilities (see `docs/gitbook/architecture/application-lifecycle-and-state.md`'s "Bootstrapper & Garbage Collector" role). */
export async function cleanCommand(cwd: string = process.cwd()) {
  ui.header(UI_MESSAGES.CLEAN_HEADER);

  if (process.stdin.isTTY) {
    const proceed = await ui.askConfirm(UI_MESSAGES.CLEAN_CONFIRM, false);
    if (!proceed) {
      ui.warn(UI_MESSAGES.CLEAN_ABORTED);
      process.exit(0);
    }
  }

  const spinner = ui.spinner(UI_MESSAGES.CLEAN_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === "info") spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, "workspaceRoot", cwd);

  try {
    const result = await docuviaApi.clean(scopeId, logger);
    spinner.succeed(UI_MESSAGES.CLEAN_SUCCESS + result.message);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.CLEAN_FAIL + message);
    process.exit(1);
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
