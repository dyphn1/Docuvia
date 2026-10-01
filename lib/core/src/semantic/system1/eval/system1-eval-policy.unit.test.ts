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
} from "./system1-eval-policy.js";
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

function example(requestId: string, split: string): System1EvalExample {
  const state = stateRecord(requestId);
  const labels: System1LabelRecord = {
    requestId,
    positiveTargetIds: ["src/a.ts#call"],
    negativeTargetIds: ["src/b.ts#call"],
    reviewStatus: "confirmed",
    oracleStatus: "resolved",
    candidateMiss: false,
  };
  return {
    split: split as System1EvalExample["split"],
    state,
    labels,
    response: {
      requestId,
      status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
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
});
