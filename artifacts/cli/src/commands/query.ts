import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  type LocalQueryResult,
  type GraphEdgeRef,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import {
  QUERY_OUTPUT_FORMATS,
  type QueryOutputFormat,
} from "../constants/cli-flags.js";
import { OUTPUT_FORMAT_MARKERS as FORMAT_MARKERS } from "../constants/cli-output-markers.js";

const XML_TAGS = {
  CONTEXT_START: "<docuvia_context>",
  CONTEXT_END: "</docuvia_context>",
  L2_START_PREFIX: '  <l2_module name="',
  L2_TYPE_MID: '" type="',
  L2_FILE_MID: '" file="',
  L2_START_SUFFIX: '">',
  L2_END: "  </l2_module>",
  L3_START_PREFIX: '    <l3_decision title="',
  L3_START_SUFFIX: '">',
  L3_CONTENT_PREFIX: "      ",
  L3_END: "    </l3_decision>",
  INCOMING_START: "  <incoming>",
  INCOMING_END: "  </incoming>",
  CALLER_PREFIX: '    <caller name="',
  CALLER_MID: '" relation="',
  CALLER_SUFFIX: '" />',
  OUTGOING_START: "  <outgoing>",
  OUTGOING_END: "  </outgoing>",
  CALLEE_PREFIX: '    <callee name="',
  CALLEE_MID: '" relation="',
  CALLEE_SUFFIX: '" />',
} as const;

function buildPromptL2Lines(result: LocalQueryResult): string[] {
  const lines: string[] = [];
  if (result.l2) {
    let openTag = XML_TAGS.L2_START_PREFIX + result.l2.name;
    if (result.l2.type) openTag += XML_TAGS.L2_TYPE_MID + result.l2.type;
    if (result.l2.filePath)
      openTag += XML_TAGS.L2_FILE_MID + result.l2.filePath;
    lines.push(openTag + XML_TAGS.L2_START_SUFFIX);
  }
  for (const l3 of result.l3) {
    lines.push(XML_TAGS.L3_START_PREFIX + l3.title + XML_TAGS.L3_START_SUFFIX);
    lines.push(
      XML_TAGS.L3_CONTENT_PREFIX + (l3.content || FORMAT_MARKERS.EMPTY),
    );
    lines.push(XML_TAGS.L3_END);
  }
  if (result.l2) {
    lines.push(XML_TAGS.L2_END);
  }
  return lines;
}

function buildPromptIncomingLines(incoming: GraphEdgeRef[]): string[] {
  if (incoming.length === 0) return [];
  const lines: string[] = [XML_TAGS.INCOMING_START];
  for (const i of incoming) {
    lines.push(
      XML_TAGS.CALLER_PREFIX +
        i.name +
        XML_TAGS.CALLER_MID +
        i.linkType +
        XML_TAGS.CALLER_SUFFIX,
    );
  }
  lines.push(XML_TAGS.INCOMING_END);
  return lines;
}

function buildPromptOutgoingLines(outgoing: GraphEdgeRef[]): string[] {
  if (outgoing.length === 0) return [];
  const lines: string[] = [XML_TAGS.OUTGOING_START];
  for (const o of outgoing) {
    lines.push(
      XML_TAGS.CALLEE_PREFIX +
        o.name +
        XML_TAGS.CALLEE_MID +
        o.linkType +
        XML_TAGS.CALLEE_SUFFIX,
    );
  }
  lines.push(XML_TAGS.OUTGOING_END);
  return lines;
}

function buildPromptContextLines(result: LocalQueryResult): string[] {
  const incoming = result.context?.incoming ?? [];
  const outgoing = result.context?.outgoing ?? [];
  if (incoming.length === 0 && outgoing.length === 0) return [];
  return [
    ...buildPromptIncomingLines(incoming),
    ...buildPromptOutgoingLines(outgoing),
  ];
}

export function formatPromptOutput(result: LocalQueryResult): string {
  const lines: string[] = [
    XML_TAGS.CONTEXT_START,
    ...buildPromptL2Lines(result),
    ...buildPromptContextLines(result),
    XML_TAGS.CONTEXT_END,
  ];
  return lines.join(FORMAT_MARKERS.NEWLINE);
}

function printHumanL2Header(result: LocalQueryResult): void {
  if (result.l2) {
    let line = UI_MESSAGES.QUERY_L2_PREFIX + result.l2.name;
    if (result.l2.filePath) {
      line +=
        FORMAT_MARKERS.OPEN_PAREN +
        result.l2.filePath +
        FORMAT_MARKERS.CLOSE_PAREN;
    }
    ui.info(line);
  } else {
    ui.warn(UI_MESSAGES.QUERY_NO_L2);
  }
}

function printHumanL3Entries(l3s: LocalQueryResult["l3"]): void {
  for (const l3 of l3s) {
    ui.success(UI_MESSAGES.QUERY_L3_PREFIX + l3.title);
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

function printHumanEdgeList(edges: GraphEdgeRef[], header: string): void {
  if (edges.length === 0) return;
  ui.header(header);
  for (const edge of edges) {
    ui.log(
      FORMAT_MARKERS.INDENT_TWO +
        edge.name +
        FORMAT_MARKERS.OPEN_PAREN +
        edge.linkType +
        FORMAT_MARKERS.CLOSE_PAREN,
    );
  }
  ui.log(FORMAT_MARKERS.EMPTY);
}

function printHumanResults(result: LocalQueryResult): void {
  ui.header(UI_MESSAGES.QUERY_CONTEXT_HEADER);
  printHumanL2Header(result);
  ui.log(FORMAT_MARKERS.EMPTY);
  printHumanL3Entries(result.l3);

  const incoming = result.context?.incoming ?? [];
  const outgoing = result.context?.outgoing ?? [];
  printHumanEdgeList(incoming, UI_MESSAGES.QUERY_INCOMING_HEADER);
  printHumanEdgeList(outgoing, UI_MESSAGES.QUERY_OUTGOING_HEADER);

  ui.log(FORMAT_MARKERS.EMPTY);
}

async function resolveQueryTarget(target?: string): Promise<string> {
  if (target) return target;

  if (!process.stdin.isTTY) {
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
  isPromptFormat: boolean,
  queryTarget: string,
  logger: ReturnType<typeof createPinoBackedLogger>,
): ReturnType<typeof ui.spinner> | undefined {
  if (isPromptFormat) return undefined;

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
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
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
  options: { format?: QueryOutputFormat; limit?: number } = {},
  cwd: string = process.cwd(),
) {
  const queryTarget = await resolveQueryTarget(target);
  const isPromptFormat = options.format === QUERY_OUTPUT_FORMATS.PROMPT;
  const limit = resolveQueryLimit(options.limit);

  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  const spinner = startQuerySpinner(isPromptFormat, queryTarget, logger);

  const result = await runQuery(
    scopeId,
    logger,
    cwd,
    queryTarget,
    limit,
    spinner,
  );
  if (!result) return;

  if (isPromptFormat) {
    ui.log(formatPromptOutput(result));
  } else {
    printHumanResults(result);
  }
}
