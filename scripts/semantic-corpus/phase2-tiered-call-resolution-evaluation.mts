import { createHash } from "node:crypto";
import type {
  AstCallSiteShapeFact,
  CallResolutionCalibrationRecord,
  CallResolutionCalibrationFamilyMetric,
} from "../../lib/contracts/src/index.js";
import { CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION } from "../../lib/contracts/src/index.js";
import { clopperPearsonLowerBound } from "../../lib/core/src/semantic/system1/eval/system1-eval-calibration.js";

export interface Phase2EvaluationObservation {
  readonly sampleId: string;
  readonly split: string;
  readonly duplicateGroup: string;
  readonly repoFamily: string;
  /** Present in snapshot-scoped candidate prediction artifacts (schema v2). */
  readonly snapshotId?: string;
  /** Repository identity from the pinned source sidecar, not the oracle label. */
  readonly repoId?: string;
  readonly calleeKind?: AstCallSiteShapeFact["calleeKind"] | "unmapped";
  readonly ruleSignature: string | null;
  readonly candidateTargetIds: readonly string[];
  readonly topTargetId: string | null;
  readonly topRankScore: number | null;
  readonly tied: boolean;
  readonly candidateSetComplete: boolean;
  readonly truncated: boolean;
  readonly unsupportedCallShape: boolean;
  readonly generatedCandidateCount?: number;
  readonly ambiguousCandidateMappingCount?: number;
  readonly unmappedGeneratedCandidateCount?: number;
  readonly proposedCandidateCount?: number;
  readonly reason?: string;
}

export interface Phase2CandidateRecallGroupMetrics {
  readonly name: string;
  readonly eligibleSiteCount: number;
  readonly candidateGoldTargetCount: number;
  readonly coveredGoldTargetCount: number;
  readonly candidateRecall: number;
  readonly zeroCandidateSiteCount: number;
  readonly candidateWithoutOracleIdSiteCount: number;
}

export interface Phase2CandidateRecallMetrics {
  readonly split: string;
  readonly eligibleSiteCount: number;
  readonly candidateGoldTargetCount: number;
  readonly coveredGoldTargetCount: number;
  readonly candidateRecall: number;
  readonly zeroCandidateSiteCount: number;
  readonly zeroCandidateRate: number;
  readonly missSiteCount: number;
  readonly zeroCandidateMissSiteCount: number;
  readonly candidateButMissSiteCount: number;
  readonly candidateWithoutOracleIdSiteCount: number;
  readonly unmappedCandidateCount: number;
  readonly ambiguousCandidateMappingCount: number;
  readonly candidateSetSizeP50: number;
  readonly candidateSetSizeP95: number;
  readonly candidateSetSizeMax: number;
  readonly families: readonly Phase2CandidateRecallGroupMetrics[];
  readonly callShapes: readonly Phase2CandidateRecallGroupMetrics[];
  readonly missingEvidenceReasons: Readonly<Record<string, number>>;
}

interface CandidateRecallBucket {
  eligibleSiteCount: number;
  candidateGoldTargetCount: number;
  coveredGoldTargetCount: number;
  zeroCandidateSiteCount: number;
  candidateWithoutOracleIdSiteCount: number;
}

export interface Phase2EvaluationLabel {
  readonly sampleId: string;
  readonly split: string;
  readonly duplicateGroup: string;
  readonly repoFamily: string;
  /** Available in pinned Phase 1 corpus labels; optional for pure evaluator fixtures. */
  readonly repoId?: string;
  readonly positiveTargetIds: readonly string[];
  readonly reviewStatus: string;
}

export interface CalibrationBuildOptions {
  readonly configurationHash: string;
  readonly calibrationInputFingerprint: string;
  readonly minimumIndependentGroups: number;
  readonly minimumConfidenceLowerBound: number;
  readonly targetFamilyMacroTop1: number;
}

const CALIBRATION_SOURCE_SIDECARS = [
  "callsites.jsonl",
  "declared-type-facts-pass-a.jsonl",
] as const;

export function calibrationSourceSidecarHashes(
  sidecarHashes: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    CALIBRATION_SOURCE_SIDECARS.map((name) => {
      const hash = sidecarHashes[name];
      if (!hash) throw new Error(`Missing calibration source sidecar ${name}.`);
      return [name, hash];
    }),
  );
}

export type CalibrationFailureReason =
  | "insufficient-independent-groups"
  | "confidence-bound-below-target"
  | "family-macro-below-target"
  | "no-ranked-candidate";

export interface CalibrationSignatureResult {
  readonly ruleSignature: string;
  readonly calibrationEligibleSiteCount: number;
  readonly independentGroupCount: number;
  readonly record: CallResolutionCalibrationRecord | null;
  readonly reason?: CalibrationFailureReason;
  readonly familyMacroTop1: number | null;
  readonly thresholdScore: number | null;
  readonly familyMetrics: readonly CallResolutionCalibrationFamilyMetric[];
  readonly acceptedSiteCount: number;
}

export interface CalibrationBuildResult {
  readonly records: readonly CallResolutionCalibrationRecord[];
  readonly signatures: readonly CalibrationSignatureResult[];
}

export interface Phase2FamilyMetrics {
  readonly family: string;
  readonly eligibleSiteCount: number;
  readonly candidateRecall: number | null;
  readonly rawRankCorrectCount: number;
  readonly rawRankTop1: number;
  readonly calibratedSelectedCount: number;
  readonly calibratedCorrectCount: number;
  readonly calibratedEndToEndTop1: number;
  readonly selectiveTop1: number | null;
}

export interface Phase2SplitMetrics {
  readonly split: string;
  readonly eligibleSiteCount: number;
  readonly candidateRecall: number | null;
  readonly candidateGoldTargetCount: number;
  readonly coveredGoldTargetCount: number;
  readonly rawRankCorrectCount: number;
  readonly rawRankTop1: number;
  readonly calibratedSelectedCount: number;
  readonly calibratedCoverage: number;
  readonly calibratedAbstention: number;
  readonly calibratedCorrectCount: number;
  readonly calibratedEndToEndTop1: number;
  readonly selectiveTop1: number | null;
  readonly ece: number | null;
  readonly brierScore: number | null;
  readonly familyMacroTop1: number | null;
  readonly worstFamilyTop1: number | null;
  readonly families: readonly Phase2FamilyMetrics[];
}

interface ScoredRow {
  readonly observation: Phase2EvaluationObservation;
  readonly label: Phase2EvaluationLabel;
}

interface ThresholdEvaluation {
  readonly thresholdScore: number;
  readonly selected: readonly ScoredRow[];
  readonly independentGroupCount: number;
  readonly correctGroupCount: number;
  readonly confidenceLowerBound: number;
  readonly familyMetrics: readonly CallResolutionCalibrationFamilyMetric[];
  readonly familyMacroTop1: number;
  readonly acceptedSiteCount: number;
}

interface InternalCalibrationSignatureResult extends CalibrationSignatureResult {
  readonly thresholdEvaluations: readonly ThresholdEvaluation[];
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function labelIndex(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  requiredSplit: string,
): Map<string, Phase2EvaluationLabel> {
  const bySample = new Map(labels.map((label) => [label.sampleId, label]));
  if (bySample.size !== labels.length)
    throw new Error("Evaluation labels contain duplicate sample IDs.");
  for (const label of labels) {
    if (label.split !== requiredSplit)
      throw new Error(
        `Evaluation labels must come from the ${requiredSplit} split.`,
      );
  }
  for (const observation of observations) {
    if (observation.split !== requiredSplit)
      throw new Error(
        `Evaluation observations must come from the ${requiredSplit} split.`,
      );
    const label = bySample.get(observation.sampleId);
    if (!label)
      throw new Error(`Evaluation label missing for ${observation.sampleId}.`);
    if (
      label.duplicateGroup !== observation.duplicateGroup ||
      label.repoFamily !== observation.repoFamily
    )
      throw new Error(
        `Evaluation grouping mismatch for ${observation.sampleId}.`,
      );
  }
  return bySample;
}

function eligibleRows(
  observations: readonly Phase2EvaluationObservation[],
  labelsBySample: ReadonlyMap<string, Phase2EvaluationLabel>,
): ScoredRow[] {
  return observations.flatMap((observation) => {
    const label = labelsBySample.get(observation.sampleId)!;
    return label.reviewStatus === "confirmed" &&
      label.positiveTargetIds.length > 0
      ? [{ observation, label }]
      : [];
  });
}

function isRankedCorrect(row: ScoredRow): boolean {
  const { observation, label } = row;
  return (
    !observation.tied &&
    observation.topTargetId !== null &&
    canonicalTargets(label.positiveTargetIds).includes(observation.topTargetId)
  );
}

function canonicalTargets(targets: readonly string[]): string[] {
  return targets.map((target) => target.replace(/@L\d+(?:#\d+)?$/, ""));
}

function candidateRecallBucket(): CandidateRecallBucket {
  return {
    eligibleSiteCount: 0,
    candidateGoldTargetCount: 0,
    coveredGoldTargetCount: 0,
    zeroCandidateSiteCount: 0,
    candidateWithoutOracleIdSiteCount: 0,
  };
}

function addCandidateRecallRow(
  bucket: CandidateRecallBucket,
  observation: Phase2EvaluationObservation,
  label: Phase2EvaluationLabel,
): void {
  bucket.eligibleSiteCount++;
  bucket.candidateGoldTargetCount += label.positiveTargetIds.length;
  bucket.coveredGoldTargetCount += canonicalTargets(
    label.positiveTargetIds,
  ).filter((targetId) =>
    observation.candidateTargetIds.includes(targetId),
  ).length;
  const generatedCandidateCount =
    observation.generatedCandidateCount ??
    observation.candidateTargetIds.length;
  if (generatedCandidateCount === 0) bucket.zeroCandidateSiteCount++;
  if (generatedCandidateCount > observation.candidateTargetIds.length)
    bucket.candidateWithoutOracleIdSiteCount++;
}

function summarizeCandidateRecallBucket(
  name: string,
  bucket: CandidateRecallBucket,
): Phase2CandidateRecallGroupMetrics {
  return {
    name,
    eligibleSiteCount: bucket.eligibleSiteCount,
    candidateGoldTargetCount: bucket.candidateGoldTargetCount,
    coveredGoldTargetCount: bucket.coveredGoldTargetCount,
    candidateRecall:
      bucket.candidateGoldTargetCount === 0
        ? 0
        : bucket.coveredGoldTargetCount / bucket.candidateGoldTargetCount,
    zeroCandidateSiteCount: bucket.zeroCandidateSiteCount,
    candidateWithoutOracleIdSiteCount: bucket.candidateWithoutOracleIdSiteCount,
  };
}

function candidateSetQuantile(
  candidateSetSizes: readonly number[],
  quantile: number,
): number {
  const sorted = [...candidateSetSizes].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? 0;
}

/** Candidate recall deliberately keeps incomplete and unsupported rows in the denominator. */
export function evaluateCandidateRecallSplit(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  split = observations[0]?.split ?? "unknown",
): Phase2CandidateRecallMetrics {
  const bySample = labelIndex(observations, labels, split);
  const rows = eligibleRows(observations, bySample);
  const overall = candidateRecallBucket();
  const families = new Map<string, CandidateRecallBucket>();
  const callShapes = new Map<string, CandidateRecallBucket>();
  const missingEvidenceReasons: Record<string, number> = {};
  const candidateSetSizes: number[] = [];
  let ambiguousCandidateMappingCount = 0;
  let missSiteCount = 0;
  let zeroCandidateMissSiteCount = 0;
  let candidateButMissSiteCount = 0;
  let candidateWithoutOracleIdSiteCount = 0;
  let unmappedCandidateCount = 0;

  for (const row of rows) {
    const { observation, label } = row;
    addCandidateRecallRow(overall, observation, label);
    const family = families.get(label.repoFamily) ?? candidateRecallBucket();
    addCandidateRecallRow(family, observation, label);
    families.set(label.repoFamily, family);

    const callShape = observation.calleeKind ?? "unknown";
    const shape = callShapes.get(callShape) ?? candidateRecallBucket();
    addCandidateRecallRow(shape, observation, label);
    callShapes.set(callShape, shape);

    const candidateTargets = new Set(observation.candidateTargetIds);
    const goldTargets = canonicalTargets(label.positiveTargetIds);
    const coveredGoldTargetCount = goldTargets.filter((targetId) =>
      candidateTargets.has(targetId),
    ).length;
    if (coveredGoldTargetCount < goldTargets.length) {
      missSiteCount++;
      const generatedCandidateCount =
        observation.generatedCandidateCount ??
        observation.candidateTargetIds.length;
      if (generatedCandidateCount === 0) zeroCandidateMissSiteCount++;
      else candidateButMissSiteCount++;
      const reason = observation.reason ?? "unspecified";
      missingEvidenceReasons[reason] =
        (missingEvidenceReasons[reason] ?? 0) + 1;
    }
    const generatedCandidateCount =
      observation.generatedCandidateCount ??
      observation.candidateTargetIds.length;
    candidateSetSizes.push(generatedCandidateCount);
    if (generatedCandidateCount > observation.candidateTargetIds.length)
      candidateWithoutOracleIdSiteCount++;
    unmappedCandidateCount += observation.unmappedGeneratedCandidateCount ?? 0;
    ambiguousCandidateMappingCount +=
      observation.ambiguousCandidateMappingCount ?? 0;
  }

  return {
    split,
    eligibleSiteCount: overall.eligibleSiteCount,
    candidateGoldTargetCount: overall.candidateGoldTargetCount,
    coveredGoldTargetCount: overall.coveredGoldTargetCount,
    candidateRecall:
      overall.candidateGoldTargetCount === 0
        ? 0
        : overall.coveredGoldTargetCount / overall.candidateGoldTargetCount,
    zeroCandidateSiteCount: overall.zeroCandidateSiteCount,
    zeroCandidateRate:
      overall.eligibleSiteCount === 0
        ? 0
        : overall.zeroCandidateSiteCount / overall.eligibleSiteCount,
    missSiteCount,
    zeroCandidateMissSiteCount,
    candidateButMissSiteCount,
    candidateWithoutOracleIdSiteCount,
    unmappedCandidateCount,
    ambiguousCandidateMappingCount,
    candidateSetSizeP50: candidateSetQuantile(candidateSetSizes, 0.5),
    candidateSetSizeP95: candidateSetQuantile(candidateSetSizes, 0.95),
    candidateSetSizeMax: Math.max(0, ...candidateSetSizes),
    families: [...families]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, bucket]) => summarizeCandidateRecallBucket(name, bucket)),
    callShapes: [...callShapes]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, bucket]) => summarizeCandidateRecallBucket(name, bucket)),
    missingEvidenceReasons: Object.fromEntries(
      Object.entries(missingEvidenceReasons).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

function isAccepted(row: ScoredRow, thresholdScore: number): boolean {
  const { observation } = row;
  return (
    observation.topTargetId !== null &&
    observation.topRankScore !== null &&
    observation.topRankScore >= thresholdScore &&
    !observation.tied &&
    observation.candidateSetComplete &&
    !observation.truncated &&
    !observation.unsupportedCallShape
  );
}

function familyMetricsAtThreshold(
  rows: readonly ScoredRow[],
  thresholdScore: number,
): CallResolutionCalibrationFamilyMetric[] {
  const perFamily = new Map<string, { total: number; correct: number }>();
  for (const row of rows) {
    const current = perFamily.get(row.label.repoFamily) ?? {
      total: 0,
      correct: 0,
    };
    current.total++;
    if (isAccepted(row, thresholdScore) && isRankedCorrect(row))
      current.correct++;
    perFamily.set(row.label.repoFamily, current);
  }
  return [...perFamily]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([family, value]) => ({
      family,
      eligibleSiteCount: value.total,
      top1Accuracy: value.correct / value.total,
    }));
}

function groupedTrialCounts(
  rows: readonly ScoredRow[],
  thresholdScore: number,
): { independentGroupCount: number; correctGroupCount: number } {
  const groups = new Map<string, ScoredRow[]>();
  for (const row of rows) {
    const group = groups.get(row.label.duplicateGroup) ?? [];
    group.push(row);
    groups.set(row.label.duplicateGroup, group);
  }
  let independentGroupCount = 0;
  let correctGroupCount = 0;
  for (const group of groups.values()) {
    const accepted = group.filter((row) => isAccepted(row, thresholdScore));
    if (accepted.length === 0) continue;
    independentGroupCount++;
    const positiveTargetSets = new Set(
      group.map(({ label }) =>
        canonicalTargets(label.positiveTargetIds).sort().join("\0"),
      ),
    );
    if (positiveTargetSets.size > 1) continue;
    if (accepted.every(isRankedCorrect)) correctGroupCount++;
  }
  return { independentGroupCount, correctGroupCount };
}

function evaluateThreshold(
  rows: readonly ScoredRow[],
  thresholdScore: number,
): ThresholdEvaluation {
  const { independentGroupCount, correctGroupCount } = groupedTrialCounts(
    rows,
    thresholdScore,
  );
  const familyMetrics = familyMetricsAtThreshold(rows, thresholdScore);
  const familyMacroTop1 =
    familyMetrics.reduce((sum, family) => sum + family.top1Accuracy, 0) /
    familyMetrics.length;
  return {
    thresholdScore,
    selected: rows.filter((row) => isAccepted(row, thresholdScore)),
    independentGroupCount,
    correctGroupCount,
    confidenceLowerBound:
      independentGroupCount === 0
        ? 0
        : clopperPearsonLowerBound(correctGroupCount, independentGroupCount),
    familyMetrics,
    familyMacroTop1,
    acceptedSiteCount: rows.filter((row) => isAccepted(row, thresholdScore))
      .length,
  };
}

function recordForThreshold(
  ruleSignature: string,
  rows: readonly ScoredRow[],
  threshold: ThresholdEvaluation,
  options: CalibrationBuildOptions,
): CallResolutionCalibrationRecord {
  const calibrationInputFingerprint = hash({
    frozenCalibrationInput: options.calibrationInputFingerprint,
    ruleSignature,
    observations: rows
      .map(({ observation, label }) => ({
        sampleId: observation.sampleId,
        duplicateGroup: label.duplicateGroup,
        repoFamily: label.repoFamily,
        candidateTargetIds: observation.candidateTargetIds,
        topTargetId: observation.topTargetId,
        topRankScore: observation.topRankScore,
        tied: observation.tied,
        candidateSetComplete: observation.candidateSetComplete,
        truncated: observation.truncated,
        unsupportedCallShape: observation.unsupportedCallShape,
        positiveTargetIds: label.positiveTargetIds,
      }))
      .sort((left, right) => left.sampleId.localeCompare(right.sampleId)),
  });
  const payload = {
    schemaVersion: 1 as const,
    split: "calibration" as const,
    ruleSignature,
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    configurationHash: options.configurationHash,
    calibrationInputFingerprint,
    thresholdScore: threshold.thresholdScore,
    independentGroupCount: threshold.independentGroupCount,
    correctGroupCount: threshold.correctGroupCount,
    confidenceLowerBound: threshold.confidenceLowerBound,
    minimumIndependentGroups: options.minimumIndependentGroups,
    minimumConfidenceLowerBound: options.minimumConfidenceLowerBound,
    targetFamilyMacroTop1: options.targetFamilyMacroTop1,
    familyMetrics: threshold.familyMetrics,
  };
  return { ...payload, calibrationRecordHash: hash(payload) };
}

function failureReason(
  thresholdEvaluations: readonly ThresholdEvaluation[],
  options: CalibrationBuildOptions,
): CalibrationFailureReason {
  if (thresholdEvaluations.length === 0) return "no-ranked-candidate";
  const enoughGroups = thresholdEvaluations.filter(
    (threshold) =>
      threshold.independentGroupCount >= options.minimumIndependentGroups,
  );
  if (enoughGroups.length === 0) return "insufficient-independent-groups";
  const confidencePassing = enoughGroups.filter(
    (threshold) =>
      threshold.confidenceLowerBound >= options.minimumConfidenceLowerBound,
  );
  if (confidencePassing.length === 0) return "confidence-bound-below-target";
  return "family-macro-below-target";
}

export function buildCalibrationRecords(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  options: CalibrationBuildOptions,
): CalibrationBuildResult {
  const bySample = labelIndex(observations, labels, "calibration");
  const rows = eligibleRows(observations, bySample);
  const bySignature = new Map<string, ScoredRow[]>();
  for (const row of rows) {
    const signature = row.observation.ruleSignature;
    if (!signature) continue;
    const signatureRows = bySignature.get(signature) ?? [];
    signatureRows.push(row);
    bySignature.set(signature, signatureRows);
  }

  const signatures: InternalCalibrationSignatureResult[] = [];
  const records: CallResolutionCalibrationRecord[] = [];
  for (const [ruleSignature, signatureRows] of [...bySignature].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const scores = [
      ...new Set(
        signatureRows.flatMap(({ observation }) =>
          observation.topRankScore === null ? [] : [observation.topRankScore],
        ),
      ),
    ].sort((left, right) => left - right);
    const thresholds = scores.map((score) =>
      evaluateThreshold(signatureRows, score),
    );
    const passing = thresholds
      .filter(
        (threshold) =>
          threshold.independentGroupCount >= options.minimumIndependentGroups &&
          threshold.confidenceLowerBound >=
            options.minimumConfidenceLowerBound &&
          threshold.familyMacroTop1 >= options.targetFamilyMacroTop1,
      )
      .sort(
        (left, right) =>
          right.acceptedSiteCount - left.acceptedSiteCount ||
          left.thresholdScore - right.thresholdScore,
      );
    const selected = passing[0];
    const record = selected
      ? recordForThreshold(ruleSignature, signatureRows, selected, options)
      : null;
    if (record) records.push(record);
    const fallback = selected ?? thresholds[0];
    signatures.push({
      ruleSignature,
      calibrationEligibleSiteCount: signatureRows.length,
      independentGroupCount: fallback?.independentGroupCount ?? 0,
      record,
      ...(record ? {} : { reason: failureReason(thresholds, options) }),
      familyMacroTop1: fallback?.familyMacroTop1 ?? null,
      thresholdScore: fallback?.thresholdScore ?? null,
      familyMetrics: fallback?.familyMetrics ?? [],
      acceptedSiteCount: fallback?.acceptedSiteCount ?? 0,
      thresholdEvaluations: thresholds,
    });
  }
  return {
    records,
    signatures: signatures.map(
      ({ thresholdEvaluations: _private, ...result }) => result,
    ),
  };
}

function calibrationConfidence(
  ruleSignature: string | null,
  score: number | null,
  tied: boolean,
  complete: boolean,
  truncated: boolean,
  unsupported: boolean,
  topTargetId: string | null,
  records: readonly CallResolutionCalibrationRecord[],
): number | null {
  if (
    !ruleSignature ||
    score === null ||
    topTargetId === null ||
    tied ||
    !complete ||
    truncated ||
    unsupported
  )
    return null;
  const record = records.find(
    (candidate) =>
      candidate.ruleSignature === ruleSignature &&
      score >= candidate.thresholdScore,
  );
  return record?.confidenceLowerBound ?? null;
}

function calibrationStats(
  selected: readonly { confidence: number; correct: boolean }[],
  binCount = 10,
): { ece: number | null; brierScore: number | null } {
  if (selected.length === 0) return { ece: null, brierScore: null };
  let ece = 0;
  let brierTotal = 0;
  for (let index = 0; index < binCount; index++) {
    const lower = index / binCount;
    const upper = (index + 1) / binCount;
    const bin = selected.filter(({ confidence }) =>
      index === binCount - 1
        ? confidence >= lower && confidence <= upper
        : confidence >= lower && confidence < upper,
    );
    if (bin.length === 0) continue;
    const meanConfidence =
      bin.reduce((sum, row) => sum + row.confidence, 0) / bin.length;
    const accuracy = bin.filter(({ correct }) => correct).length / bin.length;
    ece += (bin.length / selected.length) * Math.abs(meanConfidence - accuracy);
  }
  for (const row of selected)
    brierTotal += (row.confidence - Number(row.correct)) ** 2;
  return { ece, brierScore: brierTotal / selected.length };
}

export function evaluatePhase2Split(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  calibrationRecords: readonly CallResolutionCalibrationRecord[],
  split = observations[0]?.split ?? "unknown",
): Phase2SplitMetrics {
  const bySample = labelIndex(observations, labels, split);
  const rows = eligibleRows(observations, bySample);
  const candidateGoldTargetCount = rows.reduce(
    (count, row) => count + row.label.positiveTargetIds.length,
    0,
  );
  const coveredGoldTargetCount = rows.reduce(
    (count, row) =>
      count +
      canonicalTargets(row.label.positiveTargetIds).filter((targetId) =>
        row.observation.candidateTargetIds.includes(targetId),
      ).length,
    0,
  );
  const rawRankCorrectCount = rows.filter(isRankedCorrect).length;
  const scoredCalibrated = rows.map((row) => {
    const confidence = calibrationConfidence(
      row.observation.ruleSignature,
      row.observation.topRankScore,
      row.observation.tied,
      row.observation.candidateSetComplete,
      row.observation.truncated,
      row.observation.unsupportedCallShape,
      row.observation.topTargetId,
      calibrationRecords,
    );
    return {
      ...row,
      confidence,
      selected: confidence !== null,
      correct: isRankedCorrect(row),
    };
  });
  const calibratedSelectedCount = scoredCalibrated.filter(
    (row) => row.selected,
  ).length;
  const calibratedCorrectCount = scoredCalibrated.filter(
    (row) => row.selected && row.correct,
  ).length;
  const families = new Map<
    string,
    {
      eligible: number;
      candidateGold: number;
      coveredGold: number;
      rawCorrect: number;
      selected: number;
      calibratedCorrect: number;
    }
  >();
  for (const row of scoredCalibrated) {
    const current = families.get(row.label.repoFamily) ?? {
      eligible: 0,
      candidateGold: 0,
      coveredGold: 0,
      rawCorrect: 0,
      selected: 0,
      calibratedCorrect: 0,
    };
    current.eligible++;
    current.candidateGold += row.label.positiveTargetIds.length;
    current.coveredGold += canonicalTargets(row.label.positiveTargetIds).filter(
      (targetId) => row.observation.candidateTargetIds.includes(targetId),
    ).length;
    if (row.correct) current.rawCorrect++;
    if (row.selected) current.selected++;
    if (row.selected && row.correct) current.calibratedCorrect++;
    families.set(row.label.repoFamily, current);
  }
  const familyRows: Phase2FamilyMetrics[] = [...families]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([family, value]) => ({
      family,
      eligibleSiteCount: value.eligible,
      candidateRecall:
        value.candidateGold === 0
          ? null
          : value.coveredGold / value.candidateGold,
      rawRankCorrectCount: value.rawCorrect,
      rawRankTop1: value.rawCorrect / value.eligible,
      calibratedSelectedCount: value.selected,
      calibratedCorrectCount: value.calibratedCorrect,
      calibratedEndToEndTop1: value.calibratedCorrect / value.eligible,
      selectiveTop1:
        value.selected === 0 ? null : value.calibratedCorrect / value.selected,
    }));
  const familyMacroTop1 =
    familyRows.length === 0
      ? null
      : familyRows.reduce(
          (sum, family) => sum + family.calibratedEndToEndTop1,
          0,
        ) / familyRows.length;
  const eceAndBrier = calibrationStats(
    scoredCalibrated.flatMap((row) =>
      row.confidence === null
        ? []
        : [{ confidence: row.confidence, correct: row.correct }],
    ),
  );
  return {
    split,
    eligibleSiteCount: rows.length,
    candidateRecall:
      candidateGoldTargetCount === 0
        ? null
        : coveredGoldTargetCount / candidateGoldTargetCount,
    candidateGoldTargetCount,
    coveredGoldTargetCount,
    rawRankCorrectCount,
    rawRankTop1: rows.length === 0 ? 0 : rawRankCorrectCount / rows.length,
    calibratedSelectedCount,
    calibratedCoverage:
      rows.length === 0 ? 0 : calibratedSelectedCount / rows.length,
    calibratedAbstention:
      rows.length === 0 ? 0 : 1 - calibratedSelectedCount / rows.length,
    calibratedCorrectCount,
    calibratedEndToEndTop1:
      rows.length === 0 ? 0 : calibratedCorrectCount / rows.length,
    selectiveTop1:
      calibratedSelectedCount === 0
        ? null
        : calibratedCorrectCount / calibratedSelectedCount,
    ...eceAndBrier,
    familyMacroTop1,
    worstFamilyTop1:
      familyRows.length === 0
        ? null
        : Math.min(
            ...familyRows.map((family) => family.calibratedEndToEndTop1),
          ),
    families: familyRows,
  };
}
