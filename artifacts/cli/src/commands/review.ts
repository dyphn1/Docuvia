import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
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
import {
  CLI_OUTPUT_FORMATS,
  type CliOutputFormat,
} from "../constants/cli-flags.js";
import { OUTPUT_FORMAT_MARKERS as FORMAT_MARKERS } from "../constants/cli-output-markers.js";
import { wireSpinnerLogs } from "../utils/wire-spinner-logs.js";
import { resolveErrorMessage } from "../utils/resolve-error-message.js";

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
  ui.section(UI_MESSAGES.REVIEW_WHY_HEADER);
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

/** Human-mode success rendering -- separated from `reviewCommand` to keep its cyclomatic
 *  complexity under the project's ESLint budget (the risk level + analysis + "why" output has
 *  enough branches of its own). */
function printHumanResult(
  result: ChangeDetectionResult,
  baseRef: string | undefined,
  spinner: ReturnType<typeof ui.spinner>,
): void {
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
}

/** Thin caller of docuviaApi.review() - mirrors init.ts's Presentation-layer responsibilities.
 *  `--format=json` (roadmap item 31) emits the structured `ChangeDetectionResult` verbatim on
 *  stdout with the banner/spinner suppressed -- a pipe/agent consuming `--format=json` must never
 *  see them. */
export async function reviewCommand(
  baseRef?: string,
  options: { format?: CliOutputFormat } = {},
  cwd: string = process.cwd(),
) {
  const isJsonFormat = options.format === CLI_OUTPUT_FORMATS.JSON;
  if (!isJsonFormat) ui.header(UI_MESSAGES.REVIEW_HEADER);
  const spinner = isJsonFormat
    ? undefined
    : ui.spinner(UI_MESSAGES.REVIEW_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  wireSpinnerLogs(logger, spinner);

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  if (baseRef) docuviaMemory.set(scopeId, MemoryKeys.BASE_REF, baseRef);

  try {
    const result = await docuviaApi.review(scopeId, logger);
    if (spinner) {
      printHumanResult(result, baseRef, spinner);
    } else {
      ui.log(JSON.stringify(result, null, 2));
    }
  } catch (error: unknown) {
    const message = resolveErrorMessage(error);
    if (spinner) spinner.fail(UI_MESSAGES.REVIEW_FAIL + message);
    else ui.error(UI_MESSAGES.REVIEW_FAIL + message);
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
