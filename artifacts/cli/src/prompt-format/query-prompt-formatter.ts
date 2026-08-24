import {
  type LocalQueryResult,
  type GraphEdgeRef,
  type TierBCoverageHint,
} from "@workspace/contracts";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { OUTPUT_FORMAT_MARKERS as FORMAT_MARKERS } from "../constants/cli-output-markers.js";

export const XML_TAGS = {
  CONTEXT_START: "<docuvia_context>",
  CONTEXT_END: "</docuvia_context>",
  L2_START_PREFIX: '  <l2_module name="',
  L2_TYPE_MID: '" type="',
  L2_FILE_MID: '" file="',
  L2_MATCH_TYPE_MID: '" match_type="',
  L2_START_SUFFIX: '">',
  L2_END: "  </l2_module>",
  L3_START_PREFIX: '    <l3_decision title="',
  /** Provenance attribute separators for `<l3_decision>` (issue #68, provenance axis) — each
   *  attribute is rendered only when the entry actually carries the field, so legacy
   *  `{title, content}` fixtures and vanished-row fallbacks keep the old bare-tag shape. */
  L3_SOURCE_MID: '" source="',
  L3_CONFIDENCE_MID: '" confidence="',
  L3_COMMIT_MID: '" commit="',
  L3_CREATED_AT_MID: '" created_at="',
  L3_VALIDITY_MID: '" validity="',
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
  /** typescript-cli-benchmark.md §5.3/§5.7 item 2 -- additive "not yet Tier B-processed" hint,
   *  only rendered where nothing would otherwise appear (empty edge list + an unconfirmed-zero
   *  coverage hint). Deliberately a distinct, self-closing shape from `<caller>`/`<callee>` so
   *  nothing that parses those specifically is affected. */
  INCOMING_UNPROCESSED_PREFIX: '  <incoming tier_b_status="unprocessed" note="',
  OUTGOING_UNPROCESSED_PREFIX: '  <outgoing tier_b_status="unprocessed" note="',
  UNPROCESSED_SUFFIX: '" />',
} as const;

/** Builds `<l3_decision ...>`'s opening tag, appending provenance attributes (source /
 *  confidence / commit / created_at / validity) only when the entry carries them — a missing
 *  field means "unknown", never a fabricated default (issue #68, provenance axis). */
function buildL3OpenTag(l3: LocalQueryResult["l3"][number]): string {
  let tag = XML_TAGS.L3_START_PREFIX + l3.title;
  if (l3.source) tag += XML_TAGS.L3_SOURCE_MID + l3.source;
  if (l3.confidence !== undefined && l3.confidence !== null)
    tag += XML_TAGS.L3_CONFIDENCE_MID + String(l3.confidence);
  if (l3.commitHash) tag += XML_TAGS.L3_COMMIT_MID + l3.commitHash;
  if (l3.createdAt) tag += XML_TAGS.L3_CREATED_AT_MID + l3.createdAt;
  if (l3.validityStatus) tag += XML_TAGS.L3_VALIDITY_MID + l3.validityStatus;
  return tag + XML_TAGS.L3_START_SUFFIX;
}

function buildPromptL2Lines(result: LocalQueryResult): string[] {
  const lines: string[] = [];
  if (result.l2) {
    let openTag = XML_TAGS.L2_START_PREFIX + result.l2.name;
    if (result.l2.type) openTag += XML_TAGS.L2_TYPE_MID + result.l2.type;
    if (result.l2.filePath)
      openTag += XML_TAGS.L2_FILE_MID + result.l2.filePath;
    openTag += XML_TAGS.L2_MATCH_TYPE_MID + result.l2.matchType;
    lines.push(openTag + XML_TAGS.L2_START_SUFFIX);
  }
  for (const l3 of result.l3) {
    lines.push(buildL3OpenTag(l3));
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

function buildPromptIncomingLines(
  incoming: GraphEdgeRef[],
  coverage?: TierBCoverageHint,
): string[] {
  if (incoming.length > 0) {
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
  if (
    coverage &&
    coverage.workspaceFilesProcessed < coverage.workspaceFilesTotal
  ) {
    return [
      XML_TAGS.INCOMING_UNPROCESSED_PREFIX +
        UI_MESSAGES.QUERY_TIER_B_INCOMING_UNPROCESSED(
          coverage.workspaceFilesTotal - coverage.workspaceFilesProcessed,
          coverage.workspaceFilesTotal,
        ) +
        XML_TAGS.UNPROCESSED_SUFFIX,
    ];
  }
  return [];
}

function buildPromptOutgoingLines(
  outgoing: GraphEdgeRef[],
  coverage?: TierBCoverageHint,
): string[] {
  if (outgoing.length > 0) {
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
  if (coverage && coverage.ownFileLastProcessedAt === null) {
    return [
      XML_TAGS.OUTGOING_UNPROCESSED_PREFIX +
        UI_MESSAGES.QUERY_TIER_B_OUTGOING_UNPROCESSED +
        XML_TAGS.UNPROCESSED_SUFFIX,
    ];
  }
  return [];
}

function buildPromptContextLines(result: LocalQueryResult): string[] {
  const incoming = result.context?.incoming ?? [];
  const outgoing = result.context?.outgoing ?? [];
  const coverage = result.context?.tierBCoverage;
  if (incoming.length === 0 && outgoing.length === 0 && !coverage) return [];
  return [
    ...buildPromptIncomingLines(incoming, coverage),
    ...buildPromptOutgoingLines(outgoing, coverage),
  ];
}

/** The agent-facing `<docuvia_context>` rendering of a query result -- shared by the CLI's
 *  `query --format=prompt` and the `docuvia_query` MCP tool so both surfaces emit byte-identical
 *  context blocks (issue #190). */
export function formatPromptOutput(result: LocalQueryResult): string {
  const lines: string[] = [
    XML_TAGS.CONTEXT_START,
    ...buildPromptL2Lines(result),
    ...buildPromptContextLines(result),
    XML_TAGS.CONTEXT_END,
  ];
  return lines.join(FORMAT_MARKERS.NEWLINE);
}
