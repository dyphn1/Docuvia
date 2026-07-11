import process from "process";
import crypto from "node:crypto";
import { docuviaMemory, DocuviaError } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

/** Thin caller of `docuviaApi.snapshot()` — mirrors `status.ts`'s Presentation-layer responsibilities. */
export async function snapshotCommand(cwd: string = process.cwd()) {
  const spinner = ui.spinner(UI_MESSAGES.SNAPSHOT_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === "info") spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, "workspaceRoot", cwd);

  try {
    const result = await docuviaApi.snapshot(scopeId, logger);
    spinner.succeed(
      `${UI_MESSAGES.SNAPSHOT_SUCCESS}${result.nodesWritten} nodes, ${result.edgesWritten} edges, ${result.markdownFilesWritten} markdown files`
    );
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error ? error.message : String(error);
    spinner.fail(UI_MESSAGES.SNAPSHOT_FAIL + message);
    process.exit(1);
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
