import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  RiskLevels,
  type BlastRadiusEntry,
  type RiskLevel,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { OUTPUT_FORMAT_MARKERS as FORMAT_MARKERS } from "../constants/cli-output-markers.js";

/** Prints one blast-radius entry's L3 "why" data, labeled by name -- separated from the Name/Type
 *  table above it (`ui.table`), since decision content is prose-length and doesn't fit a cell. */
function printEntryWhy(entryName: string, why: BlastRadiusEntry["why"]): void {
  if (!why || why.length === 0) return;
  const nameIndent = FORMAT_MARKERS.INDENT_TWO;
  const titleIndent = nameIndent + FORMAT_MARKERS.INDENT_TWO;
  const contentIndent = titleIndent + FORMAT_MARKERS.INDENT_TWO;
  ui.log(nameIndent + UI_MESSAGES.IMPACT_ENTRY_WHY_LABEL(entryName));
  for (const w of why) {
    ui.log(titleIndent + UI_MESSAGES.IMPACT_WHY_PREFIX + w.title);
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

function printBlastRadius(
  blastRadius: BlastRadiusEntry[],
  riskLevel: RiskLevel,
): void {
  ui.header(UI_MESSAGES.IMPACT_BLAST_RADIUS_HEADER);

  if (blastRadius.length === 0) {
    ui.warn(UI_MESSAGES.IMPACT_NO_DEPENDENTS);
  } else {
    ui.table(
      [
        { header: UI_MESSAGES.IMPACT_COL_NAME },
        { header: UI_MESSAGES.IMPACT_COL_TYPE },
      ],
      blastRadius.map((entry) => [entry.name, entry.type]),
    );
    ui.log(FORMAT_MARKERS.EMPTY);
    for (const entry of blastRadius) {
      printEntryWhy(entry.name, entry.why);
    }
  }

  ui.log(FORMAT_MARKERS.EMPTY);
  const riskLine = UI_MESSAGES.IMPACT_RISK_PREFIX + riskLevel;
  if (riskLevel === RiskLevels.CRITICAL) {
    ui.error(riskLine);
  } else if (riskLevel === RiskLevels.HIGH) {
    ui.warn(riskLine);
  } else {
    ui.log(riskLine);
  }
  ui.log(FORMAT_MARKERS.EMPTY);
}

/**
 * Thin caller of docuviaApi.impact() - mirrors init.ts's Presentation-layer responsibilities.
 */
export async function impactCommand(
  target: string,
  cwd: string = process.cwd(),
): Promise<void> {
  ui.header(UI_MESSAGES.IMPACT_HEADER);

  if (!target) {
    ui.error(UI_MESSAGES.IMPACT_MISSING_TARGET);
    process.exitCode = 1;
    return;
  }

  const spinner = ui
    .spinner(
      UI_MESSAGES.IMPACT_START +
        FORMAT_MARKERS.DOUBLE_QUOTE +
        target +
        FORMAT_MARKERS.DOUBLE_QUOTE +
        FORMAT_MARKERS.ELLIPSIS,
    )
    .start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  docuviaMemory.set(scopeId, MemoryKeys.TARGET, target);

  try {
    const result = await docuviaApi.impact(scopeId, logger);

    if (!result) {
      spinner.warn(
        UI_MESSAGES.IMPACT_NOT_FOUND +
          FORMAT_MARKERS.DOUBLE_QUOTE +
          target +
          FORMAT_MARKERS.DOUBLE_QUOTE,
      );
      return;
    }

    spinner.succeed(
      UI_MESSAGES.IMPACT_SUCCESS +
        FORMAT_MARKERS.DOUBLE_QUOTE +
        target +
        FORMAT_MARKERS.DOUBLE_QUOTE,
    );
    ui.log("");
    printBlastRadius(result.blastRadius, result.riskLevel);
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.IMPACT_FAIL + message);
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
