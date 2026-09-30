import type {
  System1LabelRecord,
  System1LabelsInput,
} from "./system1-types.js";

/** Label projection is deliberately separate from the state builder and its input type. */
export function buildSystem1Labels(
  input: System1LabelsInput,
): System1LabelRecord {
  const candidateTargets = new Set(input.candidateTargetIds);
  return {
    requestId: input.requestId,
    positiveTargetIds: [...input.positiveTargetIds],
    negativeTargetIds: [...input.negativeTargetIds],
    reviewStatus: input.reviewStatus,
    oracleStatus: input.oracleStatus,
    candidateMiss: input.positiveTargetIds.some(
      (targetId) => !candidateTargets.has(targetId),
    ),
  };
}
