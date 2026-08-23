import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import { makeMockStore } from "@workspace/contracts/testing";
import {
  estimateTokenCount,
  isTierCBudgetExhausted,
  readTierCBudget,
  todayUtcDateStamp,
  writeTierCBudget,
} from "./tier-c-budget.js";

function makeBudgetStore(
  initialMeta: Record<string, string> = {},
): IGraphStore {
  const meta = { ...initialMeta };
  return makeMockStore({
    meta: {
      get: vi.fn((key: string) => meta[key]),
      set: vi.fn((key: string, value: string) => {
        meta[key] = value;
      }),
    },
  });
}

describe("readTierCBudget() -- lazy UTC reset (§9c/§9k gating test 2)", () => {
  it("returns a fresh zero budget for today when the meta key is absent", () => {
    const store = makeBudgetStore();
    const budget = readTierCBudget(store);
    expect(budget).toEqual({ date: todayUtcDateStamp(), calls: 0, tokens: 0 });
  });

  it("returns the stored budget unchanged when its date is today", () => {
    const today = todayUtcDateStamp();
    const store = makeBudgetStore({
      [GitConstants.META_KEY_TIER_C_BUDGET]: JSON.stringify({
        date: today,
        calls: 5,
        tokens: 1000,
      }),
    });
    expect(readTierCBudget(store)).toEqual({
      date: today,
      calls: 5,
      tokens: 1000,
    });
  });

  it("zeroes the counters when the stored date is a previous UTC day (crossing the date boundary)", () => {
    const store = makeBudgetStore({
      [GitConstants.META_KEY_TIER_C_BUDGET]: JSON.stringify({
        date: "2020-01-01",
        calls: 999,
        tokens: 999_999,
      }),
    });
    const budget = readTierCBudget(store);
    expect(budget.date).toBe(todayUtcDateStamp());
    expect(budget.calls).toBe(0);
    expect(budget.tokens).toBe(0);
  });

  it("returns a fresh zero budget on corrupt JSON", () => {
    const store = makeBudgetStore({
      [GitConstants.META_KEY_TIER_C_BUDGET]: "not json",
    });
    expect(readTierCBudget(store)).toEqual({
      date: todayUtcDateStamp(),
      calls: 0,
      tokens: 0,
    });
  });
});

describe("writeTierCBudget()", () => {
  it("persists the budget verbatim, readable back via readTierCBudget", () => {
    const store = makeBudgetStore();
    const today = todayUtcDateStamp();
    writeTierCBudget(store, { date: today, calls: 3, tokens: 500 });
    expect(readTierCBudget(store)).toEqual({
      date: today,
      calls: 3,
      tokens: 500,
    });
  });
});

describe("isTierCBudgetExhausted()", () => {
  const today = todayUtcDateStamp();

  it("is false when both counters are under their caps", () => {
    expect(
      isTierCBudgetExhausted({ date: today, calls: 1, tokens: 1 }, 10, 1000),
    ).toBe(false);
  });

  it("is true once the call cap is reached", () => {
    expect(
      isTierCBudgetExhausted({ date: today, calls: 10, tokens: 1 }, 10, 1000),
    ).toBe(true);
  });

  it("is true once the token cap is reached", () => {
    expect(
      isTierCBudgetExhausted({ date: today, calls: 1, tokens: 1000 }, 10, 1000),
    ).toBe(true);
  });
});

describe("estimateTokenCount()", () => {
  it("estimates roughly 4 characters per token", () => {
    expect(estimateTokenCount("a".repeat(40))).toBe(10);
  });

  it("rounds up for a non-multiple-of-4 length", () => {
    expect(estimateTokenCount("abc")).toBe(1);
  });
});
