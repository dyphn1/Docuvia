import { GitConstants } from "@workspace/core";
import type { IGraphStore } from "@workspace/contracts";

export interface TierCBudget {
  /** UTC `YYYY-MM-DD` stamp the counters below were last reset for. */
  date: string;
  calls: number;
  tokens: number;
}

/** Today's UTC date as `YYYY-MM-DD` -- the stamp `tierCBudget.date` is compared against. */
export function todayUtcDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function zeroBudget(date: string): TierCBudget {
  return { date, calls: 0, tokens: 0 };
}

/**
 * Reads the `tierCBudget` docuvia_meta key with the §9c/E2 lazy reset applied: if the stored
 * `date` isn't today (UTC), the counters are treated as zero *for this read* -- the persisted
 * value on disk is only overwritten once `writeTierCBudget` is next called (e.g. after recording
 * usage), matching "reset-on-first-read is the daemonless equivalent" of a midnight timer. A
 * missing/corrupt value is likewise treated as a fresh zero budget for today rather than thrown.
 */
export function readTierCBudget(store: IGraphStore): TierCBudget {
  const today = todayUtcDateStamp();
  const raw = store.meta.get(GitConstants.META_KEY_TIER_C_BUDGET);
  if (!raw) return zeroBudget(today);

  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.date !== "string" ||
      typeof parsed.calls !== "number" ||
      typeof parsed.tokens !== "number"
    ) {
      return zeroBudget(today);
    }
    if (parsed.date !== today) return zeroBudget(today);
    return parsed as TierCBudget;
  } catch {
    return zeroBudget(today);
  }
}

/** Persists `budget` verbatim -- caller decides the write-lock discipline (mirrors
 *  `appendTierBQueueEntries`'s "caller wraps in `store.withWriteLock()`" contract). */
export function writeTierCBudget(
  store: IGraphStore,
  budget: TierCBudget,
): void {
  store.meta.set(GitConstants.META_KEY_TIER_C_BUDGET, JSON.stringify(budget));
}

/** `true` once either cap has been reached or exceeded (§9c/§9f) -- the drain must not start a
 *  new item's LLM call once this is true (a call already in flight is allowed to finish and be
 *  persisted; only the *next* call is gated). */
export function isTierCBudgetExhausted(
  budget: TierCBudget,
  dailyCallCap: number,
  dailyTokenCap: number,
): boolean {
  return budget.calls >= dailyCallCap || budget.tokens >= dailyTokenCap;
}

/**
 * Rough token estimate for `text` -- the CLIProxyAPI bridge's `ChatCompletionResult` wire format
 * (see `lib/llm-api/src/fetch-llm-client.ts`) carries no `usage`/token-count field today, so the
 * daily token budget cannot be checked against real provider-reported usage. A 4-characters-per-
 * token heuristic (the commonly cited rough average for English/code text) is used instead. This
 * is a documented approximation, not exact accounting -- flagged as a judgment call in the Slice 4
 * handover (phase1-decision-integration.md §9c only specifies the budget's *shape*, not how
 * "tokens" are measured without provider-reported usage).
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
