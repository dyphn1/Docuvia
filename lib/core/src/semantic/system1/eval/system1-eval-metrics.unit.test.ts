import { describe, expect, it } from "vitest";
import {
  SYSTEM1_AMBIGUITY_CLASSES,
  SYSTEM1_EVAL_ACTIONS,
  SYSTEM1_EVAL_CALIBRATION_METHOD,
  SYSTEM1_EVAL_PRECISION_TARGETS,
  SYSTEM1_EVAL_SCORER_STATUSES,
  SYSTEM1_EVAL_SCORE_KIND,
} from "./system1-eval-constants.js";
import { computeSystem1SplitMetrics } from "./system1-eval-metrics.js";
import { fitSystem1IsotonicCalibrator } from "./system1-eval-calibration.js";
import type {
  System1DatasetRecord,
  System1LabelRecord,
} from "../system1-types.js";
import type {
  System1EvalExample,
  System1EvaluationPolicy,
} from "./system1-eval-types.js";

interface CandidateFixture {
  readonly optionId: string;
  readonly targetId: string;
  readonly rank: number;
  readonly missing?: boolean;
}

function example(
  requestId: string,
  candidates: readonly CandidateFixture[],
  positiveTargetIds: readonly string[],
  options: {
    readonly candidateMiss?: boolean;
    readonly reviewStatus?: string;
    readonly ambiguityClasses?: readonly string[];
    readonly notDetectedClasses?: readonly string[];
    readonly scoreOverrides?: Readonly<Record<string, number>>;
    readonly repoId?: string;
  } = {},
): System1EvalExample {
  const candidateOptions = candidates.map((candidate) => ({
    id: candidate.optionId,
    kind: "candidate",
    text: "",
    attributes: {
      targetId: candidate.targetId,
      tierARank: candidate.rank,
      evidenceStatus: candidate.missing ? "missing" : "present",
    },
  }));
  const state = {
    request: {
      schemaVersion: 1,
      requestId,
      featureSchemaVersion: "system1-option-selection/v1",
      evidence: {
        repoId: options.repoId ?? "github.com/example/repo",
        worktreeId: "revision",
        projectId: "tsconfig.json",
        snapshotHash: "snapshot",
        candidateSetHash: "candidates",
        truncated: false,
      },
      task: "edge-relation",
      language: "typescript",
      relation: "cross-file-call",
      context: { text: "{}" },
      options: [
        ...candidateOptions,
        { id: "UNKNOWN", kind: "unknown", text: "" },
        { id: "VERIFY_WITH_LSP", kind: "verify", text: "" },
      ],
    },
    ambiguityClasses: options.ambiguityClasses ?? [
      SYSTEM1_AMBIGUITY_CLASSES.PATH_ALIAS,
    ],
    notDetectedClasses: options.notDetectedClasses ?? [
      SYSTEM1_AMBIGUITY_CLASSES.BARREL_REEXPORT,
    ],
    candidateCount: candidates.length,
    textTruncated: false,
  } as unknown as System1DatasetRecord;
  const labels: System1LabelRecord = {
    requestId,
    positiveTargetIds: [...positiveTargetIds],
    negativeTargetIds: candidates
      .map((candidate) => candidate.targetId)
      .filter((targetId) => !positiveTargetIds.includes(targetId)),
    reviewStatus: options.reviewStatus ?? "confirmed",
    oracleStatus: "resolved",
    candidateMiss: options.candidateMiss ?? false,
  };
  const scores = Object.fromEntries([
    ...candidates.map((candidate) => [
      candidate.optionId,
      options.scoreOverrides?.[candidate.optionId] ??
        (positiveTargetIds.includes(candidate.targetId) ? 0.9 : 0.2),
    ]),
    ["UNKNOWN", 0.1],
    ["VERIFY_WITH_LSP", 0.05],
  ]);
  return {
    split: "test",
    state,
    labels,
    response: {
      requestId,
      status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      scores: { ...scores, ...options.scoreOverrides },
    },
  };
}

describe("System-1 evaluation metrics", () => {
  it("keeps repository families at owner/repository granularity", () => {
    const first = example(
      "repo-one",
      [{ optionId: "a", targetId: "src/a.ts#call", rank: 0 }],
      ["src/a.ts#call"],
      { repoId: "github.com/acme/one" },
    );
    const second = example(
      "repo-two",
      [{ optionId: "b", targetId: "src/a.ts#call", rank: 0 }],
      ["src/a.ts#call"],
      { repoId: "github.com/acme/two" },
    );
    const policy: System1EvaluationPolicy = {
      schemaVersion: 1,
      calibrationMethod: SYSTEM1_EVAL_CALIBRATION_METHOD,
      scorerManifestHash: "c".repeat(64),
      calibrator: fitSystem1IsotonicCalibrator([]),
      precisionTargets: SYSTEM1_EVAL_PRECISION_TARGETS.map(
        (targetPrecision) => ({
          targetPrecision,
          status: "certified",
          threshold: 0.75,
          calibrationCommitCount: 300,
          calibrationExactSetCount: 300,
          lowerBound: 0.99,
        }),
      ),
    };

    const result = computeSystem1SplitMetrics([first, second], policy);
    const families = result.slices
      .filter(({ dimension }) => dimension === "repo-family")
      .map(({ key }) => key);

    expect(families).toEqual(["acme/one", "acme/two"]);
  });

  it("uses negative Tier A candidates as the false-positive-rate denominator", () => {
    const sample = example(
      "false-positive",
      [
        { optionId: "positive", targetId: "src/a.ts#call", rank: 0 },
        { optionId: "negative", targetId: "src/b.ts#call", rank: 1 },
      ],
      ["src/a.ts#call"],
      { scoreOverrides: { positive: 0.9, negative: 0.9 } },
    );
    const policy: System1EvaluationPolicy = {
      schemaVersion: 1,
      calibrationMethod: SYSTEM1_EVAL_CALIBRATION_METHOD,
      scorerManifestHash: "c".repeat(64),
      calibrator: fitSystem1IsotonicCalibrator([]),
      precisionTargets: SYSTEM1_EVAL_PRECISION_TARGETS.map(
        (targetPrecision) => ({
          targetPrecision,
          status: "certified",
          threshold: 0.75,
          calibrationCommitCount: 300,
          calibrationExactSetCount: 300,
          lowerBound: 0.99,
        }),
      ),
    };

    const result = computeSystem1SplitMetrics([sample], policy);
    const primary = result.byPrecisionTarget["0.990"];

    expect(primary.requestLevel.exactSetPrecision).toMatchObject({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
    expect(primary.candidateLevel.acceptedDecisionPrecision).toMatchObject({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
    expect(primary.candidateLevel.falsePositiveRate).toMatchObject({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
  });

  it("reports request and candidate denominators, confidence intervals, and Tier A misses", () => {
    const examples = [
      example(
        "correct",
        [
          { optionId: "a1", targetId: "src/a.ts#call", rank: 0 },
          {
            optionId: "b1",
            targetId: "src/b.ts#call",
            rank: 1,
            missing: true,
          },
        ],
        ["src/a.ts#call"],
      ),
      example(
        "candidate-miss",
        [{ optionId: "a2", targetId: "src/a.ts#call", rank: 0 }],
        ["src/missing.ts#call"],
        { candidateMiss: true, scoreOverrides: { a2: 0.9 } },
      ),
      example(
        "untrusted",
        [{ optionId: "a3", targetId: "src/a.ts#call", rank: 0 }],
        ["src/a.ts#call"],
        { reviewStatus: "unreviewed" },
      ),
      example(
        "candidate-present-noncommit",
        [
          { optionId: "a4", targetId: "src/a.ts#call", rank: 0 },
          { optionId: "b4", targetId: "src/b.ts#call", rank: 1 },
        ],
        ["src/a.ts#call"],
        { scoreOverrides: { a4: 0.2, b4: 0.1, UNKNOWN: 0.8 } },
      ),
    ];
    const policy: System1EvaluationPolicy = {
      schemaVersion: 1,
      calibrationMethod: SYSTEM1_EVAL_CALIBRATION_METHOD,
      scorerManifestHash: "a".repeat(64),
      calibrator: fitSystem1IsotonicCalibrator([]),
      precisionTargets: SYSTEM1_EVAL_PRECISION_TARGETS.map(
        (targetPrecision) => ({
          targetPrecision,
          status: "certified",
          threshold: 0.75,
          calibrationCommitCount: 300,
          calibrationExactSetCount: 300,
          lowerBound: 0.99,
        }),
      ),
    };

    const result = computeSystem1SplitMetrics(examples, policy);
    const primary = result.byPrecisionTarget["0.990"];

    expect(result.trustedRequestCount).toBe(3);
    expect(result.excludedLabelCounts).toEqual({
      "review-status-not-confirmed": 1,
    });
    expect(result.candidateMissCount).toBe(1);
    expect(primary.requestLevel.commitRate).toMatchObject({
      numerator: 2,
      denominator: 3,
      rate: 2 / 3,
    });
    expect(primary.requestLevel.lspAvoidanceRate).toEqual(
      primary.requestLevel.commitRate,
    );
    expect(primary.requestLevel.exactSetPrecision).toMatchObject({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
    expect(primary.requestLevel.falseSafePerTrustedRequest).toMatchObject({
      numerator: 1,
      denominator: 3,
    });
    expect(primary.requestLevel.falseSafeAmongCommits).toMatchObject({
      numerator: 1,
      denominator: 2,
    });
    expect(primary.requestLevel.candidateMissCommits).toBe(1);
    expect(primary.requestLevel.unknownRate.rate).toBe(0);
    expect(primary.requestLevel.verifyRate.rate).toBe(1 / 3);
    expect(primary.candidateLevel.acceptedDecisionPrecision.rate).toBe(1);
    expect(primary.candidateLevel.goldPositiveCoverage.rate).toBe(0.5);
    expect(primary.candidateLevel.falsePositiveRate.rate).toBe(0);
    expect(primary.candidateLevel.top1Accuracy.rate).toBe(1);
    expect(primary.requestLevel.commitRate.interval95).not.toBeNull();
  });

  it("computes fixed-width reliability bins and class/missing-evidence slices", () => {
    const examples = [
      example(
        "tagged",
        [
          { optionId: "a1", targetId: "src/a.ts#call", rank: 0 },
          {
            optionId: "b1",
            targetId: "src/b.ts#call",
            rank: 1,
            missing: true,
          },
        ],
        ["src/a.ts#call"],
      ),
      example(
        "plain",
        [{ optionId: "a2", targetId: "src/a.ts#call", rank: 0 }],
        ["src/a.ts#call"],
        {
          ambiguityClasses: [],
          notDetectedClasses: [],
          scoreOverrides: { a2: 0.2 },
        },
      ),
    ];
    const policy: System1EvaluationPolicy = {
      schemaVersion: 1,
      calibrationMethod: SYSTEM1_EVAL_CALIBRATION_METHOD,
      scorerManifestHash: "b".repeat(64),
      calibrator: fitSystem1IsotonicCalibrator([]),
      precisionTargets: SYSTEM1_EVAL_PRECISION_TARGETS.map(
        (targetPrecision) => ({
          targetPrecision,
          status: "certified",
          threshold: 0.75,
          calibrationCommitCount: 300,
          calibrationExactSetCount: 300,
          lowerBound: 0.99,
        }),
      ),
    };

    const result = computeSystem1SplitMetrics(examples, policy);
    const detected = result.slices.find(
      (slice) =>
        slice.dimension === "ambiguity-class" &&
        slice.key === SYSTEM1_AMBIGUITY_CLASSES.PATH_ALIAS,
    );
    const notDetected = result.slices.find(
      (slice) =>
        slice.dimension === "not-detected-class" &&
        slice.key === SYSTEM1_AMBIGUITY_CLASSES.BARREL_REEXPORT,
    );
    const missing = result.slices.find(
      (slice) =>
        slice.dimension === "missing-evidence" &&
        slice.key === "has-missing-evidence",
    );

    expect(result.calibration.reliability).toHaveLength(15);
    expect(result.calibration.ece).not.toBeNull();
    expect(detected?.sampleCount).toBe(1);
    expect(notDetected?.sampleCount).toBe(1);
    expect(missing?.sampleCount).toBe(1);
    expect(SYSTEM1_EVAL_ACTIONS.COMMIT).toBe("commit");
  });
});
