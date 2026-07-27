import {
  docuviaFactory,
  TOKENS,
  type IKnowledgeGitService,
  type ILogger,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { appendSnapshotLogLine } from "./snapshot-log-writer.js";
import { SNAPSHOT_EVENTS } from "./snapshot-messages.js";

interface PendingTierBBatch {
  headSha: string;
  remainingQueue: unknown[];
}

function parsePending(raw: string | undefined): PendingTierBBatch | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingTierBBatch>;
    if (
      typeof parsed.headSha !== "string" ||
      !Array.isArray(parsed.remainingQueue)
    ) {
      return undefined;
    }
    return parsed as PendingTierBBatch;
  } catch {
    return undefined;
  }
}

/**
 * D6/D5's post-pack finalize step (phase1-decision-integration.md §8g, §8f): every successful
 * `snapshot` checks for a Tier B batch staged by `analyze --escalate-to-lsp` (see
 * `run-tier-b-batch.ts`'s `finalizeBatch`) and, if one is pending, commits its two effects now --
 * not before -- exactly matching D6's "the queue is cleared only after a successful snapshot" and
 * D5's "written only after a fully successful batch (post-snapshot)":
 *   1. `tierBQueue` becomes the staged `remainingQueue` (failed entries only -- everything else
 *      the batch handled is drained).
 *   2. `lastTierBBatchSha` becomes the staged `headSha` (seeds/advances the commit-cap baseline).
 *   3. `tierBChangedBytes` (§9m item 1's commit-cap accumulator) resets to `"0"` -- a finalized
 *      batch is exactly the event that should zero the cumulative-changed-bytes trigger.
 * A no-op (cheap: one meta read) when no batch is pending -- the common case for most `snapshot`
 * runs, which have nothing to do with Tier B at all. Never throws -- a corrupt/malformed pending
 * record is treated the same as "nothing pending" rather than failing an otherwise-successful
 * snapshot.
 */
export async function finalizePendingTierBBatch(
  workspaceRoot: string,
  logger: ILogger,
): Promise<void> {
  const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
  const knowledgeGit: IKnowledgeGitService = docuviaFactory.resolve(
    TOKENS.KnowledgeGitService,
    { logger },
  );

  const store = await openStore({
    dbPath: resolveDbPath(workspaceRoot),
    readonly: false,
  });
  try {
    // Clear the Tier C processed flag if present (since this read-write store is opened after packing)
    if (store.meta.get("tierCProcessedThisRun") === "true") {
      await store.withWriteLock(() => {
        store.meta.set("tierCProcessedThisRun", "");
      });
    }

    const pending = parsePending(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING),
    );
    if (!pending) return;

    await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, async () => {
      await store.withWriteLock(() => {
        store.meta.set(
          GitConstants.META_KEY_TIER_B_QUEUE,
          JSON.stringify(pending.remainingQueue),
        );
        store.meta.set(
          GitConstants.META_KEY_LAST_TIER_B_BATCH_SHA,
          pending.headSha,
        );
        store.meta.set(GitConstants.META_KEY_TIER_B_CHANGED_BYTES, "0");
        // Sentinel clear -- IMetaRepo has no delete(); an empty string reads back falsy in
        // parsePending()/readTierBQueue()'s own "!raw" guards.
        store.meta.set(GitConstants.META_KEY_TIER_B_BATCH_PENDING, "");
      });
    });

    await appendSnapshotLogLine(workspaceRoot, {
      event: SNAPSHOT_EVENTS.TIER_B_FINALIZED,
      headSha: pending.headSha,
      remainingQueueSize: pending.remainingQueue.length,
    });
  } finally {
    await store.close();
  }
}
