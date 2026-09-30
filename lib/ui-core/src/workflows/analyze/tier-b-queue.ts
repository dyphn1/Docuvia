import { GitConstants } from "@workspace/contracts";
import type { IGraphStore } from "@workspace/contracts";

export interface TierBQueueEntry {
  file: string;
  commitSha: string;
}

function isTierBQueueEntry(entry: unknown): entry is TierBQueueEntry {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as Partial<TierBQueueEntry>;
  return (
    typeof candidate.file === "string" &&
    typeof candidate.commitSha === "string"
  );
}

/** Parses the `tierBQueue` docuvia_meta key (JSON array of `{file, commitSha}`, §6b). Tolerates a
 *  missing/corrupt value by returning `[]` rather than throwing — `local.db` is disposable (git
 *  remains the source of truth), so a malformed queue is not worth failing an `analyze` run over. */
export function readTierBQueue(store: IGraphStore): TierBQueueEntry[] {
  const raw = store.meta.get(GitConstants.META_KEY_TIER_B_QUEUE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTierBQueueEntry);
  } catch {
    return [];
  }
}

/**
 * Read-modify-write append into the `tierBQueue` docuvia_meta key, deduped by `file` (§6b) — a
 * file already queued gets its `commitSha` refreshed to the newest one rather than a duplicate
 * entry. Caller is responsible for wrapping this in `store.withWriteLock()` (and, per §6b's
 * locking requirement, the knowledge-branch lock) alongside whatever else the same persist step
 * writes, so the read-modify-write round trip is atomic with respect to concurrent `analyze` runs.
 */
export function appendTierBQueueEntries(
  store: IGraphStore,
  entries: TierBQueueEntry[],
): void {
  if (entries.length === 0) return;

  const existing = readTierBQueue(store);
  const byFile = new Map(existing.map((e) => [e.file, e]));
  for (const entry of entries) byFile.set(entry.file, entry);

  store.meta.set(
    GitConstants.META_KEY_TIER_B_QUEUE,
    JSON.stringify(Array.from(byFile.values())),
  );
}

/** Removes retired paths from both the active queue and any batch waiting for snapshot
 *  finalization, so a later Tier B drain cannot recreate their `project_files` rows. */
export function removeTierBQueueEntriesForFiles(
  store: IGraphStore,
  files: Iterable<string>,
): void {
  const retiredFiles = new Set(files);
  if (retiredFiles.size === 0) return;

  const queue = readTierBQueue(store);
  const remainingQueue = queue.filter((entry) => !retiredFiles.has(entry.file));
  if (remainingQueue.length !== queue.length) {
    store.meta.set(
      GitConstants.META_KEY_TIER_B_QUEUE,
      JSON.stringify(remainingQueue),
    );
  }

  const pendingRaw = store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING);
  if (!pendingRaw) return;

  try {
    const pending: unknown = JSON.parse(pendingRaw);
    if (!pending || typeof pending !== "object" || Array.isArray(pending))
      return;

    const pendingBatch = pending as { remainingQueue?: unknown };
    if (!Array.isArray(pendingBatch.remainingQueue)) return;

    const pendingRemaining = pendingBatch.remainingQueue.filter(
      (entry) => !isTierBQueueEntry(entry) || !retiredFiles.has(entry.file),
    );
    if (pendingRemaining.length === pendingBatch.remainingQueue.length) return;

    store.meta.set(
      GitConstants.META_KEY_TIER_B_BATCH_PENDING,
      JSON.stringify({ ...pending, remainingQueue: pendingRemaining }),
    );
  } catch {
    return;
  }
}
