import { GitConstants } from "@workspace/core";
import type {
  IGitProvider,
  IGraphStore,
  ParsedAstFileResult,
} from "@workspace/contracts";
import {
  appendTierBQueueEntries,
  type TierBQueueEntry,
} from "../analyze/tier-b-queue.js";

/**
 * Stamps `META_KEY_LAST_INGESTED_SOURCE_SHA` to the current HEAD and queues every just-parsed
 * file for Tier B (LSP cross-file edge resolution) -- the step that makes a from-scratch parse
 * resolvable by a later `analyze --escalate-to-lsp`. Shared by `init`'s own parse+persist phase
 * and `analyze`'s empty-graph full-ingestion branch (`run-full-ingestion.ts`) so the two can never
 * drift again: they used to duplicate this block, and `init` silently lacked it, leaving files
 * parsed by `docuvia init` permanently un-queued for Tier B unless they were touched again by a
 * later commit. No-op on an unborn/headless HEAD (no commit to stamp against yet).
 */
export async function stampFullIngestionForTierB(deps: {
  store: IGraphStore;
  git: IGitProvider;
  workspaceRoot: string;
  parsedResults: ParsedAstFileResult[];
}): Promise<void> {
  const { store, git, workspaceRoot, parsedResults } = deps;

  const headSha = await git.getHeadSha(workspaceRoot);
  if (!headSha) return;

  const tierBEntries: TierBQueueEntry[] = parsedResults.map((r) => ({
    file: r.file,
    commitSha: headSha,
  }));
  await store.withWriteLock(() => {
    store.meta.set(GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA, headSha);
    if (tierBEntries.length > 0) {
      appendTierBQueueEntries(store, tierBEntries);
    }
  });
}
