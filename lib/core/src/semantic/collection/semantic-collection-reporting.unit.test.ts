import { describe, expect, it } from "vitest";
import { ErrorCodes } from "@workspace/contracts";
import {
  compareReplays,
  selectAuditSample,
  summarizeDurations,
} from "./semantic-collection-reporting.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-07--replay
// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-08--human-audit-worksheet
// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-09--paired-baseline
const entry = (sampleId: string, stratum: string, reason = "ready") => ({
  sampleId,
  stratum,
  reason,
});

describe("audit worksheet sample", () => {
  it("[happy] takes every conflict plus ceil(10%) of each stratum", () => {
    const entries = [
      ...Array.from({ length: 11 }, (_, i) => entry(`a${i}`, "A")),
      ...Array.from({ length: 3 }, (_, i) => entry(`b${i}`, "B")),
      entry("c0", "A", "label-conflict"),
    ];
    const picked = selectAuditSample(entries, "seed");
    expect(picked.filter((id) => id.startsWith("a"))).toHaveLength(2);
    expect(picked.filter((id) => id.startsWith("b"))).toHaveLength(1);
    expect(picked).toContain("c0");
    expect(picked).toEqual([...picked].sort());
  });

  it("[state-diff] the seed changes the selection deterministically", () => {
    const entries = Array.from({ length: 50 }, (_, i) => entry(`s${i}`, "A"));
    expect(selectAuditSample(entries, "one")).toEqual(
      selectAuditSample([...entries].reverse(), "one"),
    );
    expect(selectAuditSample(entries, "one")).not.toEqual(
      selectAuditSample(entries, "two"),
    );
  });
});

describe("replay comparison", () => {
  it("[happy] identical correctness fields produce no mismatch despite timings", () => {
    const a = { x: [1, { y: "z", elapsedMs: 3 }], elapsedMs: 10 };
    const b = { elapsedMs: 99, x: [1, { elapsedMs: 4, y: "z" }] };
    expect(compareReplays(a, b, ["elapsedMs"])).toEqual([]);
  });

  it("[negative] reports each differing path, including order and missing keys", () => {
    expect(
      compareReplays(
        { a: [1, 2], b: 1, c: { d: 1 } },
        { a: [2, 1], b: 1, c: {} },
        [],
      ),
    ).toEqual(["$.a[0]", "$.a[1]", "$.c.d"]);
    expect(compareReplays({ a: [1] }, { a: [1, 2] }, [])).toEqual([
      "$.a.length",
    ]);
  });

  it("[boundary] caps the mismatch list", () => {
    const a = Array.from({ length: 500 }, (_, i) => i);
    const b = a.map((i) => i + 1);
    expect(compareReplays(a, b, [], 10)).toHaveLength(10);
  });
});

describe("duration summary", () => {
  it("[happy] reports nearest-rank p50/p95 with min/max and raw samples", () => {
    const samples = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(summarizeDurations(samples)).toEqual({
      n: 20,
      p50: 10,
      p95: 19,
      min: 1,
      max: 20,
      samples,
    });
  });

  it("[boundary] a single sample is its own percentile", () => {
    expect(summarizeDurations([7])).toMatchObject({
      n: 1,
      p50: 7,
      p95: 7,
      min: 7,
      max: 7,
    });
  });

  it("[invalid-input] rejects empty or non-finite samples", () => {
    const code = { code: ErrorCodes.SEMANTIC_CORPUS_INVALID };
    expect(() => summarizeDurations([])).toThrow(expect.objectContaining(code));
    expect(() => summarizeDurations([1, Number.NaN])).toThrow(
      expect.objectContaining(code),
    );
  });

  it("[error-handling] negative durations are rejected rather than clamped", () => {
    expect(() => summarizeDurations([-1])).toThrow(
      expect.objectContaining({ code: ErrorCodes.SEMANTIC_CORPUS_INVALID }),
    );
  });
});
