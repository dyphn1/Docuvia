import { describe, expect, it } from "vitest";
import { buildSystem1Labels } from "./system1-labels.js";
import { assertSystem1SplitLicense } from "./system1-split-policy.js";

describe("System-1 labels and split policy", () => {
  it("[happy] keeps review and oracle labels separate and records Tier A misses", () => {
    const labels = buildSystem1Labels({
      requestId: "system1:request",
      candidateTargetIds: ["src/a.ts#run"],
      positiveTargetIds: ["src/a.ts#run", "src/missing.ts#run"],
      negativeTargetIds: ["src/other.ts#run"],
      reviewStatus: "confirmed",
      oracleStatus: "resolved",
    });

    expect(labels).toEqual({
      requestId: "system1:request",
      positiveTargetIds: ["src/a.ts#run", "src/missing.ts#run"],
      negativeTargetIds: ["src/other.ts#run"],
      reviewStatus: "confirmed",
      oracleStatus: "resolved",
      candidateMiss: true,
    });
  });

  it("[negative] does not report a miss when every positive is already a Tier A candidate", () => {
    const labels = buildSystem1Labels({
      requestId: "system1:request",
      candidateTargetIds: ["src/a.ts#run"],
      positiveTargetIds: ["src/a.ts#run"],
      negativeTargetIds: [],
      reviewStatus: "confirmed",
      oracleStatus: "resolved",
    });

    expect(labels.candidateMiss).toBe(false);
  });

  it.each(["train", "calibration"] as const)(
    "[leakage] rejects evaluation-only samples in %s",
    (split) => {
      expect(() =>
        assertSystem1SplitLicense(split, "evaluation-only"),
      ).toThrow();
    },
  );

  it.each(["temporal", "test"] as const)(
    "[happy] permits evaluation-only data in held-out %s",
    (split) => {
      expect(() =>
        assertSystem1SplitLicense(split, "evaluation-only"),
      ).not.toThrow();
    },
  );
});
