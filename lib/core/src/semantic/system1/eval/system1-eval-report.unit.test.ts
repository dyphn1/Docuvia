import { describe, expect, it } from "vitest";
import {
  SYSTEM1_EVAL_CERTIFICATION_MODES,
  SYSTEM1_EVAL_PRECISION_TARGET_KEYS,
  SYSTEM1_EVAL_PROTOCOL_VERSION,
  SYSTEM1_EVAL_REPORT_TEXT,
  SYSTEM1_EVAL_THRESHOLD_STATUSES,
} from "./system1-eval-constants.js";
import { renderSystem1EvalReport } from "./system1-eval-report.js";
import type {
  System1SplitMetrics,
  System1TargetMetrics,
} from "./system1-eval-types.js";

function splitMetrics(
  split: System1SplitMetrics["split"],
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
      calibrationRowCommitCount: 300,
      calibrationRowExactSetCount: 300,
      minimumIndependentCommits: 299,
      independentSupportSufficient: true,
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
      independentGroups: {
        groupCount: 100,
        committedCount: 50,
        exactSetCount: 49,
        commitRate: {
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
      measurementSplit: split,
      method: "isotonic-pava-v1",
      scoredRequestCount: 100,
      candidateCount: 200,
      ece: 0.04,
      brierScore: 0.06,
      reliability: [],
      riskCoverage: [],
    },
    byPrecisionTarget: {
      [SYSTEM1_EVAL_PRECISION_TARGET_KEYS[0]]: target,
    },
    slices: [],
  };
}

describe("System-1 evaluation report", () => {
  it("marks held-out misses and labels LOFO pool metrics out-of-fold", () => {
    const report = renderSystem1EvalReport({
      scorerId: "test-scorer",
      policyHash: "a".repeat(64),
      selectedCertificationMode:
        SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT,
      splitMetrics: [
        splitMetrics("train", 1, 1),
        splitMetrics("calibration", 1, 1),
        splitMetrics("test", 0.995, 0.985),
      ],
      sealedInputs: {},
      certificationModes: [
        {
          mode: "calibration-only",
          splitMetrics: [splitMetrics("test", 0.995, 0.985)],
        },
        {
          mode: "leave-one-family-out",
          splitMetrics: [splitMetrics("test", 0.995, 0.985)],
        },
      ],
      lofoPolicy: {
        schemaVersion: 1,
        protocolVersion: SYSTEM1_EVAL_PROTOCOL_VERSION,
        calibrationMethod: "isotonic-pava-v1",
        scorerManifestHash: "a".repeat(64),
        calibrator: {
          method: "isotonic-pava-v1",
          fitted: false,
          observationCount: 0,
          positiveCount: 0,
          negativeCount: 0,
          blocks: [],
        },
        precisionTargets: [
          {
            targetPrecision: 0.99,
            status: SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED,
            threshold: 0.8,
            calibrationCommitCount: 1,
            calibrationExactSetCount: 1,
            calibrationRowCommitCount: 1,
            calibrationRowExactSetCount: 1,
            minimumIndependentCommits: 299,
            independentSupportSufficient: false,
            lowerBound: 0.05,
            oofFamilyTable: {
              diagnosticKind: "certified",
              evaluatedThreshold: 0.8,
              families: [
                {
                  family: "acme/repo",
                  commits: 1,
                  exactSetCount: 1,
                  rowCommits: 1,
                  rowExactSetCount: 1,
                  exactSetPrecision: 1,
                  lowerBound: 0.05,
                  usedForFamilyGate: false,
                  familyGateSatisfied: null,
                },
              ],
              pooledCommitCount: 1,
              pooledExactSetCount: 1,
              pooledRowCommitCount: 1,
              pooledRowExactSetCount: 1,
              pooledLowerBound: 0.05,
              worstFamilyLowerBound: 0.05,
            },
          },
        ],
      },
    });

    expect(report).toContain("precision provenance / held-out target");
    expect(report).toContain("| train | 0.990 | certified | out-of-fold |");
    expect(report).toContain(
      "| calibration | 0.990 | certified | out-of-fold |",
    );
    expect(report).toContain("| test | 0.990 | certified | NO |");
    expect(report).toContain(`${SYSTEM1_EVAL_REPORT_TEXT.OUT_OF_FOLD})`);
    expect(report).toContain(
      SYSTEM1_EVAL_REPORT_TEXT.CERTIFICATION_MODES_HEADER,
    );
    expect(report).toContain("| leave-one-family-out | test | 0.990 |");
    expect(report).toContain("| acme/repo | 1 | 1 | 100.00% | 5.00% | 1 |");
    expect(report).toContain(
      "| target | diagnostic kind | threshold | pooled groups |",
    );
    expect(report).toContain(
      "| 0.990 | certified | 0.8 | 1 | 1 | 5.00% | 1 | 1 |",
    );
    expect(report).toContain("in-sample calibration duplicate groups");
  });

  it("describes the selected calibration-only frozen policy", () => {
    const report = renderSystem1EvalReport({
      scorerId: "test-scorer",
      policyHash: "b".repeat(64),
      selectedCertificationMode:
        SYSTEM1_EVAL_CERTIFICATION_MODES.CALIBRATION_ONLY,
      splitMetrics: [
        splitMetrics("train", 1, 1),
        splitMetrics("calibration", 1, 1),
      ],
      sealedInputs: {},
    });

    expect(report).toContain("Calibration-only fits its isotonic map");
    expect(report).not.toContain("LOFO fits one isotonic map");
    expect(report).toContain("train | 0.990 | certified | n/a");
    expect(report).toContain("| calibration | 0.990 | certified | in-sample |");
    expect(report).toContain(`${SYSTEM1_EVAL_REPORT_TEXT.IN_SAMPLE})`);
  });
});
