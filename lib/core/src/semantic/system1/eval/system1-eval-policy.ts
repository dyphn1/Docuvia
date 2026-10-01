import { SemanticDecisionOptionKinds } from "@workspace/contracts";
import { SYSTEM1_OPTION_IDS, SYSTEM1_SPLITS } from "../system1-constants.js";
import {
  SYSTEM1_EVAL_ACTIONS,
  SYSTEM1_EVAL_CALIBRATION_METHOD,
  SYSTEM1_EVAL_LABEL_EXCLUSION_REASONS,
  SYSTEM1_EVAL_LABEL_STATUSES,
  SYSTEM1_EVAL_PRECISION_TARGETS,
  SYSTEM1_EVAL_SCHEMA_VERSION,
  SYSTEM1_EVAL_SCORER_STATUSES,
  SYSTEM1_EVAL_THRESHOLD_STATUSES,
} from "./system1-eval-constants.js";
import {
  calibrateSystem1Score,
  clopperPearsonLowerBound,
  fitSystem1IsotonicCalibrator,
} from "./system1-eval-calibration.js";
import type {
  System1CalibrationObservation,
  System1DecisionResult,
  System1EvalExample,
  System1EvaluationPolicy,
  System1PrecisionThreshold,
  System1ScorerResponse,
} from "./system1-eval-types.js";
import type {
  System1DatasetRecord,
  System1LabelRecord,
} from "../system1-types.js";

/** Returns why a label cannot enter a trusted precision denominator, or null. */
export function system1LabelExclusionReason(
  labels: System1LabelRecord,
): string | null {
  const positiveSet = new Set(labels.positiveTargetIds);
  if (labels.negativeTargetIds.some((targetId) => positiveSet.has(targetId)))
    return SYSTEM1_EVAL_LABEL_EXCLUSION_REASONS.LABEL_CONFLICT;
  if (labels.reviewStatus === SYSTEM1_EVAL_LABEL_STATUSES.REVIEW_CONFLICT)
    return SYSTEM1_EVAL_LABEL_EXCLUSION_REASONS.LABEL_CONFLICT;
  if (labels.reviewStatus !== SYSTEM1_EVAL_LABEL_STATUSES.REVIEW_CONFIRMED)
    return SYSTEM1_EVAL_LABEL_EXCLUSION_REASONS.REVIEW_NOT_CONFIRMED;
  if (labels.oracleStatus !== SYSTEM1_EVAL_LABEL_STATUSES.ORACLE_RESOLVED)
    return SYSTEM1_EVAL_LABEL_EXCLUSION_REASONS.ORACLE_NOT_RESOLVED;
  if (labels.positiveTargetIds.length === 0)
    return SYSTEM1_EVAL_LABEL_EXCLUSION_REASONS.EMPTY_POSITIVE_SET;
  return null;
}

function isCalibrationExample(example: System1EvalExample): boolean {
  return example.split === SYSTEM1_SPLITS.CALIBRATION;
}

function candidateOptions(state: System1DatasetRecord) {
  return state.request.options.filter(
    (option) => option.kind === SemanticDecisionOptionKinds.CANDIDATE,
  );
}

function eligibleForCalibrationFit(example: System1EvalExample): boolean {
  return (
    system1LabelExclusionReason(example.labels) === null &&
    !example.labels.candidateMiss &&
    example.response.status === SYSTEM1_EVAL_SCORER_STATUSES.OK
  );
}

function candidateCalibrationObservation(
  example: System1EvalExample,
  option: ReturnType<typeof candidateOptions>[number],
): System1CalibrationObservation | null {
  const score = example.response.scores[option.id];
  const targetId = option.attributes?.targetId;
  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 1 ||
    typeof targetId !== "string"
  )
    return null;
  return {
    score,
    positive: example.labels.positiveTargetIds.includes(targetId),
  };
}

function calibrationObservationsForExample(
  example: System1EvalExample,
): System1CalibrationObservation[] {
  const observations: System1CalibrationObservation[] = [];
  if (!eligibleForCalibrationFit(example)) return observations;
  for (const option of candidateOptions(example.state)) {
    const observation = candidateCalibrationObservation(example, option);
    if (observation !== null) observations.push(observation);
  }
  return observations;
}

function calibrationObservations(
  examples: readonly System1EvalExample[],
): System1CalibrationObservation[] {
  return examples.flatMap(calibrationObservationsForExample);
}

function calibratedCandidateScores(
  state: System1DatasetRecord,
  response: System1ScorerResponse,
  calibrator: System1EvaluationPolicy["calibrator"],
): readonly {
  readonly optionId: string;
  readonly targetId: string;
  readonly score: number;
}[] {
  if (response.status !== SYSTEM1_EVAL_SCORER_STATUSES.OK) return [];
  const result: { optionId: string; targetId: string; score: number }[] = [];
  for (const option of candidateOptions(state)) {
    const targetId = option.attributes?.targetId;
    const score = response.scores[option.id];
    if (
      typeof targetId !== "string" ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1
    )
      continue;
    result.push({
      optionId: option.id,
      targetId,
      score: calibrateSystem1Score(calibrator, score),
    });
  }
  return result;
}

interface MutableCalibrationRequest {
  readonly goldTargetIds: ReadonlySet<string>;
  readonly targetCounts: Map<string, number>;
  acceptedCandidateCount: number;
  acceptedGoldTargetCount: number;
  acceptedNegativeTargetCount: number;
}

interface CalibrationThresholdEvent {
  readonly requestIndex: number;
  readonly targetId: string;
}

function addAcceptedCandidate(
  request: MutableCalibrationRequest,
  targetId: string,
): void {
  const previousCount = request.targetCounts.get(targetId) ?? 0;
  request.targetCounts.set(targetId, previousCount + 1);
  if (previousCount > 0) return;
  if (request.goldTargetIds.has(targetId)) request.acceptedGoldTargetCount += 1;
  else request.acceptedNegativeTargetCount += 1;
}

function buildCalibrationThresholdState(
  examples: readonly System1EvalExample[],
  calibrator: System1EvaluationPolicy["calibrator"],
): {
  readonly requests: MutableCalibrationRequest[];
  readonly eventsByScore: Map<number, CalibrationThresholdEvent[]>;
} {
  const requests: MutableCalibrationRequest[] = [];
  const eventsByScore = new Map<number, CalibrationThresholdEvent[]>();
  for (const example of examples) {
    if (system1LabelExclusionReason(example.labels) !== null) continue;
    const requestIndex = requests.length;
    const goldTargetIds = new Set(example.labels.positiveTargetIds);
    const state: MutableCalibrationRequest = {
      goldTargetIds,
      targetCounts: new Map(),
      acceptedCandidateCount: 0,
      acceptedGoldTargetCount: 0,
      acceptedNegativeTargetCount: 0,
    };
    for (const candidate of calibratedCandidateScores(
      example.state,
      example.response,
      calibrator,
    )) {
      state.acceptedCandidateCount += 1;
      addAcceptedCandidate(state, candidate.targetId);
      const events = eventsByScore.get(candidate.score) ?? [];
      events.push({ requestIndex, targetId: candidate.targetId });
      eventsByScore.set(candidate.score, events);
    }
    requests.push(state);
  }
  return { requests, eventsByScore };
}

function removeThresholdCandidates(
  events: readonly CalibrationThresholdEvent[],
  requests: readonly MutableCalibrationRequest[],
): void {
  for (const event of events) {
    const request = requests[event.requestIndex];
    request.acceptedCandidateCount -= 1;
    const remainingCount = (request.targetCounts.get(event.targetId) ?? 0) - 1;
    if (remainingCount > 0) {
      request.targetCounts.set(event.targetId, remainingCount);
      continue;
    }
    request.targetCounts.delete(event.targetId);
    if (request.goldTargetIds.has(event.targetId))
      request.acceptedGoldTargetCount -= 1;
    else request.acceptedNegativeTargetCount -= 1;
  }
}

function calibrationThresholdCounts(
  requests: readonly MutableCalibrationRequest[],
): { readonly committedCount: number; readonly exactSetCount: number } {
  let committedCount = 0;
  let exactSetCount = 0;
  for (const request of requests) {
    if (request.acceptedCandidateCount === 0) continue;
    committedCount += 1;
    if (
      request.acceptedNegativeTargetCount === 0 &&
      request.acceptedGoldTargetCount === request.goldTargetIds.size
    )
      exactSetCount += 1;
  }
  return { committedCount, exactSetCount };
}

function thresholdCertification(
  examples: readonly System1EvalExample[],
  targetPrecision: number,
  calibrator: System1EvaluationPolicy["calibrator"],
): System1PrecisionThreshold {
  const { requests, eventsByScore } = buildCalibrationThresholdState(
    examples,
    calibrator,
  );
  const candidateThresholds = [...eventsByScore.keys()].sort(
    (left, right) => left - right,
  );
  for (const threshold of candidateThresholds) {
    const { committedCount, exactSetCount } =
      calibrationThresholdCounts(requests);
    if (committedCount > 0) {
      const lowerBound = clopperPearsonLowerBound(
        exactSetCount,
        committedCount,
      );
      if (lowerBound >= targetPrecision) {
        return {
          targetPrecision,
          status: SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED,
          threshold,
          calibrationCommitCount: committedCount,
          calibrationExactSetCount: exactSetCount,
          lowerBound,
        };
      }
    }
    removeThresholdCandidates(eventsByScore.get(threshold) ?? [], requests);
  }

  return {
    targetPrecision,
    status: SYSTEM1_EVAL_THRESHOLD_STATUSES.UNCERTIFIABLE,
    threshold: null,
    calibrationCommitCount: 0,
    calibrationExactSetCount: 0,
    lowerBound: null,
  };
}

/** Fits only from calibration rows. This guard rejects any accidental split mixing. */
export function fitSystem1EvaluationPolicy(
  examples: readonly System1EvalExample[],
  scorerManifestHash: string,
): System1EvaluationPolicy {
  if (examples.some((example) => !isCalibrationExample(example)))
    throw new Error("Policy fitting accepts calibration split rows only.");
  const calibrator = fitSystem1IsotonicCalibrator(
    calibrationObservations(examples),
  );
  return {
    schemaVersion: SYSTEM1_EVAL_SCHEMA_VERSION,
    calibrationMethod: SYSTEM1_EVAL_CALIBRATION_METHOD,
    scorerManifestHash,
    calibrator,
    precisionTargets: SYSTEM1_EVAL_PRECISION_TARGETS.map((targetPrecision) =>
      thresholdCertification(examples, targetPrecision, calibrator),
    ),
  };
}

function findThreshold(
  policy: System1EvaluationPolicy,
  targetPrecision: number,
): System1PrecisionThreshold | undefined {
  return policy.precisionTargets.find(
    (entry) => entry.targetPrecision === targetPrecision,
  );
}

function unknownControlWins(
  state: System1DatasetRecord,
  response: System1ScorerResponse,
): boolean {
  if (candidateOptions(state).length > 0) return false;
  const unknownScore = response.scores[SYSTEM1_OPTION_IDS.UNKNOWN];
  const verifyScore = response.scores[SYSTEM1_OPTION_IDS.VERIFY_WITH_LSP];
  return (
    typeof unknownScore === "number" &&
    typeof verifyScore === "number" &&
    unknownScore > verifyScore
  );
}

/** Any malformed or non-ok scorer response is converted to VERIFY_WITH_LSP. */
export function decideSystem1Request(
  state: System1DatasetRecord,
  response: System1ScorerResponse,
  policy: System1EvaluationPolicy,
  targetPrecision: number,
): System1DecisionResult {
  const requestId = state.request.requestId;
  const verify = (): System1DecisionResult => ({
    requestId,
    action: SYSTEM1_EVAL_ACTIONS.VERIFY,
    acceptedCandidateIds: [],
    acceptedTargetIds: [],
  });
  if (
    response.requestId !== requestId ||
    response.status !== SYSTEM1_EVAL_SCORER_STATUSES.OK
  )
    return verify();
  const threshold = findThreshold(policy, targetPrecision);
  if (
    !threshold ||
    threshold.status !== SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED ||
    threshold.threshold === null
  )
    return verify();

  const candidateScores = calibratedCandidateScores(
    state,
    response,
    policy.calibrator,
  );
  const accepted = candidateScores.filter(
    ({ score }) => score >= (threshold.threshold as number),
  );
  if (accepted.length > 0) {
    return {
      requestId,
      action: SYSTEM1_EVAL_ACTIONS.COMMIT,
      acceptedCandidateIds: accepted.map(({ optionId }) => optionId),
      acceptedTargetIds: accepted.map(({ targetId }) => targetId),
    };
  }

  if (unknownControlWins(state, response))
    return {
      requestId,
      action: SYSTEM1_EVAL_ACTIONS.UNKNOWN,
      acceptedCandidateIds: [],
      acceptedTargetIds: [],
    };
  return verify();
}
