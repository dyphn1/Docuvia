import { createHash } from "node:crypto";
import { SemanticDecisionOptionKinds } from "@workspace/contracts";
import { SYSTEM1_OPTION_IDS, SYSTEM1_SPLITS } from "../system1-constants.js";
import {
  SYSTEM1_EVAL_ACTIONS,
  SYSTEM1_EVAL_CALIBRATION_METHOD,
  SYSTEM1_EVAL_CERTIFICATION_MODES,
  SYSTEM1_EVAL_DEFAULT_MIN_FAMILY_COMMITS,
  SYSTEM1_EVAL_FAMILY_REQUIREMENT,
  SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS,
  SYSTEM1_EVAL_TRAINING_MODES,
  SYSTEM1_EVAL_ONE_SIDED_ALPHA,
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
  System1OOFFamilyTable,
  System1OOFDiagnosticKind,
  System1RepoFamilyFold,
  System1ScorerResponse,
  System1ScorerTrainingManifest,
} from "./system1-eval-types.js";
import {
  buildSystem1RepoFamilyFolds,
  assertSystem1FittingPoolSplits,
  createSystem1ScorerTrainingManifest,
  system1RepoFamily,
  validateSystem1OutOfFoldAssignments,
} from "./system1-eval-folds.js";
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

interface OOFScoredRequest {
  readonly example: System1EvalExample;
  readonly family: string;
  readonly candidates: readonly {
    readonly targetId: string;
    readonly score: number;
  }[];
}

interface ThresholdFamilyCounts {
  commits: number;
  exactSetCount: number;
}

interface OOFThresholdCounts {
  readonly pooledCommits: number;
  readonly pooledExactSetCount: number;
  readonly pooledLowerBound: number | null;
  readonly familyCounts: ReadonlyMap<string, ThresholdFamilyCounts>;
  readonly familyGatePasses: boolean;
}

function stableSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function scoredOOFRequests(
  examples: readonly System1EvalExample[],
  foldCalibrators: ReadonlyMap<string, System1EvaluationPolicy["calibrator"]>,
): readonly OOFScoredRequest[] {
  return examples.map((example) => {
    const family = system1RepoFamily(example.state);
    const calibrator = foldCalibrators.get(family);
    if (!calibrator) throw new Error(`No OOF calibrator for ${family}.`);
    return {
      example,
      family,
      candidates:
        example.response.status === SYSTEM1_EVAL_SCORER_STATUSES.OK
          ? candidateOptions(example.state).flatMap((option) => {
              const targetId = option.attributes?.targetId;
              const score = example.response.scores[option.id];
              return typeof targetId === "string" &&
                typeof score === "number" &&
                Number.isFinite(score) &&
                score >= 0 &&
                score <= 1
                ? [
                    {
                      targetId,
                      score: calibrateSystem1Score(calibrator, score),
                    },
                  ]
                : [];
            })
          : [],
    };
  });
}

function evaluateOOFThreshold(
  requests: readonly OOFScoredRequest[],
  families: readonly string[],
  threshold: number,
  targetPrecision: number,
  minimumFamilyCommits: number,
): OOFThresholdCounts {
  const familyCounts = new Map<string, ThresholdFamilyCounts>(
    families.map((family) => [family, { commits: 0, exactSetCount: 0 }]),
  );
  let pooledCommits = 0;
  let pooledExactSetCount = 0;
  for (const request of requests) {
    if (system1LabelExclusionReason(request.example.labels) !== null) continue;
    const accepted = new Set(
      request.candidates
        .filter(({ score }) => score >= threshold)
        .map(({ targetId }) => targetId),
    );
    if (accepted.size === 0) continue;
    pooledCommits += 1;
    const gold = new Set(request.example.labels.positiveTargetIds);
    const exact =
      accepted.size === gold.size && [...accepted].every((id) => gold.has(id));
    const family = familyCounts.get(request.family);
    if (!family)
      throw new Error(
        `OOF score is outside the family pool: ${request.family}`,
      );
    family.commits += 1;
    if (exact) {
      pooledExactSetCount += 1;
      family.exactSetCount += 1;
    }
  }
  const pooledLowerBound =
    pooledCommits > 0
      ? clopperPearsonLowerBound(pooledExactSetCount, pooledCommits)
      : null;
  const familyGatePasses = [...familyCounts.values()].every((counts) => {
    if (counts.commits < minimumFamilyCommits) return true;
    return counts.exactSetCount / counts.commits >= targetPrecision;
  });
  return {
    pooledCommits,
    pooledExactSetCount,
    pooledLowerBound,
    familyCounts,
    familyGatePasses,
  };
}

function oofFamilyTable(
  counts: OOFThresholdCounts,
  families: readonly string[],
  evaluatedThreshold: number | null,
  targetPrecision: number,
  minimumFamilyCommits: number,
  diagnosticKind: System1OOFDiagnosticKind,
): System1OOFFamilyTable {
  const familyRows = families.map((family) => {
    const value = counts.familyCounts.get(family) ?? {
      commits: 0,
      exactSetCount: 0,
    };
    const usedForFamilyGate = value.commits >= minimumFamilyCommits;
    const exactSetPrecision =
      value.commits > 0 ? value.exactSetCount / value.commits : null;
    return {
      family,
      commits: value.commits,
      exactSetCount: value.exactSetCount,
      exactSetPrecision,
      lowerBound:
        value.commits > 0
          ? clopperPearsonLowerBound(value.exactSetCount, value.commits)
          : null,
      usedForFamilyGate,
      familyGateSatisfied:
        usedForFamilyGate && exactSetPrecision !== null
          ? exactSetPrecision >= targetPrecision
          : null,
    };
  });
  const familyLowerBounds = familyRows.flatMap(({ lowerBound }) =>
    lowerBound === null ? [] : [lowerBound],
  );
  return {
    diagnosticKind,
    evaluatedThreshold,
    families: familyRows,
    pooledCommitCount: counts.pooledCommits,
    pooledExactSetCount: counts.pooledExactSetCount,
    pooledLowerBound: counts.pooledLowerBound,
    worstFamilyLowerBound:
      familyLowerBounds.length > 0 ? Math.min(...familyLowerBounds) : null,
  };
}

interface OOFThresholdCandidate {
  readonly threshold: number;
  readonly counts: OOFThresholdCounts;
}

function isBetterPooledDiagnostic(
  candidate: OOFThresholdCandidate,
  current: OOFThresholdCandidate | null,
): boolean {
  if (current === null) return true;
  const candidateBound = candidate.counts.pooledLowerBound ?? -1;
  const currentBound = current.counts.pooledLowerBound ?? -1;
  return (
    candidateBound > currentBound ||
    (candidateBound === currentBound &&
      candidate.counts.pooledCommits > current.counts.pooledCommits)
  );
}

function isStricterPooledDiagnostic(
  candidate: OOFThresholdCandidate,
  current: OOFThresholdCandidate | null,
): boolean {
  if (current === null) return true;
  const candidateBound = candidate.counts.pooledLowerBound ?? -1;
  const currentBound = current.counts.pooledLowerBound ?? -1;
  return (
    candidateBound > currentBound ||
    (candidateBound === currentBound &&
      (candidate.counts.pooledCommits < current.counts.pooledCommits ||
        (candidate.counts.pooledCommits === current.counts.pooledCommits &&
          candidate.threshold > current.threshold)))
  );
}

function inspectOOFThresholdCandidates(
  requests: readonly OOFScoredRequest[],
  families: readonly string[],
  targetPrecision: number,
  minimumFamilyCommits: number,
): {
  readonly selected: OOFThresholdCandidate | null;
  readonly bestPooled: OOFThresholdCandidate | null;
  readonly strictest: OOFThresholdCandidate | null;
  readonly leastStrict: OOFThresholdCandidate | null;
} {
  const thresholds = [
    ...new Set(
      requests.flatMap(({ candidates }) =>
        candidates.map(({ score }) => score),
      ),
    ),
  ].sort((left, right) => left - right);
  let leastStrict: OOFThresholdCandidate | null = null;
  let bestPooled: OOFThresholdCandidate | null = null;
  let strictest: OOFThresholdCandidate | null = null;
  let selected: OOFThresholdCandidate | null = null;
  for (const threshold of thresholds) {
    const counts = evaluateOOFThreshold(
      requests,
      families,
      threshold,
      targetPrecision,
      minimumFamilyCommits,
    );
    const candidate = { threshold, counts };
    leastStrict ??= candidate;
    if (isStricterPooledDiagnostic(candidate, strictest)) strictest = candidate;
    if (isBetterPooledDiagnostic(candidate, bestPooled)) bestPooled = candidate;
    if (
      selected === null &&
      pooledBoundMeetsTarget(counts, targetPrecision) &&
      counts.familyGatePasses
    )
      selected = candidate;
  }
  return { selected, bestPooled, strictest, leastStrict };
}

function pooledBoundMeetsTarget(
  counts: OOFThresholdCounts,
  targetPrecision: number,
): boolean {
  return (
    counts.pooledLowerBound !== null &&
    counts.pooledLowerBound >= targetPrecision
  );
}

function emptyOOFFamilyTable(
  families: readonly string[],
  diagnosticKind: System1OOFDiagnosticKind,
): System1OOFFamilyTable {
  return {
    diagnosticKind,
    evaluatedThreshold: null,
    families: families.map((family) => ({
      family,
      commits: 0,
      exactSetCount: 0,
      exactSetPrecision: null,
      lowerBound: null,
      usedForFamilyGate: false,
      familyGateSatisfied: null,
    })),
    pooledCommitCount: 0,
    pooledExactSetCount: 0,
    pooledLowerBound: null,
    worstFamilyLowerBound: null,
  };
}

function lofoThresholdCertification(
  requests: readonly OOFScoredRequest[],
  families: readonly string[],
  targetPrecision: number,
  minimumFamilyCommits: number,
): System1PrecisionThreshold {
  const candidates = inspectOOFThresholdCandidates(
    requests,
    families,
    targetPrecision,
    minimumFamilyCommits,
  );
  const selected = candidates.selected;
  const familyTable = selected
    ? oofFamilyTable(
        selected.counts,
        families,
        selected.threshold,
        targetPrecision,
        minimumFamilyCommits,
        SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS.CERTIFIED,
      )
    : candidates.bestPooled
      ? oofFamilyTable(
          candidates.bestPooled.counts,
          families,
          candidates.bestPooled.threshold,
          targetPrecision,
          minimumFamilyCommits,
          SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS.BEST_POOLED_LOWER_BOUND,
        )
      : emptyOOFFamilyTable(
          families,
          SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS.BEST_POOLED_LOWER_BOUND,
        );
  const diagnosticCandidates = selected
    ? []
    : [
        {
          candidate: candidates.bestPooled,
          kind: SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS.BEST_POOLED_LOWER_BOUND,
        },
        {
          candidate: candidates.strictest,
          kind: SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS.STRICTEST,
        },
        {
          candidate: candidates.leastStrict,
          kind: SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS.LEAST_STRICT,
        },
      ];
  const familyDiagnostics = diagnosticCandidates.map(({ candidate, kind }) =>
    candidate
      ? oofFamilyTable(
          candidate.counts,
          families,
          candidate.threshold,
          targetPrecision,
          minimumFamilyCommits,
          kind,
        )
      : emptyOOFFamilyTable(families, kind),
  );
  return {
    targetPrecision,
    status:
      selected === null
        ? SYSTEM1_EVAL_THRESHOLD_STATUSES.UNCERTIFIABLE
        : SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED,
    threshold: selected?.threshold ?? null,
    calibrationCommitCount: familyTable.pooledCommitCount,
    calibrationExactSetCount: familyTable.pooledExactSetCount,
    lowerBound: familyTable.pooledLowerBound,
    oofFamilyTable: familyTable,
    ...(selected === null ? { oofFamilyDiagnostics: familyDiagnostics } : {}),
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
    certificationMode: SYSTEM1_EVAL_CERTIFICATION_MODES.CALIBRATION_ONLY,
    precisionTargets: SYSTEM1_EVAL_PRECISION_TARGETS.map((targetPrecision) =>
      thresholdCertification(examples, targetPrecision, calibrator),
    ),
  };
}

/**
 * Fits and certifies on train+calibration out-of-family scores only. Each
 * request is calibrated with the fold map that excluded its repository family.
 */
export function fitSystem1LeaveOneFamilyOutPolicy(
  examples: readonly System1EvalExample[],
  scorerManifestHash: string,
  folds: readonly System1RepoFamilyFold[] = buildSystem1RepoFamilyFolds(
    examples.map(({ state }) => state.request.evidence.repoId),
  ),
  minimumFamilyCommits = SYSTEM1_EVAL_DEFAULT_MIN_FAMILY_COMMITS,
  trainingManifest: System1ScorerTrainingManifest = createSystem1ScorerTrainingManifest(
    SYSTEM1_EVAL_TRAINING_MODES.NO_TRAINING,
    folds,
    folds.map(({ foldFamily }) => foldFamily),
  ),
): System1EvaluationPolicy {
  assertSystem1FittingPoolSplits(examples.map(({ split }) => split));
  if (!Number.isSafeInteger(minimumFamilyCommits) || minimumFamilyCommits < 1)
    throw new Error(
      "The minimum family commit count must be a positive integer.",
    );
  validateSystem1OutOfFoldAssignments(
    examples.map(({ state }) => state),
    examples.map(({ response }) => response),
    folds,
    trainingManifest,
  );
  const families = folds.map(({ foldFamily }) => foldFamily);
  const foldCalibrators = new Map<
    string,
    System1EvaluationPolicy["calibrator"]
  >();
  const foldCalibrationSummaries = folds.map((fold) => {
    const observations = calibrationObservations(
      examples.filter(
        ({ state }) => system1RepoFamily(state) !== fold.foldFamily,
      ),
    );
    const calibrator = fitSystem1IsotonicCalibrator(observations);
    foldCalibrators.set(fold.foldFamily, calibrator);
    return {
      foldFamily: fold.foldFamily,
      trainingFamilies: fold.trainingFamilies,
      observationCount: calibrator.observationCount,
      calibrationSha256: stableSha256(calibrator),
    };
  });
  const requests = scoredOOFRequests(examples, foldCalibrators);
  const finalCalibrator = fitSystem1IsotonicCalibrator(
    calibrationObservations(examples),
  );
  return {
    schemaVersion: SYSTEM1_EVAL_SCHEMA_VERSION,
    calibrationMethod: SYSTEM1_EVAL_CALIBRATION_METHOD,
    scorerManifestHash,
    calibrator: finalCalibrator,
    certificationMode: SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT,
    minFamilyCommits: minimumFamilyCommits,
    folds,
    foldCalibrationSummaries,
    certificationRule: {
      pooledOneSidedClopperPearsonLowerBound: true,
      alpha: SYSTEM1_EVAL_ONE_SIDED_ALPHA,
      minimumFamilyCommits,
      familyRequirement: SYSTEM1_EVAL_FAMILY_REQUIREMENT,
      foldTrainingFamilies: trainingManifest.foldTrainingFamilies,
    },
    precisionTargets: SYSTEM1_EVAL_PRECISION_TARGETS.map((targetPrecision) =>
      lofoThresholdCertification(
        requests,
        families,
        targetPrecision,
        minimumFamilyCommits,
      ),
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
