import { SemanticDecisionOptionKinds } from "@workspace/contracts";
import { SYSTEM1_OPTION_IDS } from "../system1-constants.js";
import type { System1DatasetRecord } from "../system1-types.js";
import {
  SYSTEM1_EVAL_BASELINE_IDS,
  SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_UNKNOWN_SCORE,
  SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_VERIFY_SCORE,
  SYSTEM1_EVAL_BASELINE_RANK_SCORES,
  SYSTEM1_EVAL_BASELINE_UNKNOWN_SCORE,
  SYSTEM1_EVAL_BASELINE_VERIFY_SCORE,
  SYSTEM1_EVAL_ALWAYS_VERIFY_SCORE,
  SYSTEM1_EVAL_SCORER_STATUSES,
  SYSTEM1_EVAL_RESPONSE_KEYS,
  SYSTEM1_EVAL_SCORE_KIND,
  SYSTEM1_EVAL_SINGLE_RANK0_OTHER_SCORE,
  SYSTEM1_EVAL_SINGLE_RANK0_SCORE,
  SYSTEM1_EVAL_SINGLE_RANK0_UNKNOWN_SCORE,
  SYSTEM1_EVAL_SINGLE_RANK0_VERIFY_SCORE,
  SYSTEM1_EVAL_SINGLE_RANK0_WITH_CANDIDATE_UNKNOWN_SCORE,
} from "./system1-eval-constants.js";
import type {
  System1InProcessScorer,
  System1ScorerResponse,
} from "./system1-eval-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function sameKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

function errorResponse(requestId: string): System1ScorerResponse {
  return {
    requestId,
    status: SYSTEM1_EVAL_SCORER_STATUSES.ERROR,
    scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
    scores: {},
  };
}

function isScorerStatus(
  value: unknown,
): value is System1ScorerResponse["status"] {
  return Object.values(SYSTEM1_EVAL_SCORER_STATUSES).some(
    (status) => status === value,
  );
}

function scoreValueIsValid(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isValidResponseEnvelope(
  value: unknown,
  expectedRequestId: string,
): value is Record<string, unknown> & {
  readonly requestId: string;
  readonly status: System1ScorerResponse["status"];
  readonly scores: Record<string, unknown>;
} {
  return (
    isRecord(value) &&
    sameKeys(value, SYSTEM1_EVAL_RESPONSE_KEYS) &&
    value.requestId === expectedRequestId &&
    value.scoreKind === SYSTEM1_EVAL_SCORE_KIND.RAW &&
    isScorerStatus(value.status) &&
    isRecord(value.scores)
  );
}

function nonOkResponse(
  requestId: string,
  status: System1ScorerResponse["status"],
  scores: Readonly<Record<string, unknown>>,
): System1ScorerResponse {
  return Object.keys(scores).length === 0
    ? {
        requestId,
        status,
        scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
        scores: {},
      }
    : errorResponse(requestId);
}

function orderedScoreMap(
  scores: Readonly<Record<string, unknown>>,
  optionIds: readonly string[],
): Readonly<Record<string, number>> | null {
  if (!sameKeys(scores, optionIds)) return null;
  const ordered: Record<string, number> = {};
  for (const optionId of optionIds) {
    const score = scores[optionId];
    if (!scoreValueIsValid(score)) return null;
    ordered[optionId] = score;
  }
  return ordered;
}

/** Validates exact request/option identity and reorders scores to P1 option order. */
export function validateSystem1ScorerResponse(
  state: System1DatasetRecord,
  value: unknown,
): System1ScorerResponse {
  const expectedRequestId = state.request.requestId;
  if (!isValidResponseEnvelope(value, expectedRequestId))
    return errorResponse(expectedRequestId);
  const status = value.status;
  const scores = value.scores;
  if (status !== SYSTEM1_EVAL_SCORER_STATUSES.OK)
    return nonOkResponse(expectedRequestId, status, scores);
  const optionIds = state.request.options.map((option) => option.id);
  const orderedScores = orderedScoreMap(scores, optionIds);
  if (orderedScores === null) return errorResponse(expectedRequestId);
  return {
    requestId: expectedRequestId,
    status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
    scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
    scores: orderedScores,
  };
}

/** Runs and normalizes a TypeScript scorer while exposing only the state record. */
export async function scoreSystem1InProcessState(
  state: System1DatasetRecord,
  scorer: System1InProcessScorer,
): Promise<System1ScorerResponse> {
  try {
    return validateSystem1ScorerResponse(state, await scorer.scoreState(state));
  } catch {
    return errorResponse(state.request.requestId);
  }
}

function readTierARanks(
  state: System1DatasetRecord,
): readonly { readonly optionId: string; readonly rank: number }[] | null {
  const candidates = state.request.options.filter(
    (option) => option.kind === SemanticDecisionOptionKinds.CANDIDATE,
  );
  const result: { optionId: string; rank: number }[] = [];
  for (const candidate of candidates) {
    const rank = candidate.attributes?.tierARank;
    if (
      typeof rank !== "number" ||
      !Number.isInteger(rank) ||
      rank < 0 ||
      rank >= SYSTEM1_EVAL_BASELINE_RANK_SCORES.length
    )
      return null;
    result.push({ optionId: candidate.id, rank });
  }
  return result;
}

function isBaselineId(scorerId: string): boolean {
  return Object.values(SYSTEM1_EVAL_BASELINE_IDS).some((id) => id === scorerId);
}

function candidateBaselineScore(
  scorerId: string,
  rank: number,
  rankZeroCount: number,
  candidateCount: number,
): number {
  if (scorerId === SYSTEM1_EVAL_BASELINE_IDS.TIER_A_RANK_PRIOR) {
    const rankScore = SYSTEM1_EVAL_BASELINE_RANK_SCORES[rank];
    return rankScore / (1 + Math.log2(Math.max(candidateCount, 1)));
  }
  if (scorerId === SYSTEM1_EVAL_BASELINE_IDS.SINGLE_RANK0)
    return rankZeroCount === 1 && rank === 0
      ? SYSTEM1_EVAL_SINGLE_RANK0_SCORE
      : SYSTEM1_EVAL_SINGLE_RANK0_OTHER_SCORE;
  return 0;
}

function baselineControlScores(
  scorerId: string,
  rankZeroCount: number,
  candidateCount: number,
): Readonly<Record<string, number>> {
  if (scorerId === SYSTEM1_EVAL_BASELINE_IDS.SINGLE_RANK0) {
    const unknownScore =
      candidateCount === 0
        ? SYSTEM1_EVAL_SINGLE_RANK0_UNKNOWN_SCORE
        : rankZeroCount === 1
          ? SYSTEM1_EVAL_SINGLE_RANK0_OTHER_SCORE
          : SYSTEM1_EVAL_SINGLE_RANK0_WITH_CANDIDATE_UNKNOWN_SCORE;
    return {
      [SYSTEM1_OPTION_IDS.UNKNOWN]: unknownScore,
      [SYSTEM1_OPTION_IDS.VERIFY_WITH_LSP]:
        SYSTEM1_EVAL_SINGLE_RANK0_VERIFY_SCORE,
    };
  }
  if (scorerId === SYSTEM1_EVAL_BASELINE_IDS.ALWAYS_VERIFY)
    return {
      [SYSTEM1_OPTION_IDS.UNKNOWN]: 0,
      [SYSTEM1_OPTION_IDS.VERIFY_WITH_LSP]: SYSTEM1_EVAL_ALWAYS_VERIFY_SCORE,
    };
  return candidateCount === 0
    ? {
        [SYSTEM1_OPTION_IDS.UNKNOWN]:
          SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_UNKNOWN_SCORE,
        [SYSTEM1_OPTION_IDS.VERIFY_WITH_LSP]:
          SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_VERIFY_SCORE,
      }
    : {
        [SYSTEM1_OPTION_IDS.UNKNOWN]: SYSTEM1_EVAL_BASELINE_UNKNOWN_SCORE,
        [SYSTEM1_OPTION_IDS.VERIFY_WITH_LSP]:
          SYSTEM1_EVAL_BASELINE_VERIFY_SCORE,
      };
}

/** State-only, deterministic reference scorers used as P2 floors. */
export function scoreSystem1Baseline(
  state: System1DatasetRecord,
  scorerId: string,
): System1ScorerResponse {
  const candidates = readTierARanks(state);
  if (candidates === null || !isBaselineId(scorerId))
    return errorResponse(state.request.requestId);
  const rankZeroCount = candidates.filter(({ rank }) => rank === 0).length;
  const candidatesById = new Map(
    candidates.map(
      (candidate) => [candidate.optionId, candidate.rank] as const,
    ),
  );
  const candidateCount = candidates.length;
  const controls = baselineControlScores(
    scorerId,
    rankZeroCount,
    candidateCount,
  );
  const scores: Record<string, number> = {};

  for (const option of state.request.options) {
    if (option.kind === SemanticDecisionOptionKinds.CANDIDATE) {
      const rank = candidatesById.get(option.id);
      if (rank === undefined) return errorResponse(state.request.requestId);
      scores[option.id] = candidateBaselineScore(
        scorerId,
        rank,
        rankZeroCount,
        candidateCount,
      );
      continue;
    }
    const controlScore = controls[option.id];
    if (controlScore !== undefined) {
      scores[option.id] = controlScore;
      continue;
    }
    return errorResponse(state.request.requestId);
  }

  return validateSystem1ScorerResponse(state, {
    requestId: state.request.requestId,
    status: SYSTEM1_EVAL_SCORER_STATUSES.OK,
    scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
    scores,
  });
}
