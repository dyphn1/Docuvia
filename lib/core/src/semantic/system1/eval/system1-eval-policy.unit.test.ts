import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SYSTEM1_EVAL_ACTIONS,
  SYSTEM1_EVAL_BASELINE_IDS,
  SYSTEM1_EVAL_PRECISION_TARGETS,
  SYSTEM1_EVAL_SCORER_STATUSES,
  SYSTEM1_EVAL_SCORE_KIND,
} from "./system1-eval-constants.js";
import {
  decideSystem1Request,
  fitSystem1EvaluationPolicy,
  fitSystem1LeaveOneFamilyOutPolicy,
} from "./system1-eval-policy.js";
import { fitSystem1IsotonicCalibrator } from "./system1-eval-calibration.js";
import { buildSystem1RepoFamilyFolds } from "./system1-eval-folds.js";
import { scoreSystem1Baseline } from "./system1-eval-scorer.js";
import type {
  System1DatasetRecord,
  System1LabelRecord,
} from "../system1-types.js";
import type { System1EvalExample } from "./system1-eval-types.js";

function stateRecord(requestId: string): System1DatasetRecord {
  return {
    request: {
      schemaVersion: 1,
      requestId,
      featureSchemaVersion: "system1-option-selection/v1",
      evidence: {
        repoId: "github.com/example/repo",
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
        {
          id: "candidate-a",
          kind: "candidate",
          text: "",
          attributes: { targetId: "src/a.ts#call", tierARank: 0 },
        },
        {
          id: "candidate-b",
          kind: "candidate",
          text: "",
          attributes: { targetId: "src/b.ts#call", tierARank: 1 },
        },
        { id: "UNKNOWN", kind: "unknown", text: "" },
        { id: "VERIFY_WITH_LSP", kind: "verify", text: "" },
      ],
    },
    ambiguityClasses: [],
    notDetectedClasses: [],
    candidateCount: 2,
    textTruncated: false,
  } as unknown as System1DatasetRecord;
}

function example(
  requestId: string,
  split: string,
  family = "github.com/example/repo",
  positiveTargetId = "src/a.ts#call",
): System1EvalExample {
  const state = stateRecord(requestId);
  const familyState = {
    ...state,
    request: {
      ...state.request,
      evidence: { ...state.request.evidence, repoId: family },
    },
  } as System1DatasetRecord;
  const labels: System1LabelRecord = {
    requestId,
    positiveTargetIds: [positiveTargetId],
    negativeTargetIds: [
      positiveTargetId === "src/a.ts#call" ? "src/b.ts#call" : "src/a.ts#call",
    ],
    reviewStatus: "confirmed",
    oracleStatus: "resolved",
    candidateMiss: false,
  };
  return {
    split: split as System1EvalExample["split"],
    state: familyState,
    labels,
    duplicateGroup: requestId,
    response: {
      requestId,
      status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      foldFamily: family.replace(/^github\.com\//, "").replace(/\.git$/, ""),
      scores: {
        "candidate-a": 1,
        "candidate-b": 0,
        UNKNOWN: 0,
        VERIFY_WITH_LSP: 0,
      },
    },
  };
}

describe("System-1 calibration policy", () => {
  it("rejects train and held-out records from the fit entry point", () => {
    for (const split of ["train", "temporal", "test"]) {
      expect(() =>
        fitSystem1EvaluationPolicy(
          [example("request-1", split)],
          "a".repeat(64),
        ),
      ).toThrow();
    }
  });

  it("selects the least-strict certified threshold and records uncertifiable targets", () => {
    const examples = Array.from({ length: 300 }, (_, index) =>
      example(`calibration-${index}`, "calibration"),
    );
    const policy = fitSystem1EvaluationPolicy(examples, "b".repeat(64));
    const certified = policy.precisionTargets.find(
      (entry) => entry.targetPrecision === SYSTEM1_EVAL_PRECISION_TARGETS[0],
    );
    const uncertifiable = policy.precisionTargets.find(
      (entry) => entry.targetPrecision === SYSTEM1_EVAL_PRECISION_TARGETS[1],
    );

    expect(certified).toMatchObject({ status: "certified", threshold: 1 });
    expect(certified?.calibrationCommitCount).toBe(300);
    expect(certified?.calibrationExactSetCount).toBe(300);
    expect(certified?.lowerBound).toBeGreaterThanOrEqual(0.99);
    expect(uncertifiable).toMatchObject({
      status: "uncertifiable",
      threshold: null,
    });
  });

  it("certifies calibration precision on duplicate groups rather than export rows", () => {
    const examples = Array.from({ length: 300 }, (_, index) => ({
      ...example("duplicate-" + index, "calibration"),
      duplicateGroup: "same-context",
    }));
    const policy = fitSystem1EvaluationPolicy(examples, "f".repeat(64));
    const target = policy.precisionTargets.find(
      ({ targetPrecision }) =>
        targetPrecision === SYSTEM1_EVAL_PRECISION_TARGETS[0],
    );

    expect(target).toMatchObject({
      status: "uncertifiable",
      threshold: null,
      diagnosticThreshold: 1,
      calibrationCommitCount: 1,
      calibrationExactSetCount: 1,
      calibrationRowCommitCount: 300,
      calibrationRowExactSetCount: 300,
      lowerBound: 0.05,
      independentSupportSufficient: false,
      rowLevelComparison: {
        status: "certified",
        threshold: 1,
        commitCount: 300,
        exactSetCount: 300,
        lowerBound: expect.any(Number),
      },
    });
  });

  it("does not synthesize a zero threshold below observed calibration scores", () => {
    const examples = Array.from({ length: 300 }, (_, index) => {
      const original = example(`supported-${index}`, "calibration");
      const options = original.state.request.options.filter(
        (option) => option.id !== "candidate-b",
      );
      const state = {
        ...original.state,
        request: { ...original.state.request, options },
        candidateCount: 1,
      } as System1DatasetRecord;
      return {
        ...original,
        state,
        response: {
          ...original.response,
          scores: {
            "candidate-a": 0.8,
            UNKNOWN: 0.1,
            VERIFY_WITH_LSP: 0.05,
          },
        },
      };
    });
    const policy = fitSystem1EvaluationPolicy(examples, "e".repeat(64));
    const target = policy.precisionTargets.find(
      (entry) => entry.targetPrecision === SYSTEM1_EVAL_PRECISION_TARGETS[0],
    );

    expect(target).toMatchObject({
      status: "certified",
      threshold: 0.8,
      calibrationCommitCount: 300,
      calibrationExactSetCount: 300,
    });
  });

  it("commits only the accepted Tier A candidate and verifies every non-ok result", () => {
    const examples = Array.from({ length: 300 }, (_, index) =>
      example(`calibration-${index}`, "calibration"),
    );
    const policy = fitSystem1EvaluationPolicy(examples, "c".repeat(64));
    const state = stateRecord("evaluation-1");
    const raw = scoreSystem1Baseline(
      state,
      SYSTEM1_EVAL_BASELINE_IDS.TIER_A_RANK_PRIOR,
    );
    const accepted = decideSystem1Request(
      state,
      { ...raw, scores: { ...raw.scores, "candidate-a": 1, "candidate-b": 0 } },
      policy,
      SYSTEM1_EVAL_PRECISION_TARGETS[0],
    );
    const timedOut = decideSystem1Request(
      state,
      {
        requestId: "evaluation-1",
        status: SYSTEM1_EVAL_SCORER_STATUSES.TIMEOUT,
        scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
        scores: {},
      },
      policy,
      SYSTEM1_EVAL_PRECISION_TARGETS[0],
    );
    const uncertified = decideSystem1Request(
      state,
      raw,
      policy,
      SYSTEM1_EVAL_PRECISION_TARGETS[1],
    );

    expect(accepted).toMatchObject({
      action: SYSTEM1_EVAL_ACTIONS.COMMIT,
      acceptedTargetIds: ["src/a.ts#call"],
    });
    expect(timedOut.action).toBe(SYSTEM1_EVAL_ACTIONS.VERIFY);
    expect(uncertified.action).toBe(SYSTEM1_EVAL_ACTIONS.VERIFY);
  });

  it("routes noncommitted requests with candidates to VERIFY regardless of UNKNOWN score", () => {
    const examples = Array.from({ length: 300 }, (_, index) =>
      example(`calibration-${index}`, "calibration"),
    );
    const policy = fitSystem1EvaluationPolicy(examples, "d".repeat(64));
    const state = stateRecord("evaluation-2");
    const response = {
      requestId: "evaluation-2",
      status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      scores: {
        "candidate-a": 0,
        "candidate-b": 0,
        UNKNOWN: 0.7,
        VERIFY_WITH_LSP: 0.2,
      },
    };
    const tiedControls = {
      ...response,
      scores: { ...response.scores, UNKNOWN: 0.2, VERIFY_WITH_LSP: 0.2 },
    };

    expect(
      decideSystem1Request(
        state,
        response,
        policy,
        SYSTEM1_EVAL_PRECISION_TARGETS[0],
      ).action,
    ).toBe(SYSTEM1_EVAL_ACTIONS.VERIFY);
    expect(
      decideSystem1Request(
        state,
        tiedControls,
        policy,
        SYSTEM1_EVAL_PRECISION_TARGETS[0],
      ).action,
    ).toBe(SYSTEM1_EVAL_ACTIONS.VERIFY);
  });

  it("allows UNKNOWN only when the request has no candidate options", () => {
    const examples = Array.from({ length: 300 }, (_, index) =>
      example(`calibration-${index}`, "calibration"),
    );
    const policy = fitSystem1EvaluationPolicy(examples, "d".repeat(64));
    const original = stateRecord("evaluation-empty");
    const options = original.request.options.filter(
      (option) => option.kind !== "candidate",
    );
    const state = {
      ...original,
      request: { ...original.request, options },
      candidateCount: 0,
    } as System1DatasetRecord;
    const response = {
      requestId: "evaluation-empty",
      status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      scores: { UNKNOWN: 0.7, VERIFY_WITH_LSP: 0.2 },
    };

    expect(
      decideSystem1Request(
        state,
        response,
        policy,
        SYSTEM1_EVAL_PRECISION_TARGETS[0],
      ).action,
    ).toBe(SYSTEM1_EVAL_ACTIONS.UNKNOWN);
  });

  it("fits every OOF fold without that family's observations and refits on all pool rows", () => {
    const pool = Array.from({ length: 7 }, (_, familyIndex) =>
      Array.from({ length: familyIndex + 1 }, (_, requestIndex) =>
        example(
          `pool-${familyIndex}-${requestIndex}`,
          familyIndex < 5 ? "train" : "calibration",
          `github.com/family/repo-${familyIndex}`,
        ),
      ),
    ).flat();
    const folds = buildSystem1RepoFamilyFolds(
      pool.map(({ state }) => state.request.evidence.repoId),
    );
    const policy = fitSystem1LeaveOneFamilyOutPolicy(
      pool,
      "f".repeat(64),
      folds,
      1,
    );

    expect(policy.folds).toHaveLength(7);
    for (const summary of policy.foldCalibrationSummaries ?? []) {
      const fold = policy.folds?.find(
        ({ foldFamily }) => foldFamily === summary.foldFamily,
      );
      const expectedTrainingFamilies = (policy.folds ?? [])
        .map(({ foldFamily }) => foldFamily)
        .filter((family) => family !== summary.foldFamily);
      const expectedObservations = pool
        .filter(
          ({ state }) =>
            state.request.evidence.repoId !==
            `github.com/${summary.foldFamily}`,
        )
        .flatMap(({ labels, response, state }) =>
          state.request.options
            .filter((option) => option.kind === "candidate")
            .map((option) => {
              const targetId = option.attributes?.targetId;
              return {
                score: response.scores[option.id],
                positive:
                  typeof targetId === "string" &&
                  labels.positiveTargetIds.includes(targetId),
              };
            }),
        );
      const expectedCalibrator =
        fitSystem1IsotonicCalibrator(expectedObservations);
      const expectedHash = createHash("sha256")
        .update(JSON.stringify(expectedCalibrator))
        .digest("hex");

      expect(fold?.trainingFamilies).toEqual(expectedTrainingFamilies);
      expect(summary.trainingFamilies).toEqual(expectedTrainingFamilies);
      expect(summary.observationCount).toBe(expectedObservations.length);
      expect(summary.calibrationSha256).toBe(expectedHash);
    }
    expect(policy.calibrator.observationCount).toBe(56);
    expect(policy.precisionTargets[0].oofFamilyTable?.families).toHaveLength(7);
  });

  it("collapses duplicate OOF rows into one pooled and per-family unit", () => {
    const pool = ["repo-a", "repo-b"].flatMap((repo) =>
      Array.from({ length: 3 }, (_, index) => ({
        ...example(
          `${repo}-${index}`,
          repo === "repo-a" ? "train" : "calibration",
          `github.com/family/${repo}`,
        ),
        duplicateGroup: `duplicate-${repo}`,
      })),
    );
    const folds = buildSystem1RepoFamilyFolds(
      pool.map(({ state }) => state.request.evidence.repoId),
    );
    const policy = fitSystem1LeaveOneFamilyOutPolicy(
      pool,
      "c".repeat(64),
      folds,
      1,
    );
    const diagnostic = policy.precisionTargets[0].oofFamilyTable;

    expect(diagnostic).toMatchObject({
      pooledCommitCount: 2,
      pooledExactSetCount: 2,
      pooledRowCommitCount: 6,
      pooledRowExactSetCount: 6,
    });
    expect(diagnostic?.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "family/repo-a",
          commits: 1,
          exactSetCount: 1,
          rowCommits: 3,
          rowExactSetCount: 3,
        }),
        expect.objectContaining({
          family: "family/repo-b",
          commits: 1,
          exactSetCount: 1,
          rowCommits: 3,
          rowExactSetCount: 3,
        }),
      ]),
    );
  });

  it("rejects a fitting-pool family that has no OOF fold", () => {
    const pool = [
      example("family-a", "train", "github.com/family/a"),
      example("family-b", "calibration", "github.com/family/b"),
      example("family-c", "train", "github.com/family/c"),
    ];
    const folds = buildSystem1RepoFamilyFolds([
      "github.com/family/a",
      "github.com/family/b",
    ]);

    expect(() =>
      fitSystem1LeaveOneFamilyOutPolicy(pool, "f".repeat(64), folds),
    ).toThrow(/missing out-of-fold fold for family\/c/i);
  });

  it("reports best-pooled, strictest and least-strict diagnostics when uncertifiable", () => {
    const pool = [
      ...Array.from({ length: 100 }, (_, index) =>
        example(`good-a-${index}`, "train", "github.com/family/good-a"),
      ),
      ...Array.from({ length: 100 }, (_, index) =>
        example(`good-b-${index}`, "train", "github.com/family/good-b"),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        example(
          `poor-${index}`,
          "calibration",
          "github.com/family/poor",
          "src/b.ts#call",
        ),
      ),
    ];
    const folds = buildSystem1RepoFamilyFolds(
      pool.map(({ state }) => state.request.evidence.repoId),
    );
    const target = fitSystem1LeaveOneFamilyOutPolicy(
      pool,
      "e".repeat(64),
      folds,
      1,
    ).precisionTargets[0];
    const diagnostics = target.oofFamilyDiagnostics ?? [];
    const leastStrict = diagnostics.find(
      ({ diagnosticKind }) => diagnosticKind === "least-strict",
    );
    const bestPooled = diagnostics.find(
      ({ diagnosticKind }) => diagnosticKind === "best-pooled-lower-bound",
    );
    const strictest = diagnostics.find(
      ({ diagnosticKind }) => diagnosticKind === "strictest",
    );
    const poorFamily = bestPooled?.families.find(
      ({ family }) => family === "family/poor",
    );

    expect(target.status).toBe("uncertifiable");
    expect(target.oofFamilyTable?.diagnosticKind).toBe(
      "best-pooled-lower-bound",
    );
    expect(diagnostics.map(({ diagnosticKind }) => diagnosticKind)).toEqual([
      "best-pooled-lower-bound",
      "strictest",
      "least-strict",
    ]);
    expect(bestPooled?.evaluatedThreshold).not.toBe(
      leastStrict?.evaluatedThreshold,
    );
    expect(poorFamily).toMatchObject({
      usedForFamilyGate: true,
      familyGateSatisfied: false,
    });
    expect(
      strictest?.families.find(({ family }) => family === "family/poor"),
    ).toMatchObject({ familyGateSatisfied: false });
  });

  it("does not certify a pooled pass when a sufficiently large family misses the target", () => {
    const good = ["good-a", "good-c"].flatMap((family) =>
      Array.from({ length: 5_000 }, (_, index) =>
        example(
          `good-${family}-${index}`,
          "train",
          `github.com/family/${family}`,
        ),
      ),
    );
    const poor = Array.from({ length: 200 }, (_, index) =>
      example(
        `poor-${index}`,
        "calibration",
        "github.com/family/poor",
        index < 197 ? "src/a.ts#call" : "src/b.ts#call",
      ),
    );
    const pool = [...good, ...poor];
    const folds = buildSystem1RepoFamilyFolds(
      pool.map(({ state }) => state.request.evidence.repoId),
    );
    const policy = fitSystem1LeaveOneFamilyOutPolicy(
      pool,
      "a".repeat(64),
      folds,
      200,
    );
    const target = policy.precisionTargets[0];

    expect(target.status).toBe("uncertifiable");
    expect(target.oofFamilyTable?.pooledLowerBound).toBeGreaterThanOrEqual(
      0.99,
    );
    expect(
      target.oofFamilyTable?.families.find(
        ({ family }) => family === "family/poor",
      )?.exactSetPrecision,
    ).toBeLessThan(0.99);
  });

  it("counts below-minimum families in pooled certification but omits them from the family gate", () => {
    const good = ["large-a", "large-b"].flatMap((family) =>
      Array.from({ length: 2_500 }, (_, index) =>
        example(
          `large-${family}-${index}`,
          "train",
          `github.com/family/${family}`,
        ),
      ),
    );
    const small = [
      example(
        "small-0",
        "calibration",
        "github.com/family/small",
        "src/b.ts#call",
      ),
    ];
    const pool = [...good, ...small];
    const folds = buildSystem1RepoFamilyFolds(
      pool.map(({ state }) => state.request.evidence.repoId),
    );
    const policy = fitSystem1LeaveOneFamilyOutPolicy(
      pool,
      "b".repeat(64),
      folds,
      200,
    );
    const target = policy.precisionTargets[0];
    const family = target.oofFamilyTable?.families.find(
      ({ family: key }) => key === "family/small",
    );

    expect(target.status).toBe("certified");
    expect(target.calibrationCommitCount).toBe(5_001);
    expect(family).toMatchObject({ commits: 1, usedForFamilyGate: false });
  });

  it("rejects held-out records from the LOFO fit entry point", () => {
    const train = example("pool-a", "train", "github.com/family/a");
    const calibration = example("pool-b", "calibration", "github.com/family/b");
    const folds = buildSystem1RepoFamilyFolds(["family/a", "family/b"]);
    for (const split of ["temporal", "test"]) {
      expect(() =>
        fitSystem1LeaveOneFamilyOutPolicy(
          [
            train,
            calibration,
            example("held-out", split, "github.com/family/c"),
          ],
          "c".repeat(64),
          folds,
        ),
      ).toThrow(/train and calibration/i);
    }
  });
});
