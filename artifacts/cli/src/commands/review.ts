import process from "process";
import crypto from "node:crypto";
import { docuviaMemory, DocuviaError } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

/** Thin caller of docuviaApi.review() - mirrors init.ts's Presentation-layer responsibilities. */
export async function reviewCommand(baseRef?: string, cwd: string = process.cwd()) {
  ui.header(UI_MESSAGES.REVIEW_HEADER);
  const spinner = ui.spinner(UI_MESSAGES.REVIEW_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === "info") spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, "workspaceRoot", cwd);
  if (baseRef) docuviaMemory.set(scopeId, "baseRef", baseRef);

  try {
    const result = await docuviaApi.review(scopeId, logger);
    spinner.succeed(UI_MESSAGES.REVIEW_SUCCESS + (baseRef ? UI_MESSAGES.REVIEW_AGAINST + baseRef : ""));
    console.log("");
    console.log("Files changed: " + result.filesChanged.length);

    const riskLine = "Risk level: " + result.riskLevel;
    if (result.riskLevel === "CRITICAL") {
      ui.error(riskLine);
    } else if (result.riskLevel === "HIGH") {
      ui.warn(riskLine);
    } else {
      console.log(riskLine);
    }

    console.log("");
    console.log(result.analysis);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error ? error.message : String(error);
    spinner.fail(UI_MESSAGES.REVIEW_FAIL + message);
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
