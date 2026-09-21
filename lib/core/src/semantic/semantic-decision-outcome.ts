import {
  DocuviaError,
  ErrorCodes,
  SemanticDecisionScoreKinds,
  SemanticDecisionStatuses,
  SemanticDecisionUnavailableCodes,
  type SemanticDecisionOutcome,
  type SemanticDecisionRequest,
} from "@workspace/contracts";
import {
  hasKeys,
  IDENTITY_KEYS,
  isNonBlank,
  isProbability,
  isRecord,
  matchesIdentity,
} from "./semantic-decision-shapes.js";

function isModel(value: unknown): boolean {
  const keys = ["provider", "modelId", "modelVersion", "artifactHash"];
  return (
    isRecord(value) &&
    hasKeys(value, keys) &&
    keys.every((key) => isNonBlank(value[key]))
  );
}

function isCalibration(value: Record<string, unknown>): boolean {
  if (value.scoreKind === SemanticDecisionScoreKinds.RAW)
    return value.calibrationVersion === null;
  return (
    value.scoreKind === SemanticDecisionScoreKinds.CALIBRATED &&
    isNonBlank(value.calibrationVersion)
  );
}

function isScore(value: unknown, id: string): boolean {
  return (
    isRecord(value) &&
    hasKeys(value, ["optionId", "probability"]) &&
    value.optionId === id &&
    isProbability(value.probability)
  );
}

function isScored(
  request: SemanticDecisionRequest,
  value: Record<string, unknown>,
): boolean {
  if (
    !hasKeys(value, [
      ...IDENTITY_KEYS,
      "status",
      "scores",
      "model",
      "scoreKind",
      "calibrationVersion",
    ])
  )
    return false;
  if (!isModel(value.model) || !isCalibration(value)) return false;
  const scores = value.scores;
  return (
    Array.isArray(scores) &&
    scores.length === request.options.length &&
    request.options.every((option, index) => isScore(scores[index], option.id))
  );
}

function isUnavailable(value: Record<string, unknown>): boolean {
  if (
    !hasKeys(value, [
      ...IDENTITY_KEYS,
      "status",
      "scores",
      "unavailableCode",
      "unavailableReason",
    ])
  )
    return false;
  return (
    Array.isArray(value.scores) &&
    value.scores.length === 0 &&
    isNonBlank(value.unavailableReason) &&
    Object.values(SemanticDecisionUnavailableCodes).some(
      (code) => code === value.unavailableCode,
    )
  );
}

function isOutcome(
  request: SemanticDecisionRequest,
  value: unknown,
): value is SemanticDecisionOutcome {
  if (!isRecord(value) || !matchesIdentity(request, value)) return false;
  if (value.status === SemanticDecisionStatuses.SCORED)
    return isScored(request, value);
  return (
    value.status === SemanticDecisionStatuses.UNAVAILABLE &&
    isUnavailable(value)
  );
}

export function validateSemanticOutcome(
  request: SemanticDecisionRequest,
  value: unknown,
): SemanticDecisionOutcome {
  if (!isOutcome(request, value)) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_RESPONSE,
      "Invalid semantic decision response",
    );
  }
  return JSON.parse(JSON.stringify(value)) as SemanticDecisionOutcome;
}
