import { SemanticDecisionOptionKinds } from "@workspace/contracts";
import {
  SYSTEM1_AMBIGUITY_CLASS_ORDER,
  SYSTEM1_EVIDENCE_STATUSES,
  SYSTEM1_SPLITS,
} from "../system1-constants.js";
import {
  SYSTEM1_EVAL_ACTIONS,
  SYSTEM1_EVAL_CERTIFICATION_MODES,
  SYSTEM1_EVAL_CANDIDATE_SIZE_BUCKETS,
  SYSTEM1_EVAL_CANDIDATE_SIZE_OVERFLOW_BUCKET,
  SYSTEM1_EVAL_CANDIDATE_MISSING_EVIDENCE,
  SYSTEM1_EVAL_MISSING_EVIDENCE_KEYS,
  SYSTEM1_EVAL_PRECISION_TARGETS,
  SYSTEM1_EVAL_PRECISION_TARGET_KEYS,
  SYSTEM1_EVAL_RELIABILITY_BIN_COUNT,
  SYSTEM1_EVAL_SCORER_STATUSES,
  SYSTEM1_EVAL_SLICE_DIMENSIONS,
  SYSTEM1_EVAL_WILSON_Z_95,
} from "./system1-eval-constants.js";
import {
  calibrateSystem1Score,
  minimumIndependentCommitsForZeroErrorPrecision,
} from "./system1-eval-calibration.js";
import { aggregateCommittedDuplicateGroups } from "./system1-eval-independent-units.js";
import {
  decideSystem1Request,
  system1LabelExclusionReason,
} from "./system1-eval-policy.js";
import type {
  System1CalibrationMetrics,
  System1EvalExample,
  System1DecisionResult,
  System1EvaluationPolicy,
  System1CandidateLevelMetrics,
  System1RateMetric,
  System1ReliabilityBin,
  System1RequestLevelMetrics,
  System1SliceMetrics,
  System1SplitMetrics,
  System1TargetMetrics,
  System1RiskCoveragePoint,
  System1IndependentGroupMetrics,
} from "./system1-eval-types.js";
import { system1RepoFamily } from "./system1-eval-folds.js";
import type { System1DatasetRecord } from "../system1-types.js";

interface RateInput {
  readonly numerator: number;
  readonly denominator: number;
}

interface CalibrationObservation {
  readonly score: number;
  readonly positive: boolean;
}

function wilsonInterval(
  successes: number,
  trials: number,
): System1RateMetric["interval95"] {
  if (trials === 0) return null;
  const z = SYSTEM1_EVAL_WILSON_Z_95;
  const zSquared = z * z;
  const proportion = successes / trials;
  const divisor = 1 + zSquared / trials;
  const center = (proportion + zSquared / (2 * trials)) / divisor;
  const halfWidth =
    (z *
      Math.sqrt(
        (proportion * (1 - proportion)) / trials +
          zSquared / (4 * trials * trials),
      )) /
    divisor;
  return {
    lower: Math.max(0, center - halfWidth),
    upper: Math.min(1, center + halfWidth),
  };
}

function rate({ numerator, denominator }: RateInput): System1RateMetric {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
    interval95: wilsonInterval(numerator, denominator),
  };
}

function candidateOptions(state: System1DatasetRecord) {
  return state.request.options.filter(
    (option) => option.kind === SemanticDecisionOptionKinds.CANDIDATE,
  );
}

function isTrusted(example: System1EvalExample): boolean {
  return system1LabelExclusionReason(example.labels) === null;
}

function isCalibrationEligible(example: System1EvalExample): boolean {
  return (
    isTrusted(example) &&
    !example.labels.candidateMiss &&
    example.response.status === SYSTEM1_EVAL_SCORER_STATUSES.OK
  );
}

export function system1CalibratorForExample(
  example: System1EvalExample,
  policy: System1EvaluationPolicy,
): System1EvaluationPolicy["calibrator"] {
  if (
    policy.certificationMode ===
      SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT &&
    (example.split === SYSTEM1_SPLITS.TRAIN ||
      example.split === SYSTEM1_SPLITS.CALIBRATION)
  ) {
    const family = system1RepoFamily(example.state);
    const fold = policy.foldCalibrationSummaries?.find(
      (entry) => entry.foldFamily === family,
    );
    if (!fold)
      throw new Error(
        `Missing OOF calibrator for repository family ${family}.`,
      );
    return fold.calibrator;
  }
  return policy.calibrator;
}

function getCalibrationObservations(
  examples: readonly System1EvalExample[],
  policy: System1EvaluationPolicy,
): CalibrationObservation[] {
  const observations: CalibrationObservation[] = [];
  for (const example of examples) {
    if (!isCalibrationEligible(example)) continue;
    const calibrator = system1CalibratorForExample(example, policy);
    for (const option of candidateOptions(example.state)) {
      const rawScore = example.response.scores[option.id];
      const targetId = option.attributes?.targetId;
      if (typeof rawScore !== "number" || typeof targetId !== "string")
        continue;
      observations.push({
        score: calibrateSystem1Score(calibrator, rawScore),
        positive: example.labels.positiveTargetIds.includes(targetId),
      });
    }
  }
  return observations;
}

function calibrationMetrics(
  examples: readonly System1EvalExample[],
  policy: System1EvaluationPolicy,
  includeRiskCoverage: boolean,
): System1CalibrationMetrics {
  const observations = getCalibrationObservations(examples, policy);
  const bins: CalibrationObservation[][] = Array.from(
    { length: SYSTEM1_EVAL_RELIABILITY_BIN_COUNT },
    () => [],
  );
  for (const observation of observations) {
    const binIndex = Math.min(
      SYSTEM1_EVAL_RELIABILITY_BIN_COUNT - 1,
      Math.floor(observation.score * SYSTEM1_EVAL_RELIABILITY_BIN_COUNT),
    );
    bins[binIndex].push(observation);
  }

  let weightedError = 0;
  let squaredError = 0;
  for (const observation of observations) {
    const difference = observation.score - Number(observation.positive);
    squaredError += difference * difference;
  }
  const reliability: System1ReliabilityBin[] = bins.map((items, index) => {
    const positiveCount = items.filter(({ positive }) => positive).length;
    const observedRate = rate({
      numerator: positiveCount,
      denominator: items.length,
    });
    const meanConfidence =
      items.length > 0
        ? items.reduce((sum, { score }) => sum + score, 0) / items.length
        : null;
    if (meanConfidence !== null && observedRate.rate !== null)
      weightedError +=
        (items.length / Math.max(observations.length, 1)) *
        Math.abs(meanConfidence - observedRate.rate);
    return {
      index,
      lowerBound: index / SYSTEM1_EVAL_RELIABILITY_BIN_COUNT,
      upperBound: (index + 1) / SYSTEM1_EVAL_RELIABILITY_BIN_COUNT,
      sampleCount: items.length,
      meanConfidence,
      observedRate,
    };
  });

  return {
    measurementSplit: examples[0]?.split ?? SYSTEM1_SPLITS.CALIBRATION,
    method: policy.calibrationMethod,
    scoredRequestCount: new Set(
      examples
        .filter(isCalibrationEligible)
        .map(({ state }) => state.request.requestId),
    ).size,
    candidateCount: observations.length,
    ece: observations.length > 0 ? weightedError : null,
    brierScore:
      observations.length > 0 ? squaredError / observations.length : null,
    reliability,
    riskCoverage: includeRiskCoverage
      ? riskCoverageCurve(examples, policy)
      : [],
  };
}

function acceptedTargetSetIsExact(
  acceptedTargetIds: readonly string[],
  positiveTargetIds: readonly string[],
): boolean {
  const accepted = new Set(acceptedTargetIds);
  const gold = new Set(positiveTargetIds);
  return (
    accepted.size === gold.size && [...accepted].every((id) => gold.has(id))
  );
}

function riskCoverageCurve(
  examples: readonly System1EvalExample[],
  policy: System1EvaluationPolicy,
): readonly System1RiskCoveragePoint[] {
  const trusted = examples.filter(isTrusted);
  const scoresByRequest = new Map<
    string,
    readonly { targetId: string; score: number }[]
  >();
  const thresholdSet = new Set<number>();
  for (const example of trusted) {
    const calibrator = system1CalibratorForExample(example, policy);
    const scores =
      example.response.status === SYSTEM1_EVAL_SCORER_STATUSES.OK
        ? candidateOptions(example.state).flatMap((option) => {
            const targetId = option.attributes?.targetId;
            const rawScore = example.response.scores[option.id];
            return typeof targetId === "string" &&
              typeof rawScore === "number" &&
              Number.isFinite(rawScore) &&
              rawScore >= 0 &&
              rawScore <= 1
              ? [
                  {
                    targetId,
                    score: calibrateSystem1Score(calibrator, rawScore),
                  },
                ]
              : [];
          })
        : [];
    scores.forEach(({ score }) => thresholdSet.add(score));
    scoresByRequest.set(example.state.request.requestId, scores);
  }
  const trustedGroupCount = new Set(
    trusted.map(({ duplicateGroup }) => duplicateGroup),
  ).size;
  return [...thresholdSet]
    .sort((left, right) => left - right)
    .map((threshold) => {
      const accepted = trusted.map((example) => {
        const targetIds = (
          scoresByRequest.get(example.state.request.requestId) ?? []
        )
          .filter(({ score }) => score >= threshold)
          .map(({ targetId }) => targetId);
        return {
          example,
          committed: targetIds.length > 0,
          exact: acceptedTargetSetIsExact(
            targetIds,
            example.labels.positiveTargetIds,
          ),
        };
      });
      const committedRows = accepted.filter(({ committed }) => committed);
      const groups = aggregateCommittedDuplicateGroups(accepted, {
        duplicateGroup: ({ example }) => example.duplicateGroup,
        committed: ({ committed }) => committed,
        exact: ({ exact }) => exact,
      });
      const exactRows = committedRows.filter(({ exact }) => exact).length;
      const exactGroups = groups.filter(({ exact }) => exact).length;
      return {
        threshold,
        rowCommittedCount: committedRows.length,
        rowCoverage:
          trusted.length > 0 ? committedRows.length / trusted.length : null,
        rowExactSetPrecision:
          committedRows.length > 0 ? exactRows / committedRows.length : null,
        independentCommittedCount: groups.length,
        independentCoverage:
          trustedGroupCount > 0 ? groups.length / trustedGroupCount : null,
        independentExactSetPrecision:
          groups.length > 0 ? exactGroups / groups.length : null,
      };
    });
}

function topCandidateIsPositive(example: System1EvalExample): boolean | null {
  if (example.response.status !== SYSTEM1_EVAL_SCORER_STATUSES.OK) return null;
  let top: { readonly targetId: string; readonly score: number } | null = null;
  for (const option of candidateOptions(example.state)) {
    const targetId = option.attributes?.targetId;
    const score = example.response.scores[option.id];
    if (typeof targetId !== "string" || typeof score !== "number") continue;
    if (top === null || score > top.score) top = { targetId, score };
  }
  return top === null
    ? null
    : example.labels.positiveTargetIds.includes(top.targetId);
}

function requestLevelMetrics(
  trusted: readonly System1EvalExample[],
  decisions: ReadonlyMap<string, System1DecisionResult>,
): System1RequestLevelMetrics {
  let commitCount = 0;
  let exactSetCount = 0;
  let unknownCount = 0;
  let verifyCount = 0;
  let falseSafeCount = 0;
  let candidateMissCommits = 0;
  for (const example of trusted) {
    const decision = decisions.get(example.state.request.requestId);
    if (!decision) continue;
    if (decision.action === SYSTEM1_EVAL_ACTIONS.COMMIT) {
      commitCount += 1;
      const exact = acceptedTargetSetIsExact(
        decision.acceptedTargetIds,
        example.labels.positiveTargetIds,
      );
      if (exact) exactSetCount += 1;
      else falseSafeCount += 1;
      if (example.labels.candidateMiss) candidateMissCommits += 1;
    } else if (decision.action === SYSTEM1_EVAL_ACTIONS.UNKNOWN) {
      unknownCount += 1;
    } else {
      verifyCount += 1;
    }
  }
  const independentGroups = aggregateCommittedDuplicateGroups(
    trusted.map((example) => {
      const decision = decisions.get(example.state.request.requestId);
      const exact = decision
        ? acceptedTargetSetIsExact(
            decision.acceptedTargetIds,
            example.labels.positiveTargetIds,
          )
        : false;
      return {
        example,
        committed: decision?.action === SYSTEM1_EVAL_ACTIONS.COMMIT,
        exact,
      };
    }),
    {
      duplicateGroup: ({ example }) => example.duplicateGroup,
      committed: ({ committed }) => committed,
      exact: ({ exact }) => exact,
    },
  );
  const trustedGroupCount = new Set(
    trusted.map(({ duplicateGroup }) => duplicateGroup),
  ).size;
  const exactGroupCount = independentGroups.filter(({ exact }) => exact).length;
  return {
    commitRate: rate({ numerator: commitCount, denominator: trusted.length }),
    lspAvoidanceRate: rate({
      numerator: commitCount,
      denominator: trusted.length,
    }),
    exactSetPrecision: rate({
      numerator: exactSetCount,
      denominator: commitCount,
    }),
    unknownRate: rate({ numerator: unknownCount, denominator: trusted.length }),
    verifyRate: rate({ numerator: verifyCount, denominator: trusted.length }),
    abstentionRate: rate({
      numerator: unknownCount + verifyCount,
      denominator: trusted.length,
    }),
    falseSafePerTrustedRequest: rate({
      numerator: falseSafeCount,
      denominator: trusted.length,
    }),
    falseSafeAmongCommits: rate({
      numerator: falseSafeCount,
      denominator: commitCount,
    }),
    candidateMissCommits,
    independentGroups: {
      groupCount: trustedGroupCount,
      committedCount: independentGroups.length,
      exactSetCount: exactGroupCount,
      commitRate: rate({
        numerator: independentGroups.length,
        denominator: trustedGroupCount,
      }),
      exactSetPrecision: rate({
        numerator: exactGroupCount,
        denominator: independentGroups.length,
      }),
    },
  };
}

interface CandidateMetricTotals {
  acceptedCount: number;
  acceptedPositiveCount: number;
  goldPositiveCount: number;
  coveredGoldPositiveCount: number;
  negativeCandidateCount: number;
  falsePositiveCandidateCount: number;
  top1CorrectCount: number;
  top1Count: number;
}

function addOptionDecisionCounts(
  example: System1EvalExample,
  acceptedCandidateIds: ReadonlySet<string>,
  positives: ReadonlySet<string>,
  totals: CandidateMetricTotals,
): void {
  for (const option of candidateOptions(example.state)) {
    const targetId = option.attributes?.targetId;
    if (typeof targetId !== "string") continue;
    const isGoldPositive = positives.has(targetId);
    if (!isGoldPositive) totals.negativeCandidateCount += 1;
    if (!acceptedCandidateIds.has(option.id)) continue;
    totals.acceptedCount += 1;
    if (isGoldPositive) totals.acceptedPositiveCount += 1;
    else totals.falsePositiveCandidateCount += 1;
  }
}

function addCoverageCount(
  positives: ReadonlySet<string>,
  accepted: ReadonlySet<string>,
  totals: CandidateMetricTotals,
): void {
  for (const targetId of positives) {
    if (accepted.has(targetId)) totals.coveredGoldPositiveCount += 1;
  }
}

function addTop1Counts(
  example: System1EvalExample,
  totals: CandidateMetricTotals,
): void {
  const top1 = topCandidateIsPositive(example);
  if (top1 === null) return;
  totals.top1Count += 1;
  if (top1) totals.top1CorrectCount += 1;
}

function candidateLevelMetrics(
  modelEligible: readonly System1EvalExample[],
  decisions: ReadonlyMap<string, System1DecisionResult>,
): System1CandidateLevelMetrics {
  const totals: CandidateMetricTotals = {
    acceptedCount: 0,
    acceptedPositiveCount: 0,
    goldPositiveCount: 0,
    coveredGoldPositiveCount: 0,
    negativeCandidateCount: 0,
    falsePositiveCandidateCount: 0,
    top1CorrectCount: 0,
    top1Count: 0,
  };
  for (const example of modelEligible) {
    const decision = decisions.get(example.state.request.requestId);
    const acceptedCandidateIds = new Set(decision?.acceptedCandidateIds ?? []);
    const acceptedTargetIds = new Set(decision?.acceptedTargetIds ?? []);
    const positives = new Set(example.labels.positiveTargetIds);
    totals.goldPositiveCount += positives.size;
    addOptionDecisionCounts(example, acceptedCandidateIds, positives, totals);
    addCoverageCount(positives, acceptedTargetIds, totals);
    addTop1Counts(example, totals);
  }
  return {
    acceptedDecisionPrecision: rate({
      numerator: totals.acceptedPositiveCount,
      denominator: totals.acceptedCount,
    }),
    goldPositiveCoverage: rate({
      numerator: totals.coveredGoldPositiveCount,
      denominator: totals.goldPositiveCount,
    }),
    falsePositiveRate: rate({
      numerator: totals.falsePositiveCandidateCount,
      denominator: totals.negativeCandidateCount,
    }),
    top1Accuracy: rate({
      numerator: totals.top1CorrectCount,
      denominator: totals.top1Count,
    }),
  };
}

function targetMetrics(
  examples: readonly System1EvalExample[],
  policy: System1EvaluationPolicy,
  targetPrecision: number,
): System1TargetMetrics {
  const trusted = examples.filter(isTrusted);
  const modelEligible = trusted.filter(({ labels }) => !labels.candidateMiss);
  const decisions = new Map(
    trusted.map((example) => [
      example.state.request.requestId,
      decideSystem1Request(
        example.state,
        example.response,
        { ...policy, calibrator: system1CalibratorForExample(example, policy) },
        targetPrecision,
      ),
    ]),
  );

  const certification = policy.precisionTargets.find(
    (entry) => entry.targetPrecision === targetPrecision,
  ) ?? {
    targetPrecision,
    status: "uncertifiable" as const,
    threshold: null,
    calibrationCommitCount: 0,
    calibrationExactSetCount: 0,
    calibrationRowCommitCount: 0,
    calibrationRowExactSetCount: 0,
    minimumIndependentCommits:
      minimumIndependentCommitsForZeroErrorPrecision(targetPrecision),
    independentSupportSufficient: false,
    lowerBound: null,
  };

  return {
    targetPrecision,
    certification,
    requestLevel: requestLevelMetrics(trusted, decisions),
    candidateLevel: candidateLevelMetrics(modelEligible, decisions),
  };
}

function candidateSizeBucket(candidateCount: number): string {
  const bucket = SYSTEM1_EVAL_CANDIDATE_SIZE_BUCKETS.find(
    ({ minimum, maximum }) =>
      candidateCount >= minimum && candidateCount <= maximum,
  );
  return bucket?.key ?? SYSTEM1_EVAL_CANDIDATE_SIZE_OVERFLOW_BUCKET;
}

function hasMissingEvidence(state: System1DatasetRecord): boolean {
  return candidateOptions(state).some(
    (option) =>
      option.attributes?.evidenceStatus ===
        SYSTEM1_EVAL_CANDIDATE_MISSING_EVIDENCE ||
      option.attributes?.evidenceStatus === SYSTEM1_EVIDENCE_STATUSES.MISSING,
  );
}

function buildSlices(
  examples: readonly System1EvalExample[],
  policy: System1EvaluationPolicy,
): System1SliceMetrics[] {
  const groups = new Map<
    string,
    { dimension: string; key: string; rows: System1EvalExample[] }
  >();
  const add = (dimension: string, key: string, example: System1EvalExample) => {
    const groupId = `${dimension}\u0000${key}`;
    const group = groups.get(groupId) ?? { dimension, key, rows: [] };
    group.rows.push(example);
    groups.set(groupId, group);
  };

  for (const className of SYSTEM1_AMBIGUITY_CLASS_ORDER) {
    groups.set(
      `${SYSTEM1_EVAL_SLICE_DIMENSIONS.AMBIGUITY_CLASS}\u0000${className}`,
      {
        dimension: SYSTEM1_EVAL_SLICE_DIMENSIONS.AMBIGUITY_CLASS,
        key: className,
        rows: [],
      },
    );
    groups.set(
      `${SYSTEM1_EVAL_SLICE_DIMENSIONS.NOT_DETECTED_CLASS}\u0000${className}`,
      {
        dimension: SYSTEM1_EVAL_SLICE_DIMENSIONS.NOT_DETECTED_CLASS,
        key: className,
        rows: [],
      },
    );
  }
  for (const key of Object.values(SYSTEM1_EVAL_MISSING_EVIDENCE_KEYS)) {
    groups.set(
      `${SYSTEM1_EVAL_SLICE_DIMENSIONS.MISSING_EVIDENCE}\u0000${key}`,
      {
        dimension: SYSTEM1_EVAL_SLICE_DIMENSIONS.MISSING_EVIDENCE,
        key,
        rows: [],
      },
    );
  }
  for (const example of examples) {
    for (const tag of example.state.ambiguityClasses) {
      add(SYSTEM1_EVAL_SLICE_DIMENSIONS.AMBIGUITY_CLASS, tag, example);
    }
    for (const tag of example.state.notDetectedClasses) {
      add(SYSTEM1_EVAL_SLICE_DIMENSIONS.NOT_DETECTED_CLASS, tag, example);
    }
    add(
      SYSTEM1_EVAL_SLICE_DIMENSIONS.REPO_FAMILY,
      system1RepoFamily(example.state),
      example,
    );
    add(
      SYSTEM1_EVAL_SLICE_DIMENSIONS.CANDIDATE_SET_SIZE,
      candidateSizeBucket(example.state.candidateCount),
      example,
    );
    add(
      SYSTEM1_EVAL_SLICE_DIMENSIONS.MISSING_EVIDENCE,
      hasMissingEvidence(example.state)
        ? SYSTEM1_EVAL_MISSING_EVIDENCE_KEYS.HAS
        : SYSTEM1_EVAL_MISSING_EVIDENCE_KEYS.NONE,
      example,
    );
  }

  const sizeDimension = SYSTEM1_EVAL_SLICE_DIMENSIONS.CANDIDATE_SET_SIZE;
  for (const bucket of SYSTEM1_EVAL_CANDIDATE_SIZE_BUCKETS) {
    const key = `${sizeDimension}\u0000${bucket.key}`;
    if (!groups.has(key))
      groups.set(key, { dimension: sizeDimension, key: bucket.key, rows: [] });
  }
  const overflowKey = `${sizeDimension}\u0000${SYSTEM1_EVAL_CANDIDATE_SIZE_OVERFLOW_BUCKET}`;
  if (!groups.has(overflowKey))
    groups.set(overflowKey, {
      dimension: sizeDimension,
      key: SYSTEM1_EVAL_CANDIDATE_SIZE_OVERFLOW_BUCKET,
      rows: [],
    });
  const orderedGroups = [...groups.values()].sort(
    (left, right) =>
      sliceDimensionOrder(left.dimension) -
        sliceDimensionOrder(right.dimension) ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  );
  return orderedGroups.map(({ dimension, key, rows }) => {
    const trustedRequestCount = rows.filter(isTrusted).length;
    const candidateMissCount = rows.filter(
      ({ labels }) => labels.candidateMiss,
    ).length;
    return {
      dimension: dimension as System1SliceMetrics["dimension"],
      key,
      sampleCount: rows.length,
      trustedRequestCount,
      candidateMissCount,
      calibration: calibrationMetrics(rows, policy, false),
      byPrecisionTarget: Object.fromEntries(
        SYSTEM1_EVAL_PRECISION_TARGETS.map((targetPrecision, index) => [
          SYSTEM1_EVAL_PRECISION_TARGET_KEYS[index],
          targetMetrics(rows, policy, targetPrecision),
        ]),
      ),
    };
  });
}

function sliceDimensionOrder(dimension: string): number {
  const order: readonly string[] = Object.values(SYSTEM1_EVAL_SLICE_DIMENSIONS);
  return order.indexOf(dimension);
}

/** Pure label-aware split metrics; all precision denominators use trusted labels only. */
export function computeSystem1SplitMetrics(
  examples: readonly System1EvalExample[],
  policy: System1EvaluationPolicy,
): System1SplitMetrics {
  const firstSplit = examples[0]?.split ?? SYSTEM1_SPLITS.CALIBRATION;
  const excludedLabelCounts: Record<string, number> = {};
  for (const example of examples) {
    const reason = system1LabelExclusionReason(example.labels);
    if (reason !== null)
      excludedLabelCounts[reason] = (excludedLabelCounts[reason] ?? 0) + 1;
  }
  const candidateMissCount = examples.filter(
    ({ labels }) => labels.candidateMiss,
  ).length;
  return {
    split: firstSplit,
    sampleCount: examples.length,
    trustedRequestCount: examples.filter(isTrusted).length,
    excludedLabelCounts: Object.fromEntries(
      Object.entries(excludedLabelCounts).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
    candidateMissCount,
    calibration: calibrationMetrics(examples, policy, true),
    byPrecisionTarget: Object.fromEntries(
      SYSTEM1_EVAL_PRECISION_TARGETS.map((targetPrecision, index) => [
        SYSTEM1_EVAL_PRECISION_TARGET_KEYS[index],
        targetMetrics(examples, policy, targetPrecision),
      ]),
    ),
    slices: buildSlices(examples, policy),
  };
}
