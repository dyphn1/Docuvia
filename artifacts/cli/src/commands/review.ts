import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  RiskLevels,
  type ChangeDetectionResult,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { OUTPUT_FORMAT_MARKERS as FORMAT_MARKERS } from "../constants/cli-output-markers.js";

/** Surfaces each impacted node's L3 "why" data, if any — mirrors query.ts's L3 display convention. */
function printWhy(affectedNodes: ChangeDetectionResult["affectedNodes"]): void {
  const titleIndent = FORMAT_MARKERS.INDENT_TWO + FORMAT_MARKERS.INDENT_TWO;
  const contentIndent = titleIndent + FORMAT_MARKERS.INDENT_TWO;
  const entriesWithWhy = affectedNodes.flatMap((node) =>
    node.impactedBy
      .filter((entry) => entry.why && entry.why.length > 0)
      .map((entry) => ({ file: node.file, entry })),
  );
  if (entriesWithWhy.length === 0) return;

  ui.log("");
  ui.header(UI_MESSAGES.REVIEW_WHY_HEADER);
  for (const { file, entry } of entriesWithWhy) {
    ui.log(
      FORMAT_MARKERS.INDENT_TWO +
        entry.name +
        FORMAT_MARKERS.OPEN_PAREN +
        file +
        FORMAT_MARKERS.CLOSE_PAREN,
    );
    for (const w of entry.why ?? []) {
      ui.log(titleIndent + UI_MESSAGES.REVIEW_WHY_PREFIX + w.title);
      if (w.content) {
        ui.log(
          contentIndent +
            w.content
              .split(FORMAT_MARKERS.NEWLINE)
              .join(FORMAT_MARKERS.NEWLINE + contentIndent),
        );
      }
    }
  }
}

/** Thin caller of docuviaApi.review() - mirrors init.ts's Presentation-layer responsibilities. */
export async function reviewCommand(
  baseRef?: string,
  cwd: string = process.cwd(),
) {
  ui.header(UI_MESSAGES.REVIEW_HEADER);
  const spinner = ui.spinner(UI_MESSAGES.REVIEW_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  if (baseRef) docuviaMemory.set(scopeId, MemoryKeys.BASE_REF, baseRef);

  try {
    const result = await docuviaApi.review(scopeId, logger);
    spinner.succeed(
      UI_MESSAGES.REVIEW_SUCCESS +
        (baseRef ? UI_MESSAGES.REVIEW_AGAINST + baseRef : ""),
    );
    ui.log("");
    ui.log(UI_MESSAGES.REVIEW_FILES_CHANGED + result.filesChanged.length);

    const riskLine = UI_MESSAGES.REVIEW_RISK_PREFIX + result.riskLevel;
    if (result.riskLevel === RiskLevels.CRITICAL) {
      ui.error(riskLine);
    } else if (result.riskLevel === RiskLevels.HIGH) {
      ui.warn(riskLine);
    } else {
      ui.log(riskLine);
    }

    ui.log("");
    ui.log(result.analysis);
    printWhy(result.affectedNodes);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.REVIEW_FAIL + message);
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
