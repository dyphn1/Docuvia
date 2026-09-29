/**
 * Issue #508 Phase 4: deterministic machine-readable report model.
 *
 * This module is a presentation-side adapter over the existing Phase 0 scorer and the legacy
 * #192 scorer. It intentionally does not calculate new dependency semantics. Phase 1–3 corpus
 * runners provide their normalized records, observations, and already-owned gate failures.
 *
 * TDD-SOURCE: issue #508 Phase 4 honest CI report and hard regression gates
 * TDD-SOURCE: docs/ai_plans/acceptance_508-phase4-honest-ci-report.md
 * TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase4.md
 */

import {
  type ImpactEvalAggregate,
  type ImpactEvalCaseResult,
} from "./impact-eval-scorer.js";
import {
  IMPACT_HONESTY_SCHEMA_VERSION,
  aggregateImpactHonesty,
  type ImpactHonestyAggregate,
  type ImpactHonestyCaseResult,
} from "./impact-eval-honesty.js";

export const IMPACT_HONESTY_REPORT_SCHEMA_VERSION = 1 as const;

export const PHASE4_SLICE_IDS = {
  LEGACY: "legacy-positive-regression",
  PHASE1: "phase1-negative-ambiguity",
  PHASE2: "phase2-epistemic-candidate-boundary",
  PHASE3: "phase3-state-transition",
} as const;

export const PHASE4_CASE_FAMILIES = {
  LEGACY_POSITIVE: "legacy-positive",
  NEGATIVE_AMBIGUITY: "negative-and-ambiguity",
  EPISTEMIC_CANDIDATE: "epistemic-and-candidate-boundary",
  STATE_TRANSITION: "state-transition",
} as const;

export const PHASE4_METRIC_IDS = {
  LEGACY_PRECISION: "legacy precision",
  LEGACY_RECALL: "legacy recall",
  LEGACY_F1: "legacy F1",
  CONFIRMED_PRECISION: "confirmed dependency precision",
  CONFIRMED_RECALL: "confirmed dependency recall",
  CONFIRMED_F1: "confirmed dependency F1",
  NEGATIVE_SPECIFICITY: "negative specificity",
  NEGATIVE_FALSE_POSITIVE_RATE: "negative false-positive rate",
  WRONG_TARGET_RATE: "wrong-target rate",
  GOLD_IN_CANDIDATE_SET: "gold-in-candidate-set rate",
  CORRECT_UNKNOWN_RATE: "correct-unknown rate",
  FALSE_SAFE_RATE: "false-safe rate",
  PROVENANCE_MISMATCH_RATE: "provenance mismatch rate",
  MEDIAN_CANDIDATE_SET_SIZE: "median candidate set size",
  MAX_CANDIDATE_SET_SIZE: "maximum candidate set size",
} as const;

export type Phase4SliceId =
  (typeof PHASE4_SLICE_IDS)[keyof typeof PHASE4_SLICE_IDS];
export type Phase4CaseFamily =
  (typeof PHASE4_CASE_FAMILIES)[keyof typeof PHASE4_CASE_FAMILIES];

export interface Phase4Exclusion {
  readonly caseId: string;
  readonly reason: string;
}

export interface Phase4UpstreamGateFailure {
  readonly gateId: string;
  readonly sliceId: Phase4SliceId;
  readonly caseIds: readonly string[];
  readonly detail: string;
}

export interface Phase4CandidateObservation {
  readonly caseId: string;
  readonly candidateSetSize: number | null;
  readonly goldInCandidateSet?: boolean | null;
  readonly overflow: boolean;
  readonly unresolved: boolean;
}

export interface Phase4StateTransitionObservation {
  readonly kind: string;
  readonly passed: boolean;
  readonly caseIds: readonly string[];
  readonly staleEdgeViolations: number;
  readonly staleRecordViolations: number;
}

export interface Phase4KnownDefect {
  readonly defect: string;
  readonly checkpoint: string;
  readonly issue: number | null;
  readonly checkpointPassed: boolean;
}

export interface Phase4LegacyInput {
  readonly scope: string;
  readonly caseFamily: typeof PHASE4_CASE_FAMILIES.LEGACY_POSITIVE;
  readonly declaredCaseIds: readonly string[];
  readonly results: readonly ImpactEvalCaseResult[];
  readonly aggregate?: ImpactEvalAggregate;
  readonly missingCaseIds?: readonly string[];
  readonly regressedCaseIds?: readonly string[];
  readonly exclusions?: readonly Phase4Exclusion[];
}

export interface Phase4HonestySliceInput {
  readonly scope: string;
  readonly caseFamily: Exclude<
    Phase4CaseFamily,
    typeof PHASE4_CASE_FAMILIES.LEGACY_POSITIVE
  >;
  readonly declaredCaseIds: readonly string[];
  readonly records: readonly ImpactHonestyCaseResult[];
  readonly upstreamGateFailures: readonly Phase4UpstreamGateFailure[];
  readonly exclusions: readonly Phase4Exclusion[];
  readonly candidateObservations?: readonly Phase4CandidateObservation[];
  readonly stateTransitions?: readonly Phase4StateTransitionObservation[];
  readonly replayMismatches?: readonly string[];
}

export interface ImpactHonestyReportInput {
  readonly schemaVersion: number;
  readonly legacy: Phase4LegacyInput;
  readonly phase1: Phase4HonestySliceInput;
  readonly phase2: Phase4HonestySliceInput;
  readonly phase3: Phase4HonestySliceInput;
  readonly knownDefects: readonly Phase4KnownDefect[];
}

export interface Phase4Rate {
  readonly value: number | null;
  readonly numerator: number;
  readonly denominator: number;
}

export interface Phase4SliceReport {
  readonly id: Phase4SliceId;
  readonly scope: string;
  readonly caseFamily: Phase4CaseFamily;
  readonly sampleCount: number;
  readonly caseIds: string[];
  readonly observedCaseIds: string[];
  readonly missingCaseIds: string[];
  readonly unexpectedCaseIds: string[];
  readonly regressedCaseIds: string[];
  readonly errorCaseIds: string[];
  readonly exclusions: Phase4Exclusion[];
}

export interface Phase4MetricNote {
  readonly metric: string;
  readonly reason: string;
}

export interface Phase4StateKindReport {
  readonly kind: string;
  readonly passCount: number;
  readonly failCount: number;
  readonly staleEdgeViolations: number;
  readonly staleRecordViolations: number;
  readonly excludedCount: number;
  readonly knownDefectIds: string[];
  readonly caseIds: string[];
}

export interface Phase4ReportMetrics {
  readonly legacyPositiveRegression: {
    readonly cases: number;
    readonly scoredCases: number;
    readonly errors: number;
    readonly tp: number;
    readonly fp: number;
    readonly fn: number;
    readonly precision: Phase4Rate;
    readonly recall: Phase4Rate;
    readonly f1: number | null;
  };
  readonly confirmedDependencyAccuracy: {
    readonly cases: number;
    readonly scoredCases: number;
    readonly errors: number;
    readonly tp: number;
    readonly fp: number;
    readonly fn: number;
    readonly precision: Phase4Rate;
    readonly recall: Phase4Rate;
    readonly f1: number | null;
  };
  readonly negativeDiscrimination: {
    readonly cases: number;
    readonly resolvedCases: number;
    readonly trueNegativeCases: number;
    readonly falsePositiveCases: number;
    readonly specificity: Phase4Rate;
    readonly falsePositiveRate: Phase4Rate;
  };
  readonly targetIdentity: {
    readonly checkedCases: number;
    readonly correctCases: number;
    readonly wrongTargetCases: number;
    readonly wrongTargetRate: Phase4Rate;
  };
  readonly candidateBoundary: {
    readonly cases: number;
    readonly expectedCandidates: number;
    readonly coveredCandidates: number;
    readonly goldInCandidateSet: Phase4Rate;
    readonly medianCandidateSetSize: number | null;
    readonly maxCandidateSetSize: number | null;
    readonly overflowOrUnresolvedCases: number;
  };
  readonly epistemicHonesty: {
    readonly unknownRequiredCases: number;
    readonly correctUnknownCases: number;
    readonly correctUnknownRate: Phase4Rate;
    readonly falseSafeCases: number;
    readonly falseSafeRate: Phase4Rate;
    readonly wrongCertaintyCases: number;
    readonly provenanceChecked: number;
    readonly provenanceMismatches: number;
    readonly provenanceMismatchRate: Phase4Rate;
  };
  readonly stateRobustness: {
    readonly transitions: number;
    readonly passCount: number;
    readonly failCount: number;
    readonly staleEdgeViolations: number;
    readonly staleRecordViolations: number;
    readonly byKind: Phase4StateKindReport[];
    readonly replayMismatches: string[];
  };
}

export interface ImpactHonestyReport {
  readonly schemaVersion: typeof IMPACT_HONESTY_REPORT_SCHEMA_VERSION;
  readonly slices: Phase4SliceReport[];
  readonly metrics: Phase4ReportMetrics;
  readonly errors: string[];
  readonly naMetrics: Phase4MetricNote[];
  readonly exclusions: Phase4Exclusion[];
  readonly knownDefects: Phase4KnownDefect[];
  readonly upstreamGateFailures: Phase4UpstreamGateFailure[];
  readonly legacyCaseResults: ImpactEvalCaseResult[];
  readonly honestyCaseResults: ImpactHonestyCaseResult[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function sortedExclusions(
  values: readonly Phase4Exclusion[],
): Phase4Exclusion[] {
  return [...values]
    .map((value) => ({ caseId: value.caseId, reason: value.reason }))
    .sort(
      (a, b) =>
        compareText(a.caseId, b.caseId) || compareText(a.reason, b.reason),
    );
}

export function phase4RecordCaseId(scenario: string): string {
  const separator = scenario.indexOf("#");
  const withoutIntent = separator < 0 ? scenario : scenario.slice(0, separator);
  const transitionTarget = withoutIntent.indexOf(":");
  return transitionTarget < 0
    ? withoutIntent
    : withoutIntent.slice(0, transitionTarget);
}

function difference(
  values: readonly string[],
  other: readonly string[],
): string[] {
  const otherSet = new Set(other);
  return sortedUnique(values.filter((value) => !otherSet.has(value)));
}

function rate(numerator: number, denominator: number): Phase4Rate {
  return {
    value: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
  };
}

interface Phase4ConfusionCounts {
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
}

function addConfusionCounts(
  left: Phase4ConfusionCounts,
  right: Phase4ConfusionCounts,
): Phase4ConfusionCounts {
  return {
    tp: left.tp + right.tp,
    fp: left.fp + right.fp,
    fn: left.fn + right.fn,
  };
}

function f1FromConfusion({ tp, fp, fn }: Phase4ConfusionCounts): number | null {
  const denominator = 2 * tp + fp + fn;
  return denominator === 0 ? null : (2 * tp) / denominator;
}

function legacyConfusionCounts(
  results: readonly ImpactEvalCaseResult[],
): Phase4ConfusionCounts {
  return results
    .filter((result) => result.status === "ok")
    .reduce(
      (counts, result) =>
        addConfusionCounts(counts, {
          tp: result.tp,
          fp: result.fp,
          fn: result.fn,
        }),
      { tp: 0, fp: 0, fn: 0 },
    );
}

function honestyConfusionCounts(
  records: readonly ImpactHonestyCaseResult[],
): Phase4ConfusionCounts {
  return records
    .flatMap((record) => (record.positive === null ? [] : [record.positive]))
    .reduce((counts, positive) => addConfusionCounts(counts, positive), {
      tp: 0,
      fp: 0,
      fn: 0,
    });
}

function buildLegacySlice(input: Phase4LegacyInput): Phase4SliceReport {
  const observed = input.results.map((result) => result.scenario);
  const declared = sortedUnique(input.declaredCaseIds);
  return {
    id: PHASE4_SLICE_IDS.LEGACY,
    scope: input.scope,
    caseFamily: input.caseFamily,
    sampleCount: declared.length,
    caseIds: declared,
    observedCaseIds: sortedUnique(observed),
    missingCaseIds: sortedUnique([
      ...difference(declared, observed),
      ...(input.missingCaseIds ?? []),
    ]),
    unexpectedCaseIds: difference(observed, declared),
    regressedCaseIds: sortedUnique(input.regressedCaseIds ?? []),
    errorCaseIds: sortedUnique(
      input.results
        .filter((result) => result.status === "error")
        .map((result) => result.scenario),
    ),
    exclusions: sortedExclusions(input.exclusions ?? []),
  };
}

function buildHonestySlice(
  id: Exclude<Phase4SliceId, typeof PHASE4_SLICE_IDS.LEGACY>,
  input: Phase4HonestySliceInput,
): Phase4SliceReport {
  const observed = input.records.map((record) =>
    phase4RecordCaseId(record.scenario),
  );
  const declared = sortedUnique(input.declaredCaseIds);
  return {
    id,
    scope: input.scope,
    caseFamily: input.caseFamily,
    sampleCount: declared.length,
    caseIds: declared,
    observedCaseIds: sortedUnique(observed),
    missingCaseIds: difference(declared, observed),
    unexpectedCaseIds: difference(observed, declared),
    regressedCaseIds: [],
    errorCaseIds: sortedUnique(
      input.records
        .filter((record) => record.observedStatus === "error")
        .map((record) => record.scenario),
    ),
    exclusions: sortedExclusions(input.exclusions),
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positiveMetrics(
  aggregate: ImpactHonestyAggregate,
  records: readonly ImpactHonestyCaseResult[],
): Phase4ReportMetrics["confirmedDependencyAccuracy"] {
  const confusion = honestyConfusionCounts(records);
  return {
    cases: aggregate.positive.cases,
    scoredCases: aggregate.positive.scoredCases,
    errors: aggregate.positive.erroredCases,
    ...confusion,
    precision: rate(confusion.tp, confusion.tp + confusion.fp),
    recall: rate(confusion.tp, confusion.tp + confusion.fn),
    f1: f1FromConfusion(confusion),
  };
}

function emptyStateKindReport(kind: string): Phase4StateKindReport {
  return {
    kind,
    passCount: 0,
    failCount: 0,
    staleEdgeViolations: 0,
    staleRecordViolations: 0,
    excludedCount: 0,
    knownDefectIds: [],
    caseIds: [],
  };
}

function stateObservationDefects(
  observation: Phase4StateTransitionObservation,
  defectsByCheckpoint: ReadonlyMap<string, string>,
): string[] {
  return sortedUnique(
    observation.caseIds.flatMap((caseId) => {
      const defect = defectsByCheckpoint.get(caseId);
      return defect === undefined ? [] : [defect];
    }),
  );
}

function mergeStateObservation(
  current: Phase4StateKindReport,
  observation: Phase4StateTransitionObservation,
  observationDefects: readonly string[],
): Phase4StateKindReport {
  const excluded = observationDefects.length > 0;
  return {
    ...current,
    passCount: current.passCount + Number(!excluded && observation.passed),
    failCount: current.failCount + Number(!excluded && !observation.passed),
    staleEdgeViolations:
      current.staleEdgeViolations +
      Number(!excluded) * observation.staleEdgeViolations,
    staleRecordViolations:
      current.staleRecordViolations +
      Number(!excluded) * observation.staleRecordViolations,
    excludedCount: current.excludedCount + Number(excluded),
    knownDefectIds: sortedUnique([
      ...current.knownDefectIds,
      ...observationDefects,
    ]),
    caseIds: excluded
      ? current.caseIds
      : sortedUnique([...current.caseIds, ...observation.caseIds]),
  };
}

function buildStateMetrics(
  observations: readonly Phase4StateTransitionObservation[],
  replayMismatches: readonly string[],
  knownDefects: readonly Phase4KnownDefect[],
): Phase4ReportMetrics["stateRobustness"] {
  const defectsByCheckpoint = new Map(
    knownDefects.map((defect) => [defect.checkpoint, defect.defect]),
  );
  const byKind = new Map<string, Phase4StateKindReport>();
  for (const observation of observations) {
    const current =
      byKind.get(observation.kind) ?? emptyStateKindReport(observation.kind);
    byKind.set(
      observation.kind,
      mergeStateObservation(
        current,
        observation,
        stateObservationDefects(observation, defectsByCheckpoint),
      ),
    );
  }
  const reports = [...byKind.values()].sort((a, b) =>
    compareText(a.kind, b.kind),
  );
  return {
    transitions: reports.reduce(
      (sum, report) => sum + report.passCount + report.failCount,
      0,
    ),
    passCount: reports.reduce((sum, report) => sum + report.passCount, 0),
    failCount: reports.reduce((sum, report) => sum + report.failCount, 0),
    staleEdgeViolations: reports.reduce(
      (sum, report) => sum + report.staleEdgeViolations,
      0,
    ),
    staleRecordViolations: reports.reduce(
      (sum, report) => sum + report.staleRecordViolations,
      0,
    ),
    byKind: reports,
    replayMismatches: sortedUnique(
      replayMismatches.filter(
        (caseId) => !defectsByCheckpoint.has(phase4RecordCaseId(caseId)),
      ),
    ),
  };
}

function naMetric(metric: string, reason: string): Phase4MetricNote {
  return { metric, reason };
}

function whenNull(
  metric: string,
  value: number | null,
  reason: string,
): Phase4MetricNote[] {
  return value === null ? [naMetric(metric, reason)] : [];
}

function whenZero(
  value: number,
  notes: readonly Phase4MetricNote[],
): Phase4MetricNote[] {
  return value === 0 ? [...notes] : [];
}

function buildNaMetrics(
  legacy: Phase4ReportMetrics["legacyPositiveRegression"],
  honesty: Phase4ReportMetrics["confirmedDependencyAccuracy"],
  honestyAggregate: ImpactHonestyAggregate,
  candidateSizes: readonly number[],
  candidateGoldChecks: readonly unknown[],
): Phase4MetricNote[] {
  const notes = [
    ...whenNull(
      PHASE4_METRIC_IDS.LEGACY_PRECISION,
      legacy.precision.value,
      "no scored legacy cases",
    ),
    ...whenNull(
      PHASE4_METRIC_IDS.LEGACY_RECALL,
      legacy.recall.value,
      "no scored legacy cases",
    ),
    ...whenNull(
      PHASE4_METRIC_IDS.LEGACY_F1,
      legacy.f1,
      "no scored legacy cases",
    ),
    ...whenNull(
      PHASE4_METRIC_IDS.CONFIRMED_PRECISION,
      honesty.precision.value,
      "no resolved confirmed-positive cases",
    ),
    ...whenNull(
      PHASE4_METRIC_IDS.CONFIRMED_RECALL,
      honesty.recall.value,
      "no resolved confirmed-positive cases",
    ),
    ...whenNull(
      PHASE4_METRIC_IDS.CONFIRMED_F1,
      honesty.f1,
      "no resolved confirmed-positive cases",
    ),
    ...whenZero(honestyAggregate.negative.resolvedCases, [
      naMetric(
        PHASE4_METRIC_IDS.NEGATIVE_SPECIFICITY,
        "no resolved negative cases",
      ),
      naMetric(
        PHASE4_METRIC_IDS.NEGATIVE_FALSE_POSITIVE_RATE,
        "no resolved negative cases",
      ),
    ]),
    ...whenZero(honestyAggregate.targetResolution.resolvedCases, [
      naMetric(
        PHASE4_METRIC_IDS.WRONG_TARGET_RATE,
        "no resolved identity-checked cases",
      ),
    ]),
    ...whenZero(candidateGoldChecks.length, [
      naMetric(
        PHASE4_METRIC_IDS.GOLD_IN_CANDIDATE_SET,
        "no candidate observations",
      ),
    ]),
    ...whenZero(candidateSizes.length, [
      naMetric(
        PHASE4_METRIC_IDS.MEDIAN_CANDIDATE_SET_SIZE,
        "no bounded candidate sets",
      ),
      naMetric(
        PHASE4_METRIC_IDS.MAX_CANDIDATE_SET_SIZE,
        "no bounded candidate sets",
      ),
    ]),
    ...whenZero(honestyAggregate.epistemic.cases, [
      naMetric(
        PHASE4_METRIC_IDS.CORRECT_UNKNOWN_RATE,
        "no epistemic-unknown cases",
      ),
      naMetric(PHASE4_METRIC_IDS.FALSE_SAFE_RATE, "no epistemic-unknown cases"),
    ]),
    ...whenZero(honestyAggregate.provenance.checked, [
      naMetric(
        PHASE4_METRIC_IDS.PROVENANCE_MISMATCH_RATE,
        "no provenance-checked predictions",
      ),
    ]),
  ];
  return notes.sort((a, b) => compareText(a.metric, b.metric));
}

export function assertImpactHonestyReportSchemaVersion(version: number): void {
  if (version !== IMPACT_HONESTY_REPORT_SCHEMA_VERSION) {
    throw new Error(
      `unsupported impact honesty report schema version: ${String(version)}`,
    );
  }
}

export function buildImpactHonestyReport(
  input: ImpactHonestyReportInput,
): ImpactHonestyReport {
  assertImpactHonestyReportSchemaVersion(input.schemaVersion);

  const honestyInputs = [input.phase1, input.phase2, input.phase3];
  const knownDefectCheckpoints = new Set(
    input.knownDefects.map((defect) => defect.checkpoint),
  );
  const allHonestyRecords = honestyInputs.flatMap((slice) => slice.records);
  const honestyRecords = allHonestyRecords.filter(
    (record) =>
      !knownDefectCheckpoints.has(phase4RecordCaseId(record.scenario)),
  );
  const honestyAggregate = aggregateImpactHonesty(honestyRecords);
  const phase2And3Candidates = [
    ...(input.phase2.candidateObservations ?? []),
    ...(input.phase3.candidateObservations ?? []),
  ].filter((observation) => !knownDefectCheckpoints.has(observation.caseId));
  const candidateSizes = phase2And3Candidates.flatMap((observation) =>
    observation.candidateSetSize === null ? [] : [observation.candidateSetSize],
  );
  const candidateGoldChecks = phase2And3Candidates.filter(
    (observation) =>
      observation.goldInCandidateSet !== null &&
      observation.goldInCandidateSet !== undefined,
  );
  const candidateGoldHits = candidateGoldChecks.filter(
    (observation) => observation.goldInCandidateSet === true,
  ).length;
  const candidateMetrics = honestyAggregate.candidate;
  const targetMetrics = honestyAggregate.targetResolution;
  const upstreamGateFailures = honestyInputs
    .flatMap((slice) => slice.upstreamGateFailures)
    .map((failure) => ({
      ...failure,
      caseIds: sortedUnique(
        failure.caseIds.filter(
          (caseId) => !knownDefectCheckpoints.has(phase4RecordCaseId(caseId)),
        ),
      ),
    }))
    .filter((failure) => failure.caseIds.length > 0);
  const legacyConfusion = legacyConfusionCounts(input.legacy.results);
  const legacyMetrics: Phase4ReportMetrics["legacyPositiveRegression"] = {
    cases: input.legacy.declaredCaseIds.length,
    scoredCases: input.legacy.results.filter((result) => result.status === "ok")
      .length,
    errors: input.legacy.results.filter((result) => result.status === "error")
      .length,
    ...legacyConfusion,
    precision: rate(
      legacyConfusion.tp,
      legacyConfusion.tp + legacyConfusion.fp,
    ),
    recall: rate(legacyConfusion.tp, legacyConfusion.tp + legacyConfusion.fn),
    f1: f1FromConfusion(legacyConfusion),
  };
  const confirmedMetrics = positiveMetrics(honestyAggregate, honestyRecords);
  const exclusions = [
    ...(input.legacy.exclusions ?? []),
    ...honestyInputs.flatMap((slice) => slice.exclusions),
    ...input.knownDefects.map((defect) => ({
      caseId: defect.checkpoint,
      reason: `registered known product defect ${defect.defect} (#${String(defect.issue ?? "?")}) excluded from Phase 4 metric gates and headline metrics`,
    })),
  ];
  const stateMetrics = buildStateMetrics(
    input.phase3.stateTransitions ?? [],
    input.phase3.replayMismatches ?? [],
    input.knownDefects,
  );
  const slices = [
    buildLegacySlice(input.legacy),
    buildHonestySlice(PHASE4_SLICE_IDS.PHASE1, input.phase1),
    buildHonestySlice(PHASE4_SLICE_IDS.PHASE2, input.phase2),
    buildHonestySlice(PHASE4_SLICE_IDS.PHASE3, input.phase3),
  ];
  const allErrors = [
    ...slices.flatMap((slice) => slice.errorCaseIds),
    ...slices.flatMap((slice) => slice.missingCaseIds),
  ];
  const naMetrics = buildNaMetrics(
    legacyMetrics,
    confirmedMetrics,
    honestyAggregate,
    candidateSizes,
    candidateGoldChecks,
  );

  return {
    schemaVersion: IMPACT_HONESTY_REPORT_SCHEMA_VERSION,
    slices,
    metrics: {
      legacyPositiveRegression: legacyMetrics,
      confirmedDependencyAccuracy: confirmedMetrics,
      negativeDiscrimination: {
        cases: honestyAggregate.negative.cases,
        resolvedCases: honestyAggregate.negative.resolvedCases,
        trueNegativeCases: honestyAggregate.negative.trueNegativeCases,
        falsePositiveCases: honestyAggregate.negative.falsePositiveCases,
        specificity: rate(
          honestyAggregate.negative.trueNegativeCases,
          honestyAggregate.negative.resolvedCases,
        ),
        falsePositiveRate: rate(
          honestyAggregate.negative.falsePositiveCases,
          honestyAggregate.negative.resolvedCases,
        ),
      },
      targetIdentity: {
        checkedCases: targetMetrics.resolvedCases,
        correctCases: targetMetrics.correctCases,
        wrongTargetCases: targetMetrics.wrongTargetCases,
        wrongTargetRate: rate(
          targetMetrics.wrongTargetCases,
          targetMetrics.resolvedCases,
        ),
      },
      candidateBoundary: {
        cases: candidateMetrics.cases,
        expectedCandidates: candidateMetrics.expected,
        coveredCandidates: candidateMetrics.covered,
        goldInCandidateSet: rate(candidateGoldHits, candidateGoldChecks.length),
        medianCandidateSetSize: median(candidateSizes),
        maxCandidateSetSize:
          candidateSizes.length === 0 ? null : Math.max(...candidateSizes),
        overflowOrUnresolvedCases: phase2And3Candidates.filter(
          (observation) => observation.overflow || observation.unresolved,
        ).length,
      },
      epistemicHonesty: {
        unknownRequiredCases: honestyAggregate.epistemic.cases,
        correctUnknownCases: honestyAggregate.epistemic.correctUnknownCases,
        correctUnknownRate: rate(
          honestyAggregate.epistemic.correctUnknownCases,
          honestyAggregate.epistemic.cases,
        ),
        falseSafeCases: honestyAggregate.epistemic.falseSafeCases,
        falseSafeRate: rate(
          honestyAggregate.epistemic.falseSafeCases,
          honestyAggregate.epistemic.cases,
        ),
        wrongCertaintyCases: honestyAggregate.epistemic.wrongCertaintyCases,
        provenanceChecked: honestyAggregate.provenance.checked,
        provenanceMismatches: honestyAggregate.provenance.mismatches,
        provenanceMismatchRate: rate(
          honestyAggregate.provenance.mismatches,
          honestyAggregate.provenance.checked,
        ),
      },
      stateRobustness: stateMetrics,
    },
    errors: sortedUnique(allErrors),
    naMetrics,
    exclusions: sortedExclusions(exclusions),
    knownDefects: [...input.knownDefects].sort(
      (a, b) =>
        compareText(a.checkpoint, b.checkpoint) ||
        compareText(a.defect, b.defect),
    ),
    upstreamGateFailures: upstreamGateFailures
      .map((failure) => ({
        ...failure,
        caseIds: sortedUnique(failure.caseIds),
      }))
      .sort(
        (a, b) =>
          compareText(a.gateId, b.gateId) || compareText(a.sliceId, b.sliceId),
      ),
    legacyCaseResults: [...input.legacy.results],
    honestyCaseResults: [...honestyRecords].sort((a, b) =>
      compareText(a.scenario, b.scenario),
    ),
  };
}
