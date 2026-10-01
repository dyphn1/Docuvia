import { describe, expect, it } from "vitest";
import {
  SYSTEM1_EVAL_PRECISION_TARGET_KEYS,
  SYSTEM1_EVAL_REPORT_TEXT,
  SYSTEM1_EVAL_THRESHOLD_STATUSES,
} from "./system1-eval-constants.js";
import { renderSystem1EvalReport } from "./system1-eval-report.js";
import type {
  System1SplitMetrics,
  System1TargetMetrics,
} from "./system1-eval-types.js";

function splitMetrics(
  split: string,
  exactSetRate: number,
  lowerBound: number,
): System1SplitMetrics {
  const target = {
    targetPrecision: 0.99,
    certification: {
      targetPrecision: 0.99,
      status: SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED,
      threshold: 0.8,
      calibrationCommitCount: 300,
      calibrationExactSetCount: 300,
      lowerBound: 0.99,
    },
    requestLevel: {
      commitRate: {
        numerator: 50,
        denominator: 100,
        rate: 0.5,
        interval95: null,
      },
      lspAvoidanceRate: {
        numerator: 50,
        denominator: 100,
        rate: 0.5,
        interval95: null,
      },
      exactSetPrecision: {
        numerator: 49,
        denominator: 50,
        rate: exactSetRate,
        interval95: { lower: lowerBound, upper: 1 },
      },
      falseSafePerTrustedRequest: {
        numerator: 1,
        denominator: 100,
        rate: 0.01,
        interval95: null,
      },
      unknownRate: {
        numerator: 25,
        denominator: 100,
        rate: 0.25,
        interval95: null,
      },
      verifyRate: {
        numerator: 25,
        denominator: 100,
        rate: 0.25,
        interval95: null,
      },
    },
    candidateLevel: {
      goldPositiveCoverage: {
        numerator: 50,
        denominator: 100,
        rate: 0.5,
        interval95: null,
      },
    },
  } as unknown as System1TargetMetrics;
  return {
    split: split as System1SplitMetrics["split"],
    sampleCount: 100,
    trustedRequestCount: 100,
    excludedLabelCounts: {},
    candidateMissCount: 0,
    calibration: {
      method: "isotonic-pava-v1",
      scoredRequestCount: 100,
      candidateCount: 200,
      ece: 0.04,
      reliability: [],
    },
    byPrecisionTarget: {
      [SYSTEM1_EVAL_PRECISION_TARGET_KEYS[0]]: target,
    },
    slices: [],
  };
}

describe("System-1 evaluation report", () => {
  it("marks held-out rows that miss the certified target and labels calibration ECE in-sample", () => {
    const report = renderSystem1EvalReport({
      scorerId: "test-scorer",
      policyHash: "a".repeat(64),
      splitMetrics: [
        splitMetrics("calibration", 1, 1),
        splitMetrics("test", 0.995, 0.985),
      ],
      sealedInputs: {},
    });

    expect(report).toContain("meets target on held-out");
    expect(report).toContain("| calibration | 0.990 | certified | in-sample |");
    expect(report).toContain("| test | 0.990 | certified | NO |");
    expect(report).toContain(`${SYSTEM1_EVAL_REPORT_TEXT.IN_SAMPLE})`);
  });
});
