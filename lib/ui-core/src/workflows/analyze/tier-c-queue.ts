import { GitConstants } from "@workspace/core";
import type { IGraphStore } from "@workspace/contracts";

/** Tier C candidate kinds (phase1-decision-integration.md §9c/E2) -- the two extraction sources
 *  PLAT-007 names for Tier C: commit messages and `CONTRACT_CHANGED` symbols. */
export const TierCCandidateKinds = {
  COMMIT_MESSAGE: "commitMessage",
  CONTRACT_SYMBOL: "contractSymbol",
} as const;
export type TierCCandidateKind =
  (typeof TierCCandidateKinds)[keyof typeof TierCCandidateKinds];

export interface TierCQueueEntry {
  kind: TierCCandidateKind;
  /** Dedup key (§9c): a commit sha for `commitMessage`, a `node_key` for `contractSymbol`. */
  target: string;
  /** Commit sha this candidate is associated with -- equals `target` for `commitMessage`. */
  commitSha: string;
  /** Repo-relative file path -- `contractSymbol` candidates only. */
  file?: string;
  /** Full commit message text, captured at enqueue time -- `commitMessage` candidates only. */
  message?: string;
}

/** Parses the `tierCQueue` docuvia_meta key (JSON array of `TierCQueueEntry`, §9c). Tolerates a
 *  missing/corrupt value by returning `[]` rather than throwing -- `local.db` is disposable, so a
 *  malformed queue is not worth failing an `analyze` run over (mirrors `readTierBQueue`). */
export function readTierCQueue(store: IGraphStore): TierCQueueEntry[] {
  const raw = store.meta.get(GitConstants.META_KEY_TIER_C_QUEUE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

function isValidEntry(e: unknown): e is TierCQueueEntry {
  if (!e || typeof e !== "object") return false;
  const entry = e as Partial<TierCQueueEntry>;
  return (
    (entry.kind === TierCCandidateKinds.COMMIT_MESSAGE ||
      entry.kind === TierCCandidateKinds.CONTRACT_SYMBOL) &&
    typeof entry.target === "string" &&
    typeof entry.commitSha === "string"
  );
}

/**
 * Read-modify-write append into the `tierCQueue` docuvia_meta key, deduped by `target` (§9c) --
 * a target already queued gets refreshed (newer commitSha/message/file) rather than duplicated.
 * Caller is responsible for wrapping this in `store.withWriteLock()` (mirrors
 * `appendTierBQueueEntries`).
 */
export function appendTierCQueueEntries(
  store: IGraphStore,
  entries: TierCQueueEntry[],
): void {
  if (entries.length === 0) return;

  const existing = readTierCQueue(store);
  const byTarget = new Map(existing.map((e) => [e.target, e]));
  for (const entry of entries) byTarget.set(entry.target, entry);

  store.meta.set(
    GitConstants.META_KEY_TIER_C_QUEUE,
    JSON.stringify(Array.from(byTarget.values())),
  );
}

/** Read-modify-write removal of `targets` from the `tierCQueue` docuvia_meta key -- used by the
 *  drain step to dequeue entries as soon as their extraction is durably persisted (per-item
 *  stage-then-finalize, see `git-constants.ts`'s `META_KEY_TIER_C_QUEUE` doc comment). Caller is
 *  responsible for wrapping this in `store.withWriteLock()`. */
export function removeTierCQueueEntries(
  store: IGraphStore,
  targets: string[],
): void {
  if (targets.length === 0) return;

  const toRemove = new Set(targets);
  const remaining = readTierCQueue(store).filter(
    (e) => !toRemove.has(e.target),
  );
  store.meta.set(GitConstants.META_KEY_TIER_C_QUEUE, JSON.stringify(remaining));
}
