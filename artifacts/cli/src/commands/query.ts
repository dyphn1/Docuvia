import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  type LocalQueryResult,
  type GraphEdgeRef,
  type TierBCoverageHint,
  type QueryMatchType,
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
import { resolveErrorMessage } from "../utils/resolve-error-message.js";
import { formatPromptOutput } from "../prompt-format/query-prompt-formatter.js";

export { formatPromptOutput };

/** Human-readable mirror of the prompt-format `match_type` attribute -- see
 *  `UI_MESSAGES.QUERY_MATCH_TYPE_EXACT`'s doc comment. */
const QUERY_MATCH_TYPE_HINTS: Record<QueryMatchType, string> = {
  exact: UI_MESSAGES.QUERY_MATCH_TYPE_EXACT,
  keyword: UI_MESSAGES.QUERY_MATCH_TYPE_KEYWORD,
  neighbor: UI_MESSAGES.QUERY_MATCH_TYPE_NEIGHBOR,
};

function printHumanL2Header(result: LocalQueryResult): void {
  if (result.l2) {
    let line = UI_MESSAGES.QUERY_L2_PREFIX + result.l2.name;
    if (result.l2.filePath) {
      line +=
        FORMAT_MARKERS.OPEN_PAREN +
        result.l2.filePath +
        FORMAT_MARKERS.CLOSE_PAREN;
    }
    line += QUERY_MATCH_TYPE_HINTS[result.l2.matchType];
    ui.info(line);
  } else {
    ui.warn(UI_MESSAGES.QUERY_NO_L2);
  }
}

/** Builds the human-readable provenance suffix for one L3 entry — the mirror of
 *  `formatPromptOutput`'s `<l3_decision>` provenance attributes (issue #68). Only fields the
 *  entry actually carries are listed; an empty result means no suffix is printed. */
function resolveHumanL3ProvenanceParts(
  l3: LocalQueryResult["l3"][number],
): string[] {
  const parts: string[] = [];
  if (l3.source) parts.push(`source=${l3.source}`);
  if (l3.commitHash)
    parts.push(
      `commit=${l3.commitHash.slice(0, FORMAT_MARKERS.SHORT_SHA_LENGTH)}`,
    );
  if (l3.validityStatus) parts.push(`validity=${l3.validityStatus}`);
  return parts;
}

function printHumanL3Entries(l3s: LocalQueryResult["l3"]): void {
  for (const l3 of l3s) {
    const provenanceParts = resolveHumanL3ProvenanceParts(l3);
    ui.success(
      UI_MESSAGES.QUERY_L3_PREFIX +
        l3.title +
        (provenanceParts.length > 0
          ? UI_MESSAGES.QUERY_L3_PROVENANCE(provenanceParts)
          : ""),
    );
    if (l3.content) {
      ui.log(
        FORMAT_MARKERS.INDENT_TWO +
          l3.content
            .split(FORMAT_MARKERS.NEWLINE)
            .join(FORMAT_MARKERS.NEWLINE + FORMAT_MARKERS.INDENT_TWO),
      );
    }
    ui.log(FORMAT_MARKERS.EMPTY);
  }
}

function printHumanEdgeList(
  edges: GraphEdgeRef[],
  header: string,
  unprocessedWarning?: string,
): void {
  if (edges.length === 0) {
    if (!unprocessedWarning) return;
    ui.section(header);
    ui.warn(unprocessedWarning);
    ui.log(FORMAT_MARKERS.EMPTY);
    return;
  }
  ui.section(header);
  ui.table(
    [
      { header: UI_MESSAGES.QUERY_COL_NAME },
      { header: UI_MESSAGES.QUERY_COL_RELATION },
    ],
    edges.map((edge) => [edge.name, edge.linkType]),
  );
  ui.log(FORMAT_MARKERS.EMPTY);
}

/** `printHumanResults`'s incoming-direction unprocessed-warning text, split out purely to keep
 *  that function's cyclomatic complexity under the project's ESLint budget. */
function resolveIncomingUnprocessedWarning(
  incomingEmpty: boolean,
  coverage: TierBCoverageHint | undefined,
): string | undefined {
  if (
    !incomingEmpty ||
    !coverage ||
    coverage.workspaceFilesProcessed >= coverage.workspaceFilesTotal
  ) {
    return undefined;
  }
  return UI_MESSAGES.QUERY_TIER_B_INCOMING_UNPROCESSED(
    coverage.workspaceFilesTotal - coverage.workspaceFilesProcessed,
    coverage.workspaceFilesTotal,
  );
}

/** `printHumanResults`'s outgoing-direction unprocessed-warning text -- see
 *  `resolveIncomingUnprocessedWarning`'s doc comment. */
function resolveOutgoingUnprocessedWarning(
  outgoingEmpty: boolean,
  coverage: TierBCoverageHint | undefined,
): string | undefined {
  if (!outgoingEmpty || !coverage || coverage.ownFileLastProcessedAt !== null) {
    return undefined;
  }
  return UI_MESSAGES.QUERY_TIER_B_OUTGOING_UNPROCESSED;
}

function printHumanResults(result: LocalQueryResult): void {
  ui.header(UI_MESSAGES.QUERY_CONTEXT_HEADER);
  printHumanL2Header(result);
  ui.log(FORMAT_MARKERS.EMPTY);
  printHumanL3Entries(result.l3);

  const incoming = result.context?.incoming ?? [];
  const outgoing = result.context?.outgoing ?? [];
  const coverage = result.context?.tierBCoverage;
  const incomingWarning = resolveIncomingUnprocessedWarning(
    incoming.length === 0,
    coverage,
  );
  const outgoingWarning = resolveOutgoingUnprocessedWarning(
    outgoing.length === 0,
    coverage,
  );
  printHumanEdgeList(
    incoming,
    UI_MESSAGES.QUERY_INCOMING_HEADER,
    incomingWarning,
  );
  printHumanEdgeList(
    outgoing,
    UI_MESSAGES.QUERY_OUTGOING_HEADER,
    outgoingWarning,
  );

  ui.log(FORMAT_MARKERS.EMPTY);
}

async function resolveQueryTarget(
  target: string | undefined,
  isInteractive: boolean,
): Promise<string> {
  if (target) return target;

  // Prompt is opt-in (IFCE-004) -- only when --interactive/-i was passed.
  if (!isInteractive) {
    ui.error(UI_MESSAGES.QUERY_MISSING_TARGET);
    process.exit(1);
  }

  ui.header(UI_MESSAGES.QUERY_HEADER);
  const queryTarget = await ui.askInput(UI_MESSAGES.QUERY_PROMPT_TARGET);

  if (!queryTarget) {
    ui.error(UI_MESSAGES.QUERY_MISSING_TARGET_NON_TTY);
    process.exit(1);
  }

  return queryTarget;
}

function resolveQueryLimit(limit: number | undefined): number | undefined {
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    ui.warn(UI_MESSAGES.QUERY_INVALID_LIMIT + limit);
    return undefined;
  }
  return limit;
}

function startQuerySpinner(
  isStructuredFormat: boolean,
  queryTarget: string,
  logger: ReturnType<typeof createPinoBackedLogger>,
): ReturnType<typeof ui.spinner> | undefined {
  // `prompt`/`json` write machine-readable stdout (XML/JSON) -- a spinner would corrupt the pipe.
  if (isStructuredFormat) return undefined;

  const spinner = ui
    .spinner(
      UI_MESSAGES.QUERY_START +
        FORMAT_MARKERS.DOUBLE_QUOTE +
        queryTarget +
        FORMAT_MARKERS.DOUBLE_QUOTE +
        FORMAT_MARKERS.ELLIPSIS,
    )
    .start();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });
  return spinner;
}

async function runQuery(
  scopeId: string,
  logger: ReturnType<typeof createPinoBackedLogger>,
  cwd: string,
  queryTarget: string,
  limit: number | undefined,
  spinner: ReturnType<typeof ui.spinner> | undefined,
): Promise<LocalQueryResult | undefined> {
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  docuviaMemory.set(scopeId, MemoryKeys.TARGET, queryTarget);
  if (limit !== undefined) docuviaMemory.set(scopeId, MemoryKeys.LIMIT, limit);

  try {
    const result = await docuviaApi.query(scopeId, logger);
    if (spinner) {
      spinner.succeed(
        UI_MESSAGES.QUERY_FOUND +
          FORMAT_MARKERS.DOUBLE_QUOTE +
          queryTarget +
          FORMAT_MARKERS.DOUBLE_QUOTE,
      );
      ui.log("");
    }
    return result;
  } catch (error: unknown) {
    const message = resolveErrorMessage(error);
    if (spinner) spinner.fail(UI_MESSAGES.QUERY_FAIL + message);
    else ui.error(UI_MESSAGES.QUERY_FAIL + message);
    process.exitCode = 1;
    return undefined;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

/** Thin caller of docuviaApi.query() - mirrors init.ts's Presentation-layer responsibilities. */
export async function queryCommand(
  target?: string,
  options: { format?: CliOutputFormat; limit?: number } = {},
  cwd: string = process.cwd(),
  isInteractive: boolean = false,
) {
  const queryTarget = await resolveQueryTarget(target, isInteractive);
  const isStructuredFormat =
    options.format === CLI_OUTPUT_FORMATS.PROMPT ||
    options.format === CLI_OUTPUT_FORMATS.JSON;
  const limit = resolveQueryLimit(options.limit);

  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  const spinner = startQuerySpinner(isStructuredFormat, queryTarget, logger);

  const result = await runQuery(
    scopeId,
    logger,
    cwd,
    queryTarget,
    limit,
    spinner,
  );
  if (!result) return;

  if (options.format === CLI_OUTPUT_FORMATS.JSON) {
    ui.log(JSON.stringify(result, null, 2));
  } else if (options.format === CLI_OUTPUT_FORMATS.PROMPT) {
    ui.log(formatPromptOutput(result));
  } else {
    printHumanResults(result);
  }
}
