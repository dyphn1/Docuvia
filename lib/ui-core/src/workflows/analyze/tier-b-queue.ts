import { GitConstants } from "@workspace/core";
import type { IGraphStore } from "@workspace/contracts";

export interface TierBQueueEntry {
  file: string;
  commitSha: string;
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
    return parsed.filter(
      (e): e is TierBQueueEntry =>
        e && typeof e.file === "string" && typeof e.commitSha === "string",
    );
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
