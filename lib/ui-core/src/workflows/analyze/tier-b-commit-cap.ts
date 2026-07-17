import type { IGitProvider } from "@workspace/contracts";
import { GitConstants } from "@workspace/core";

/**
 * D5's derived (no-counter) commit-cap check (phase1-decision-integration.md §8f): "cap check =
 * `rev-list --count lastTierBBatchSha..HEAD` >= N". Implemented on top of the existing
 * `IGitProvider.getCommitAncestry` (HEAD's ancestry, newest first) rather than a new git
 * primitive -- the index of `lastTierBBatchSha` within the first `cap + 1` ancestry entries is
 * exactly that `rev-list --count` value. A `lastTierBBatchSha` absent from the ancestry window
 * (not found in the probed depth) is treated as "at least `cap + 1`", i.e. exceeded -- a safe
 * failure mode (an extra Tier B attempt, never a missed one).
 *
 * `lastTierBBatchSha` being `undefined` (key absent, pre-Slice-3 workspace or no batch has ever
 * completed) means the cap trigger stays inactive (§8f), independent of this function.
 */
export async function isTierBCommitCapExceeded(
  git: IGitProvider,
  workspaceRoot: string,
  lastTierBBatchSha: string | undefined,
  cap: number = GitConstants.DEFAULT_TIER_B_COMMIT_CAP,
): Promise<boolean> {
  if (!lastTierBBatchSha) return false;

  const ancestry = await git.getCommitAncestry(
    workspaceRoot,
    GitConstants.HEAD_REF,
    cap + 1,
  );
  const index = ancestry.indexOf(lastTierBBatchSha);
  if (index === -1) return ancestry.length > cap;
  return index >= cap;
}
