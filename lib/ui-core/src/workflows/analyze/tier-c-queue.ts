import { GitConstants } from "@workspace/contracts";
import type { IGraphStore } from "@workspace/contracts";
import path from "node:path";
import { toNodeKey } from "./anchor-resolution.js";

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
  /** Count of consecutive per-item extraction failures for this entry across `analyze` runs --
   *  the poison-pill counter `recordTierCQueueFailure` increments, absent/0 until the first
   *  failure. */
  failCount?: number;
}

export const TierCQueueValidationReasons = {
  INVALID_ENTRY: "invalid-entry",
} as const;

export type ContractSymbolTargetParseResult =
  | { ok: true; file: string; symbolName: string }
  | {
      ok: false;
      reason: (typeof TierCQueueValidationReasons)["INVALID_ENTRY"];
    };

const REPO_PATH_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const REPO_PATH_BACKSLASH = /\\/;
const CONTRACT_SYMBOL_FILE_HEADER_UNSAFE_CHARACTERS = /\x60/;
const CONTRACT_SYMBOL_NAME_UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f`]/;

/** Parses the persisted contract-symbol target without repairing non-canonical queue values.
 *  Git tree paths use forward-slash repository semantics: a drive-like first segment remains
 *  repo-relative, while leading slashes, backslashes, traversal, and non-canonical segments are
 *  rejected. The canonical file followed by `#` defines the prefix; the remaining non-empty text
 *  is the symbol name, which may itself contain `#` characters. The file and symbol are
 *  interpolated into a backtick-delimited prompt header, so reject backticks there and control
 *  characters in the symbol. */
export function parseContractSymbolTarget(
  entry: TierCQueueEntry,
): ContractSymbolTargetParseResult {
  if (
    entry.kind !== TierCCandidateKinds.CONTRACT_SYMBOL ||
    typeof entry.target !== "string" ||
    typeof entry.file !== "string" ||
    !isCanonicalRepoRelativeFile(entry.file) ||
    CONTRACT_SYMBOL_FILE_HEADER_UNSAFE_CHARACTERS.test(entry.file)
  ) {
    return invalidContractSymbolTarget();
  }

  const targetPrefix = `${entry.file}#`;
  if (!entry.target.startsWith(targetPrefix)) {
    return invalidContractSymbolTarget();
  }

  const symbolName = entry.target.slice(targetPrefix.length);
  if (!symbolName || CONTRACT_SYMBOL_NAME_UNSAFE_CHARACTERS.test(symbolName)) {
    return invalidContractSymbolTarget();
  }

  return { ok: true, file: entry.file, symbolName };
}

function invalidContractSymbolTarget(): ContractSymbolTargetParseResult {
  return {
    ok: false,
    reason: TierCQueueValidationReasons.INVALID_ENTRY,
  };
}

function isCanonicalRepoRelativeFile(file: string): boolean {
  return isPosixRepoRelativeFile(file) && hasCanonicalRepoSegments(file);
}

function isPosixRepoRelativeFile(file: string): boolean {
  return (
    file.length > 0 &&
    !path.posix.isAbsolute(file) &&
    !REPO_PATH_BACKSLASH.test(file) &&
    !REPO_PATH_CONTROL_CHARACTERS.test(file) &&
    toNodeKey(file) === file
  );
}

function hasCanonicalRepoSegments(file: string): boolean {
  const normalizedFile = path.posix.normalize(file);
  return (
    normalizedFile === file &&
    normalizedFile !== "." &&
    normalizedFile !== ".." &&
    !normalizedFile.split("/").includes("..") &&
    !normalizedFile.endsWith("/")
  );
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

/**
 * Read-modify-write bump of `target`'s `failCount` in the `tierCQueue` docuvia_meta key -- the
 * poison-pill mechanism that stops a deterministically-failing entry from blocking every item
 * behind it forever: once `failCount` reaches `maxFailures`, the entry is evicted (same removal
 * semantics as `removeTierCQueueEntries`) instead of staying at the front of the queue. Caller is
 * responsible for wrapping this in `store.withWriteLock()`, matching the existing convention in
 * this file. A `target` that can't be found (already evicted/removed by a concurrent path) is a
 * no-op, not an error.
 */
export function recordTierCQueueFailure(
  store: IGraphStore,
  target: string,
  maxFailures: number,
): { evicted: boolean; failCount: number } {
  const existing = readTierCQueue(store);
  const index = existing.findIndex((e) => e.target === target);
  if (index === -1) return { evicted: false, failCount: 0 };

  const failCount = (existing[index].failCount ?? 0) + 1;
  if (failCount >= maxFailures) {
    const remaining = existing.filter((_, i) => i !== index);
    store.meta.set(
      GitConstants.META_KEY_TIER_C_QUEUE,
      JSON.stringify(remaining),
    );
    return { evicted: true, failCount };
  }

  const updated = existing.slice();
  updated[index] = { ...updated[index], failCount };
  store.meta.set(GitConstants.META_KEY_TIER_C_QUEUE, JSON.stringify(updated));
  return { evicted: false, failCount };
}
