import type { IGitProvider, IGraphStore } from "@workspace/contracts";
import {
  appendTierBQueueEntries,
  type TierBQueueEntry,
} from "./tier-b-queue.js";

/**
 * `analyze --escalate-to-lsp --full`'s queue-population step (typescript-cli-benchmark.md
 * §5.3/§5.7 item 1) -- merges every file `project_files` currently knows about into `tierBQueue`,
 * reusing `appendTierBQueueEntries`'s existing dedup-by-file logic (a file already queued gets its
 * `commitSha` refreshed rather than duplicated). Mirrors `stampFullIngestionForTierB`'s no-op
 * precedent: on an unborn/headless HEAD (no commit to stamp against yet), this is a no-op rather
 * than queueing with a placeholder sha. Everything downstream of `tierBQueue` (dispatch, edge
 * resolution, staged drain, commit-cap accounting) is unchanged by this function -- it only grows
 * what the existing batch machinery reads.
 */
export async function queueFullTierBResync(deps: {
  workspaceRoot: string;
  store: IGraphStore;
  git: IGitProvider;
}): Promise<{ filesQueued: number }> {
  const { workspaceRoot, store, git } = deps;

  const headSha = await git.getHeadSha(workspaceRoot);
  if (!headSha) return { filesQueued: 0 };

  const files = store.files.getAllHashes();
  const entries: TierBQueueEntry[] = files.map((f) => ({
    file: f.filePath,
    commitSha: headSha,
  }));

  await store.withWriteLock(() => {
    appendTierBQueueEntries(store, entries);
  });

  return { filesQueued: entries.length };
}
