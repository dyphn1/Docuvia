import { describe, expect, it } from "vitest";
import {
  SYSTEM1_EVAL_BASELINE_IDS,
  SYSTEM1_EVAL_SCORER_STATUSES,
  SYSTEM1_EVAL_SCORE_KIND,
} from "./system1-eval-constants.js";
import {
  scoreSystem1InProcessState,
  scoreSystem1Baseline,
  validateSystem1ScorerResponse,
} from "./system1-eval-scorer.js";
import type { System1DatasetRecord } from "../system1-types.js";

function stateRecord(): System1DatasetRecord {
  return {
    request: {
      schemaVersion: 1,
      requestId: "request-1",
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
          attributes: { targetId: "src/b.ts#call", tierARank: 2 },
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

describe("System-1 evaluator scorer protocol", () => {
  it("[happy] accepts independent raw probabilities without requiring a softmax sum", () => {
    const state = stateRecord();
    const value = {
      requestId: "request-1",
      status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      scores: {
        "candidate-a": 0.7,
        "candidate-b": 0.6,
        UNKNOWN: 0.2,
        VERIFY_WITH_LSP: 0.1,
      },
    };

    expect(validateSystem1ScorerResponse(state, value)).toEqual(value);
  });

  it("preserves a scorer-declared OOF fold family", () => {
    const state = stateRecord();
    const response = validateSystem1ScorerResponse(state, {
      requestId: state.request.requestId,
      foldFamily: "example/repo",
      status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      scores: {
        "candidate-a": 0.7,
        "candidate-b": 0.6,
        UNKNOWN: 0.2,
        VERIFY_WITH_LSP: 0.1,
      },
    });

    expect(response.foldFamily).toBe("example/repo");
    expect(response.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.OK);
  });

  it.each([
    [
      "missing option id",
      { "candidate-a": 0.7, "candidate-b": 0.6, UNKNOWN: 0.2 },
    ],
    [
      "unknown option id",
      {
        "candidate-a": 0.7,
        "candidate-b": 0.6,
        UNKNOWN: 0.2,
        VERIFY_WITH_LSP: 0.1,
        invented: 0.4,
      },
    ],
    [
      "out-of-range probability",
      {
        "candidate-a": 1.1,
        "candidate-b": 0.6,
        UNKNOWN: 0.2,
        VERIFY_WITH_LSP: 0.1,
      },
    ],
  ])(
    "[invalid-input] [error-handling] turns %s into an error response",
    (_description, scores) => {
      const state = stateRecord();
      const response = validateSystem1ScorerResponse(state, {
        requestId: state.request.requestId,
        status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
        scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
        scores,
      });

      expect(response.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
      expect(response.scores).toEqual({});
    },
  );

  it("[invalid-input] [error-handling] rejects non-finite scores and a mismatched request ID", () => {
    const state = stateRecord();
    const invalidScore = validateSystem1ScorerResponse(state, {
      requestId: "request-1",
      status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      scores: {
        "candidate-a": Number.NaN,
        "candidate-b": 0.6,
        UNKNOWN: 0.2,
        VERIFY_WITH_LSP: 0.1,
      },
    });
    const wrongId = validateSystem1ScorerResponse(state, {
      requestId: "request-other",
      status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      scores: {
        "candidate-a": 0.7,
        "candidate-b": 0.6,
        UNKNOWN: 0.2,
        VERIFY_WITH_LSP: 0.1,
      },
    });

    expect(invalidScore.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
    expect(wrongId).toMatchObject({
      requestId: "request-1",
      status: SYSTEM1_EVAL_SCORER_STATUSES.ERROR,
      scores: {},
    });
  });

  it("provides the three deterministic baseline scorers from state only", () => {
    const state = stateRecord();

    const rankPrior = scoreSystem1Baseline(
      state,
      SYSTEM1_EVAL_BASELINE_IDS.TIER_A_RANK_PRIOR,
    );
    const singleRankZero = scoreSystem1Baseline(
      state,
      SYSTEM1_EVAL_BASELINE_IDS.SINGLE_RANK0,
    );
    const alwaysVerify = scoreSystem1Baseline(
      state,
      SYSTEM1_EVAL_BASELINE_IDS.ALWAYS_VERIFY,
    );

    expect(Object.keys(rankPrior.scores)).toEqual(
      state.request.options.map((option) => option.id),
    );
    expect(rankPrior.scores["candidate-a"]).toBeGreaterThan(
      rankPrior.scores["candidate-b"],
    );
    expect(singleRankZero.scores["candidate-a"]).toBeGreaterThan(
      singleRankZero.scores["candidate-b"],
    );
    expect(rankPrior.scores.VERIFY_WITH_LSP).toBeGreaterThan(
      rankPrior.scores.UNKNOWN,
    );
    expect(singleRankZero.scores.VERIFY_WITH_LSP).toBeGreaterThan(
      singleRankZero.scores.UNKNOWN,
    );
    expect(alwaysVerify.scores.VERIFY_WITH_LSP).toBe(1);
    expect(alwaysVerify.scores["candidate-a"]).toBe(0);
  });

  it("ranks UNKNOWN above VERIFY only when no candidate option exists", () => {
    const original = stateRecord();
    const options = original.request.options.filter(
      (option) => option.kind !== "candidate",
    );
    const state = {
      ...original,
      request: { ...original.request, options },
      candidateCount: 0,
    } as System1DatasetRecord;

    for (const scorerId of [
      SYSTEM1_EVAL_BASELINE_IDS.TIER_A_RANK_PRIOR,
      SYSTEM1_EVAL_BASELINE_IDS.SINGLE_RANK0,
    ]) {
      const response = scoreSystem1Baseline(state, scorerId);
      expect(response.scores.UNKNOWN).toBeGreaterThan(
        response.scores.VERIFY_WITH_LSP,
      );
    }
  });

  it("normalizes the in-process scorer contract with state-only input", async () => {
    const state = stateRecord();
    let observedInput: unknown;
    const scorer = {
      scorerId: "test-scorer",
      version: "1",
      weightsConfigSha256: "f".repeat(64),
      scoreState: (input: System1DatasetRecord) => {
        observedInput = input;
        return {
          requestId: input.request.requestId,
          status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
          scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
          scores: Object.fromEntries(
            input.request.options.map((option) => [option.id, 0.25]),
          ),
        };
      },
    };
    const response = await scoreSystem1InProcessState(state, scorer);

    expect(response.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.OK);
    expect(observedInput).toBe(state);
    expect(observedInput).not.toHaveProperty("labels");
  });

  it("[error-handling] preserves timeout and OOD as non-ok statuses with no scores", () => {
    const state = stateRecord();
    const timeout = validateSystem1ScorerResponse(state, {
      requestId: "request-1",
      status: SYSTEM1_EVAL_SCORER_STATUSES.TIMEOUT,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      scores: {},
    });
    const ood = validateSystem1ScorerResponse(state, {
      requestId: "request-1",
      status: SYSTEM1_EVAL_SCORER_STATUSES.OOD,
      scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
      scores: {},
    });

    expect(timeout.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.TIMEOUT);
    expect(ood.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.OOD);
    expect(timeout.scores).toEqual({});
  });
});
