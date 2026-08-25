import type { L3NodeRow } from "@workspace/contracts";
import { ValidityStatuses } from "@workspace/contracts";
import type { ExtractedDecision } from "./analyze-result.js";

/**
 * One deterministic contradiction between an about-to-be-persisted decision and a decision
 * already anchored to the same `l2_node_id` (issue #68's writer-side check): the two make the
 * *same titled claim* but with divergent content, so one of them is wrong or stale. Surfaced as
 * a warning only -- never blocks the write (`upsertDecision`'s content-hash union is untouched).
 */
export interface L3Contradiction {
  /** The incoming (not-yet-written) decision's title, verbatim. */
  stagedTitle: string;
  existingId: number;
  existingTitle: string;
  /** `l3_nodes.source` of the surviving row ("analyze" / "agent-authored" / "git-import"). */
  existingSource: string;
  /** HEAD sha the surviving row was written at, when known. */
  existingCommitHash: string | null;
}

/** Whitespace-insensitive, case-insensitive title key -- "Switched to JWT" and "switched  to
 *  jwt" are the same claim; anything else is not a contradiction under this rule. */
function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Whitespace-normalized content comparison -- a re-worded explanation counts as divergence;
 *  formatting-only differences (trailing newline, indentation) do not. */
function normalizeContent(content: string | null): string {
  return (content ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Deterministic (zero-LLM) writer-side contradiction detection, issue #68's "flush-time
 * writer-side check": pairs each incoming decision with every non-garbage existing row sharing
 * its anchor whose normalized title matches while its normalized content differs. Exact
 * duplicates never reach this rule (`upsertDecision`'s content-hash dedup turns them into
 * occurrence bumps), and superseded/garbage rows are excluded so history doesn't false-positive
 * against a fresh re-statement of the same rationale.
 */
export function findAnchorContradictions(
  existingRows: L3NodeRow[],
  decisions: ExtractedDecision[],
): L3Contradiction[] {
  const live = existingRows.filter(
    (row) => row.validity_status !== ValidityStatuses.GARBAGE,
  );
  const contradictions: L3Contradiction[] = [];
  for (const decision of decisions) {
    const stagedKey = normalizeTitle(decision.title);
    const stagedContent = normalizeContent(decision.content);
    for (const row of live) {
      if (normalizeTitle(row.title) !== stagedKey) continue;
      if (normalizeContent(row.content) === stagedContent) continue;
      contradictions.push({
        stagedTitle: decision.title,
        existingId: row.id,
        existingTitle: row.title,
        existingSource: row.source,
        existingCommitHash: row.commit_hash,
      });
    }
  }
  return contradictions;
}
