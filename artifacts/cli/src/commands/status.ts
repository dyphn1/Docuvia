import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

/** Thin caller of `docuviaApi.status()` — mirrors `init.ts`'s Presentation-layer responsibilities. */
export async function statusCommand(cwd: string = process.cwd()) {
  const spinner = ui.spinner(UI_MESSAGES.STATUS_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);

  try {
    const status = await docuviaApi.status(scopeId, logger);
    spinner.succeed(UI_MESSAGES.STATUS_SUCCESS);
    ui.header(UI_MESSAGES.STATUS_HEADER);
    ui.info(`${UI_MESSAGES.STATUS_PROJECTS}${status.projects}`);
    ui.info(`${UI_MESSAGES.STATUS_L2_NODES}${status.l2Nodes}`);
    ui.info(`${UI_MESSAGES.STATUS_L3_DECISIONS}${status.l3Nodes}`);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.STATUS_FAIL + message);
    // process.exitCode (not process.exit()) — process.exit() terminates before the `finally`
    // below runs, silently skipping the memory-scope cleanup.
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
