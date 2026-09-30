import { TierCCandidateKinds } from "../constants/tier-c-queue.js";
import type { TierCQueueEntry } from "../interfaces/tier-c-queue.interfaces.js";

export interface TierCQueueDecodeResult {
  entries: TierCQueueEntry[];
  invalidCount: number;
  corrupt: boolean;
}

/** Decodes persisted Tier C queue JSON without throwing or trusting its row shapes. */
export function decodeTierCQueue(
  raw: string | undefined,
): TierCQueueDecodeResult {
  if (raw === undefined) return emptyQueueDecodeResult();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return corruptQueueDecodeResult();
  }

  if (!Array.isArray(parsed)) return corruptQueueDecodeResult();

  const entries: TierCQueueEntry[] = [];
  let invalidCount = 0;
  for (const entry of parsed as unknown[]) {
    if (isTierCQueueEntry(entry)) {
      entries.push(entry);
    } else {
      invalidCount++;
    }
  }

  return { entries, invalidCount, corrupt: false };
}

function isTierCQueueEntry(value: unknown): value is TierCQueueEntry {
  if (!isRecord(value)) return false;

  if (
    typeof value.target !== "string" ||
    typeof value.commitSha !== "string" ||
    !hasValidFailCount(value)
  ) {
    return false;
  }

  if (value.kind === TierCCandidateKinds.COMMIT_MESSAGE) {
    return typeof value.message === "string";
  }

  if (value.kind === TierCCandidateKinds.CONTRACT_SYMBOL) {
    return typeof value.file === "string";
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidFailCount(value: Record<string, unknown>): boolean {
  return (
    value.failCount === undefined ||
    (typeof value.failCount === "number" &&
      Number.isInteger(value.failCount) &&
      value.failCount >= 0)
  );
}

function emptyQueueDecodeResult(): TierCQueueDecodeResult {
  return { entries: [], invalidCount: 0, corrupt: false };
}

function corruptQueueDecodeResult(): TierCQueueDecodeResult {
  return { entries: [], invalidCount: 0, corrupt: true };
}
