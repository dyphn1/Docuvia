import type { IGraphStore } from "@workspace/contracts";
import { GitConstants } from "@workspace/core";

/**
 * D5's commit-cap check, redefined by §9m item 1 (phase1-decision-integration.md) to a
 * cumulative-changed-bytes trigger instead of raw commit count: a single large refactor commit
 * inflates cumulative bytes even though it's only one commit, which a commit-count trigger could
 * never detect no matter how the count is tuned. Reads `tierBChangedBytes`, a running total
 * `run-delta-ingestion.ts`'s `persistDelta` maintains from data Tier A's delta ingestion already
 * computes (no new git call), and that `finalize-pending-tier-b-batch.ts` resets to `0` whenever a
 * Tier B batch is finalized. No git provider or `lastTierBBatchSha` needed at check time anymore —
 * the accumulator itself is the state.
 */
export function isTierBCommitCapExceeded(
  store: IGraphStore,
  cap: number = GitConstants.DEFAULT_TIER_B_COMMIT_CAP_BYTES,
): boolean {
  const changedBytes = Number(
    store.meta.get(GitConstants.META_KEY_TIER_B_CHANGED_BYTES) ?? 0,
  );
  return changedBytes >= cap;
}
