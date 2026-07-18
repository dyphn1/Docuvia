import type {
  IGitProvider,
  SemanticDiffModifiedNode,
} from "@workspace/contracts";
import { toNodeKey } from "./anchor-resolution.js";
import { TierCCandidateKinds, type TierCQueueEntry } from "./tier-c-queue.js";
import {
  shouldEnqueueCommitMessage,
  type TierCCommitFilterOptions,
} from "./tier-c-commit-filter.js";

/** `SemanticPruningLevel`'s `CONTRACT_CHANGED` value (mirrors the `f.pruningLevel === 1` check
 *  `run-delta-ingestion.ts`'s `isContractChanged` already uses for the Tier B queue). */
const CONTRACT_CHANGED_PRUNING_LEVEL = 1;

/** Bounds the commit-log walk `collectCommitMessageCandidates` performs when resolving the delta
 *  range's individual commits -- generous relative to a typical pre-push batch (the same order of
 *  magnitude as `IGitProvider.getCommitLog`'s own 1000 default), while still bounding worst-case
 *  cost on a delta that spans an unusually large number of commits. */
const COMMIT_LOG_WALK_CAP = 500;

/**
 * Tier C's commit-message candidate source (phase1-decision-integration.md §9b/§9e) -- walks
 * `headSha`'s commit log back to (but excluding) `fromSha`, applying §9e's semantic filter at
 * enqueue time so junk commits never occupy queue space. A `fromSha` not found within
 * `COMMIT_LOG_WALK_CAP` commits (an unusually large delta) simply yields candidates for the
 * commits that were walked -- a safe, bounded-cost approximation, not a correctness requirement.
 */
export async function collectCommitMessageCandidates(
  git: IGitProvider,
  workspaceRoot: string,
  fromSha: string,
  headSha: string,
  filterOptions?: TierCCommitFilterOptions,
): Promise<TierCQueueEntry[]> {
  const log = await git.getCommitLog(
    workspaceRoot,
    headSha,
    COMMIT_LOG_WALK_CAP,
  );

  const candidates: TierCQueueEntry[] = [];
  for (const { sha, message } of log) {
    if (sha === fromSha) break;
    if (!shouldEnqueueCommitMessage(message, filterOptions)) continue;
    candidates.push({
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: sha,
      commitSha: sha,
      message,
    });
  }
  return candidates;
}

/**
 * Tier C's `CONTRACT_CHANGED`-symbol candidate source (phase1-decision-integration.md §9b) --
 * turns each `CONTRACT_CHANGED` finding from `ISemanticDiffAnalyzer.analyzeFile` (the same
 * detector pass Tier A already runs to populate `tierBQueue`) into a Tier C candidate keyed by
 * its STOR-005 `node_key` (`<file>#<symbolName>`, mirroring `anchor-resolution.ts`'s convention).
 */
export function collectContractSymbolCandidates(
  file: string,
  headSha: string,
  findings: SemanticDiffModifiedNode[],
): TierCQueueEntry[] {
  return findings
    .filter((f) => f.pruningLevel === CONTRACT_CHANGED_PRUNING_LEVEL)
    .map((f) => ({
      kind: TierCCandidateKinds.CONTRACT_SYMBOL,
      target: `${toNodeKey(file)}#${f.nodeId}`,
      commitSha: headSha,
      file,
    }));
}
