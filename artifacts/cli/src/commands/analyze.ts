import process from "process";
import crypto from "node:crypto";
import { docuviaMemory, DocuviaError } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

/**
 * Thin caller of `docuviaApi.analyze()` — the config-scan half only (mirrors old Docuvia's
 * `analyzeCommand`'s no-target-path branch). A target path (old Docuvia's focused
 * decision-extraction/`extract` path) is explicitly out of scope and tracked separately; this
 * prints a clear "not yet supported" message instead of silently no-op'ing or attempting LLM
 * extraction.
 */
export async function analyzeCommand(
  targetPath?: string,
  cwd: string = process.cwd(),
) {
  if (targetPath) {
    ui.error(UI_MESSAGES.ANALYZE_TARGET_PATH_NOT_SUPPORTED);
    process.exitCode = 1;
    return;
  }

  ui.header(UI_MESSAGES.ANALYZE_HEADER);
  const spinner = ui.spinner(UI_MESSAGES.ANALYZE_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === "info") spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, "workspaceRoot", cwd);

  try {
    const result = await docuviaApi.analyze(scopeId, logger);
    spinner.succeed(UI_MESSAGES.ANALYZE_SUCCESS);
    ui.info(UI_MESSAGES.ANALYZE_PROJECT_TYPE + result.projectType);
    ui.info(
      UI_MESSAGES.ANALYZE_SUGGESTED_TAGS +
        (result.suggestedTags.join(", ") || UI_MESSAGES.ANALYZE_NONE),
    );
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.ANALYZE_FAIL + message);
    process.exit(1);
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
