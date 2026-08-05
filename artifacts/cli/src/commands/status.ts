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
    const tierBCoveragePct =
      status.tierBFilesTotal > 0
        ? ((status.tierBFilesProcessed / status.tierBFilesTotal) * 100).toFixed(
            1,
          )
        : "0.0";
    ui.table(
      [
        { header: UI_MESSAGES.STATUS_COL_METRIC },
        { header: UI_MESSAGES.STATUS_COL_VALUE },
      ],
      [
        [UI_MESSAGES.STATUS_METRIC_PROJECTS, String(status.projects)],
        [UI_MESSAGES.STATUS_METRIC_L2_NODES, String(status.l2Nodes)],
        [UI_MESSAGES.STATUS_METRIC_L3_DECISIONS, String(status.l3Nodes)],
        [
          UI_MESSAGES.STATUS_METRIC_TIER_B_COVERAGE,
          `${status.tierBFilesProcessed} / ${status.tierBFilesTotal} (${tierBCoveragePct}%)`,
        ],
      ],
    );
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
