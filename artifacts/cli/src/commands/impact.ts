import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  RiskLevels,
  type BlastRadiusEntry,
  type RiskLevel,
  type TierBCoverageHint,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi, type ImpactResult } from "@workspace/ui-core";
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

/** Issue #217: the Source column appears only when at least one entry came from the
 *  ast_call_sites fallback -- a fully-static result keeps its two-column shape, and the mixed
 *  case lets the reader see exactly which dependents are lower-confidence. Split out of
 *  `printBlastRadius` for the ESLint complexity budget. */
function printBlastRadiusTable(blastRadius: BlastRadiusEntry[]): void {
  const hasFallbackEntries = blastRadius.some(
    (entry) => entry.edgeSource !== undefined,
  );
  ui.table(
    [
      { header: UI_MESSAGES.IMPACT_COL_NAME },
      { header: UI_MESSAGES.IMPACT_COL_TYPE },
      ...(hasFallbackEntries
        ? [{ header: UI_MESSAGES.IMPACT_COL_SOURCE }]
        : []),
    ],
    blastRadius.map((entry) => [
      entry.name,
      entry.type,
      ...(hasFallbackEntries
        ? [entry.edgeSource ?? UI_MESSAGES.IMPACT_EDGE_SOURCE_STATIC]
        : []),
    ]),
  );
}

function printBlastRadius(
  blastRadius: BlastRadiusEntry[],
  riskLevel: RiskLevel,
  tierBCoverage?: TierBCoverageHint,
  coverageNote?: string,
  riskNote?: string,
  partialCoverage?: boolean,
): void {
  ui.header(UI_MESSAGES.IMPACT_BLAST_RADIUS_HEADER);

  if (blastRadius.length === 0) {
    ui.warn(UI_MESSAGES.IMPACT_NO_DEPENDENTS);
    if (coverageNote) {
      ui.warn(coverageNote);
    }
    if (
      tierBCoverage &&
      tierBCoverage.workspaceFilesProcessed < tierBCoverage.workspaceFilesTotal
    ) {
      ui.warn(
        UI_MESSAGES.IMPACT_TIER_B_INCOMPLETE(
          tierBCoverage.workspaceFilesTotal -
            tierBCoverage.workspaceFilesProcessed,
          tierBCoverage.workspaceFilesTotal,
        ),
      );
    }
  } else {
    printBlastRadiusTable(blastRadius);
    ui.log(FORMAT_MARKERS.EMPTY);
    for (const entry of blastRadius) {
      printEntryWhy(entry.name, entry.why);
    }
  }

  // Issue #192: partialCoverage flag -- surface when Tier B is incomplete
  if (partialCoverage) {
    ui.warn(
      "Partial Tier B coverage: some workspace files not yet analyzed; blast radius may be incomplete.",
    );
  }

  // Issue #192: an empty result is UNKNOWN (never a false-safe LOW), and a lower-bound result
  // carries the reason -- always surface it so "zero" can never read as a confident answer.
  if (riskNote) {
    ui.warn(UI_MESSAGES.IMPACT_RISK_NOTE_PREFIX + riskNote);
  }

  ui.log(FORMAT_MARKERS.EMPTY);
  const riskLine = UI_MESSAGES.IMPACT_RISK_PREFIX + riskLevel;
  if (riskLevel === RiskLevels.CRITICAL) {
    ui.error(riskLine);
  } else if (
    riskLevel === RiskLevels.HIGH ||
    riskLevel === RiskLevels.UNKNOWN
  ) {
    ui.warn(riskLine);
  } else {
    ui.log(riskLine);
  }
  ui.log(FORMAT_MARKERS.EMPTY);
}

/** Human-mode success rendering -- separated from `impactCommand` to keep its cyclomatic
 *  complexity under the project's ESLint budget (the spinner/table/risk output has enough branches
 *  of its own). */
function printHumanResult(
  result: ImpactResult,
  target: string,
  spinner: ReturnType<typeof ui.spinner>,
): void {
  spinner.succeed(
    UI_MESSAGES.IMPACT_SUCCESS +
      FORMAT_MARKERS.DOUBLE_QUOTE +
      target +
      FORMAT_MARKERS.DOUBLE_QUOTE,
  );
  ui.log("");
  printBlastRadius(
    result.blastRadius,
    result.riskLevel,
    result.tierBCoverage,
    result.coverageNote,
    result.riskNote,
    result.partialCoverage,
  );
}

/** Unresolved-target rendering, human vs `--format=json` -- `null` is a legal JSON literal so a
 *  structured consumer can distinguish "not found" from a found-but-empty blast radius. */
function printNotFound(
  spinner: ReturnType<typeof ui.spinner> | undefined,
  target: string,
): void {
  if (spinner) {
    spinner.warn(
      UI_MESSAGES.IMPACT_NOT_FOUND +
        FORMAT_MARKERS.DOUBLE_QUOTE +
        target +
        FORMAT_MARKERS.DOUBLE_QUOTE,
    );
    return;
  }
  ui.log("null");
}

/**
 * Thin caller of docuviaApi.impact() - mirrors init.ts's Presentation-layer responsibilities.
 * `--format=json` (roadmap item 31) emits the structured `ImpactResult` verbatim on stdout with the
 * banner/spinner suppressed -- a pipe/agent consuming `--format=json` must never see them.
 */
export async function impactCommand(
  target: string,
  options: { format?: CliOutputFormat } = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const isJsonFormat = options.format === CLI_OUTPUT_FORMATS.JSON;
  if (!isJsonFormat) ui.header(UI_MESSAGES.IMPACT_HEADER);

  if (!target) {
    ui.error(UI_MESSAGES.IMPACT_MISSING_TARGET);
    process.exitCode = 1;
    return;
  }

  const spinner = isJsonFormat
    ? undefined
    : ui
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
  wireSpinnerLogs(logger, spinner);

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  docuviaMemory.set(scopeId, MemoryKeys.TARGET, target);

  try {
    const result = await docuviaApi.impact(scopeId, logger);

    if (!result) {
      printNotFound(spinner, target);
      return;
    }

    if (spinner) {
      printHumanResult(result, target, spinner);
    } else {
      ui.log(JSON.stringify(result, null, 2));
    }
  } catch (error: unknown) {
    const message = resolveErrorMessage(error);
    if (spinner) spinner.fail(UI_MESSAGES.IMPACT_FAIL + message);
    else ui.error(UI_MESSAGES.IMPACT_FAIL + message);
    process.exitCode = 1;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
