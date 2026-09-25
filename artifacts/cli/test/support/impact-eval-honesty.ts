/**
 * Issue #508 Phase 0: pure benchmark-honesty semantics.
 *
 * This module intentionally lives in test/support. It evaluates benchmark
 * evidence only and must never change production impact behavior. Existing
 * #192 positive-set scoring remains in impact-eval-scorer.ts; this versioned
 * model adds the missing negative/candidate/epistemic slices.
 *
 * TDD-SOURCE: issue #508 Phase 0 benchmark honesty contract
 * TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
 */

export const IMPACT_HONESTY_SCHEMA_VERSION = 1 as const;

export type ImpactHonestyCaseIntent =
  | "confirmed-positive"
  | "negative"
  | "candidate-boundary"
  | "epistemic-unknown"
  | "not-found";

export type ImpactHonestyObservedStatus =
  "resolved" | "unknown" | "ambiguous" | "not-found" | "error";

export type ImpactHonestyExpectedStatus = Exclude<
  ImpactHonestyObservedStatus,
  "error"
>;

export type ImpactHonestyEvidenceChannel =
  "static" | "lsp-fallback" | "dynamic-candidate";

export interface ImpactHonestyPrediction {
  readonly file: string;
  readonly channel: ImpactHonestyEvidenceChannel;
}

export interface ImpactHonestyCaseInput {
  readonly schemaVersion: typeof IMPACT_HONESTY_SCHEMA_VERSION;
  readonly scenario: string;
  readonly target: string;
  /** Optional stable golden identity for duplicate/same-name target resolution checks. */
  readonly expectedTargetIdentity?: string;
  /** Optional stable identity of the target actually resolved by the analyzer. */
  readonly observedTargetIdentity?: string;
  readonly intent: ImpactHonestyCaseIntent;
  readonly expectedStatus: ImpactHonestyExpectedStatus;
  readonly expectedConfirmedFiles: readonly string[];
  readonly expectedCandidateFiles: readonly string[];
  readonly expectedPredictions?: readonly ImpactHonestyPrediction[];
  readonly observedStatus: ImpactHonestyObservedStatus;
  readonly predictions: readonly ImpactHonestyPrediction[];
}

export interface ImpactHonestyPositiveMetrics {
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface ImpactHonestyCandidateMetrics {
  readonly expected: number;
  readonly covered: number;
  readonly coverage: number | null;
  readonly predicted: number;
}

export interface ImpactHonestyProvenanceMetrics {
  readonly checked: number;
  readonly mismatches: number;
  readonly mismatchRate: number | null;
}

export type ImpactHonestyNegativeClassification =
  "true-negative" | "false-positive";

export interface ImpactHonestyEpistemicResult {
  readonly correctUnknown: boolean;
  readonly falseSafe: boolean;
  readonly wrongCertainty: boolean;
}

export interface ImpactHonestyTargetResolutionResult {
  readonly checked: boolean;
  readonly correct: boolean;
  readonly wrongTarget: boolean;
}

export interface ImpactHonestyCaseResult {
  readonly schemaVersion: typeof IMPACT_HONESTY_SCHEMA_VERSION;
  readonly scenario: string;
  readonly target: string;
  readonly expectedTargetIdentity?: string;
  readonly observedTargetIdentity?: string;
  readonly intent: ImpactHonestyCaseIntent;
  readonly expectedStatus: ImpactHonestyExpectedStatus;
  readonly observedStatus: ImpactHonestyObservedStatus;
  readonly expectedConfirmedFiles: string[];
  readonly expectedCandidateFiles: string[];
  readonly expectedPredictions: ImpactHonestyPrediction[];
  readonly confirmedPredictedFiles: string[];
  readonly candidatePredictedFiles: string[];
  readonly predictions: ImpactHonestyPrediction[];
  readonly statusCorrect: boolean;
  readonly positive: ImpactHonestyPositiveMetrics | null;
  readonly negativeClassification: ImpactHonestyNegativeClassification | null;
  readonly candidate: ImpactHonestyCandidateMetrics | null;
  readonly provenance: ImpactHonestyProvenanceMetrics;
  readonly epistemic: ImpactHonestyEpistemicResult | null;
  readonly targetResolution: ImpactHonestyTargetResolutionResult;
}

export interface ImpactHonestyAggregate {
  readonly schemaVersion: typeof IMPACT_HONESTY_SCHEMA_VERSION;
  readonly totalCases: number;
  readonly errorCases: number;
  readonly statusCounts: Record<ImpactHonestyObservedStatus, number>;
  readonly intentCounts: Record<ImpactHonestyCaseIntent, number>;
  readonly positive: {
    readonly cases: number;
    readonly scoredCases: number;
    readonly erroredCases: number;
    readonly meanPrecision: number | null;
    readonly meanRecall: number | null;
    readonly meanF1: number | null;
  };
  readonly negative: {
    readonly cases: number;
    readonly resolvedCases: number;
    readonly trueNegativeCases: number;
    readonly falsePositiveCases: number;
    readonly specificity: number | null;
    readonly falsePositiveRate: number | null;
  };
  readonly candidate: {
    readonly cases: number;
    readonly scoredCases: number;
    readonly expected: number;
    readonly covered: number;
    readonly predicted: number;
    readonly coverage: number | null;
  };
  readonly provenance: ImpactHonestyProvenanceMetrics;
  readonly epistemic: {
    readonly cases: number;
    readonly correctUnknownCases: number;
    readonly falseSafeCases: number;
    readonly wrongCertaintyCases: number;
    readonly correctUnknownRate: number | null;
    readonly falseSafeRate: number | null;
  };
  readonly notFound: {
    readonly cases: number;
    readonly correctCases: number;
    readonly accuracy: number | null;
  };
  readonly targetResolution: {
    readonly cases: number;
    readonly resolvedCases: number;
    readonly correctCases: number;
    readonly wrongTargetCases: number;
    readonly wrongTargetRate: number | null;
  };
}

const CONFIRMED_CHANNELS = new Set<ImpactHonestyEvidenceChannel>([
  "static",
  "lsp-fallback",
]);

const STATUS_ORDER: readonly ImpactHonestyObservedStatus[] = [
  "resolved",
  "unknown",
  "ambiguous",
  "not-found",
  "error",
];

const INTENT_ORDER: readonly ImpactHonestyCaseIntent[] = [
  "confirmed-positive",
  "negative",
  "candidate-boundary",
  "epistemic-unknown",
  "not-found",
];

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function normalizedPredictions(
  predictions: readonly ImpactHonestyPrediction[],
): ImpactHonestyPrediction[] {
  const byKey = new Map<string, ImpactHonestyPrediction>();
  for (const prediction of predictions) {
    byKey.set(`${prediction.file}\u0000${prediction.channel}`, {
      file: prediction.file,
      channel: prediction.channel,
    });
  }
  return [...byKey.values()].sort(
    (a, b) => compareText(a.file, b.file) || compareText(a.channel, b.channel),
  );
}

function setMetrics(
  predictedFiles: readonly string[],
  expectedFiles: readonly string[],
): ImpactHonestyPositiveMetrics {
  const predicted = new Set(predictedFiles);
  const expected = new Set(expectedFiles);
  let tp = 0;
  for (const file of predicted) {
    if (expected.has(file)) tp += 1;
  }

  const fp = predicted.size - tp;
  const fn = expected.size - tp;
  const precision = predicted.size === 0 ? 0 : tp / predicted.size;
  const recall = expected.size === 0 ? 0 : tp / expected.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return { tp, fp, fn, precision, recall, f1 };
}

function candidateMetrics(
  predictedFiles: readonly string[],
  expectedFiles: readonly string[],
): ImpactHonestyCandidateMetrics {
  const predicted = new Set(predictedFiles);
  const expected = new Set(expectedFiles);
  let covered = 0;
  for (const file of expected) {
    if (predicted.has(file)) covered += 1;
  }

  return {
    expected: expected.size,
    covered,
    coverage: expected.size === 0 ? null : covered / expected.size,
    predicted: predicted.size,
  };
}

function provenanceMetrics(
  expectedPredictions: readonly ImpactHonestyPrediction[],
  predictions: readonly ImpactHonestyPrediction[],
): ImpactHonestyProvenanceMetrics {
  const observedChannels = new Map<string, Set<ImpactHonestyEvidenceChannel>>();

  for (const prediction of predictions) {
    const channels = observedChannels.get(prediction.file) ?? new Set();
    channels.add(prediction.channel);
    observedChannels.set(prediction.file, channels);
  }

  let checked = 0;
  let mismatches = 0;
  for (const expected of expectedPredictions) {
    const channels = observedChannels.get(expected.file);
    if (!channels) continue;

    checked += 1;
    if (!channels.has(expected.channel)) mismatches += 1;
  }

  return {
    checked,
    mismatches,
    mismatchRate: checked === 0 ? null : mismatches / checked,
  };
}

function positiveMetricsForCase(
  intent: ImpactHonestyCaseIntent,
  observedStatus: ImpactHonestyObservedStatus,
  confirmedPredictedFiles: readonly string[],
  expectedConfirmedFiles: readonly string[],
): ImpactHonestyPositiveMetrics | null {
  if (intent !== "confirmed-positive" || observedStatus !== "resolved") {
    return null;
  }
  return setMetrics(confirmedPredictedFiles, expectedConfirmedFiles);
}

function negativeClassificationForCase(
  intent: ImpactHonestyCaseIntent,
  observedStatus: ImpactHonestyObservedStatus,
  confirmedPredictedFiles: readonly string[],
): ImpactHonestyNegativeClassification | null {
  if (intent !== "negative" || observedStatus !== "resolved") return null;
  return confirmedPredictedFiles.length === 0
    ? "true-negative"
    : "false-positive";
}

function candidateMetricsForCase(
  intent: ImpactHonestyCaseIntent,
  observedStatus: ImpactHonestyObservedStatus,
  candidatePredictedFiles: readonly string[],
  expectedCandidateFiles: readonly string[],
): ImpactHonestyCandidateMetrics | null {
  if (intent !== "candidate-boundary" || observedStatus !== "resolved") {
    return null;
  }
  return candidateMetrics(candidatePredictedFiles, expectedCandidateFiles);
}

function epistemicMetricsForCase(
  intent: ImpactHonestyCaseIntent,
  observedStatus: ImpactHonestyObservedStatus,
  confirmedPredictedFiles: readonly string[],
): ImpactHonestyEpistemicResult | null {
  if (intent !== "epistemic-unknown") return null;

  const resolved = observedStatus === "resolved";
  return {
    correctUnknown:
      observedStatus === "unknown" || observedStatus === "ambiguous",
    falseSafe: resolved && confirmedPredictedFiles.length === 0,
    wrongCertainty: resolved && confirmedPredictedFiles.length > 0,
  };
}

function targetResolutionForCase(
  expectedTargetIdentity: string | undefined,
  observedTargetIdentity: string | undefined,
  observedStatus: ImpactHonestyObservedStatus,
): ImpactHonestyTargetResolutionResult {
  if (expectedTargetIdentity === undefined || observedStatus !== "resolved") {
    return { checked: false, correct: false, wrongTarget: false };
  }

  const correct = observedTargetIdentity === expectedTargetIdentity;
  return {
    checked: true,
    correct,
    wrongTarget: !correct,
  };
}

export function scoreImpactHonestyCase(
  input: ImpactHonestyCaseInput,
): ImpactHonestyCaseResult {
  if (input.schemaVersion !== IMPACT_HONESTY_SCHEMA_VERSION) {
    throw new Error(
      `unsupported impact honesty schema version: ${String(input.schemaVersion)}`,
    );
  }

  const predictions = normalizedPredictions(input.predictions);
  const expectedPredictions = normalizedPredictions(
    input.expectedPredictions ?? [],
  );
  const expectedConfirmedFiles = uniqueSorted(input.expectedConfirmedFiles);
  const expectedCandidateFiles = uniqueSorted(input.expectedCandidateFiles);

  const confirmedPredictedFiles = uniqueSorted(
    predictions
      .filter((prediction) => CONFIRMED_CHANNELS.has(prediction.channel))
      .map((prediction) => prediction.file),
  );
  const candidatePredictedFiles = uniqueSorted(
    predictions
      .filter((prediction) => prediction.channel === "dynamic-candidate")
      .map((prediction) => prediction.file),
  );

  return {
    schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
    scenario: input.scenario,
    target: input.target,
    expectedTargetIdentity: input.expectedTargetIdentity,
    observedTargetIdentity: input.observedTargetIdentity,
    intent: input.intent,
    expectedStatus: input.expectedStatus,
    observedStatus: input.observedStatus,
    expectedConfirmedFiles,
    expectedCandidateFiles,
    expectedPredictions,
    confirmedPredictedFiles,
    candidatePredictedFiles,
    predictions,
    statusCorrect: input.observedStatus === input.expectedStatus,
    positive: positiveMetricsForCase(
      input.intent,
      input.observedStatus,
      confirmedPredictedFiles,
      expectedConfirmedFiles,
    ),
    negativeClassification: negativeClassificationForCase(
      input.intent,
      input.observedStatus,
      confirmedPredictedFiles,
    ),
    candidate: candidateMetricsForCase(
      input.intent,
      input.observedStatus,
      candidatePredictedFiles,
      expectedCandidateFiles,
    ),
    provenance: provenanceMetrics(expectedPredictions, predictions),
    epistemic: epistemicMetricsForCase(
      input.intent,
      input.observedStatus,
      confirmedPredictedFiles,
    ),
    targetResolution: targetResolutionForCase(
      input.expectedTargetIdentity,
      input.observedTargetIdentity,
      input.observedStatus,
    ),
  };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregateImpactHonesty(
  results: readonly ImpactHonestyCaseResult[],
): ImpactHonestyAggregate {
  const statusCounts = Object.fromEntries(
    STATUS_ORDER.map((status) => [
      status,
      results.filter((result) => result.observedStatus === status).length,
    ]),
  ) as Record<ImpactHonestyObservedStatus, number>;

  const intentCounts = Object.fromEntries(
    INTENT_ORDER.map((intent) => [
      intent,
      results.filter((result) => result.intent === intent).length,
    ]),
  ) as Record<ImpactHonestyCaseIntent, number>;

  const positiveCases = results.filter(
    (result) => result.intent === "confirmed-positive",
  );
  const positiveScored = positiveCases.filter(
    (
      result,
    ): result is ImpactHonestyCaseResult & {
      positive: ImpactHonestyPositiveMetrics;
    } => result.positive !== null,
  );

  const negativeCases = results.filter(
    (result) => result.intent === "negative",
  );
  const negativeResolved = negativeCases.filter(
    (result) => result.negativeClassification !== null,
  );
  const trueNegativeCases = negativeResolved.filter(
    (result) => result.negativeClassification === "true-negative",
  ).length;
  const falsePositiveCases = negativeResolved.filter(
    (result) => result.negativeClassification === "false-positive",
  ).length;

  const candidateCases = results.filter(
    (result) => result.intent === "candidate-boundary",
  );
  const candidateScored = candidateCases.filter(
    (
      result,
    ): result is ImpactHonestyCaseResult & {
      candidate: ImpactHonestyCandidateMetrics;
    } => result.candidate !== null,
  );
  const candidateExpected = candidateScored.reduce(
    (sum, result) => sum + result.candidate.expected,
    0,
  );
  const candidateCovered = candidateScored.reduce(
    (sum, result) => sum + result.candidate.covered,
    0,
  );
  const candidatePredicted = candidateScored.reduce(
    (sum, result) => sum + result.candidate.predicted,
    0,
  );

  const provenanceChecked = results.reduce(
    (sum, result) => sum + result.provenance.checked,
    0,
  );
  const provenanceMismatches = results.reduce(
    (sum, result) => sum + result.provenance.mismatches,
    0,
  );

  const epistemicCases = results.filter(
    (result) => result.intent === "epistemic-unknown",
  );
  const correctUnknownCases = epistemicCases.filter(
    (result) => result.epistemic?.correctUnknown === true,
  ).length;
  const falseSafeCases = epistemicCases.filter(
    (result) => result.epistemic?.falseSafe === true,
  ).length;
  const wrongCertaintyCases = epistemicCases.filter(
    (result) => result.epistemic?.wrongCertainty === true,
  ).length;

  const notFoundCases = results.filter(
    (result) => result.intent === "not-found",
  );
  const correctNotFoundCases = notFoundCases.filter(
    (result) => result.observedStatus === "not-found",
  ).length;

  const targetResolutionCases = results.filter(
    (result) => result.expectedTargetIdentity !== undefined,
  );
  const targetResolutionResolved = targetResolutionCases.filter(
    (result) => result.targetResolution.checked,
  );
  const correctTargetCases = targetResolutionResolved.filter(
    (result) => result.targetResolution.correct,
  ).length;
  const wrongTargetCases = targetResolutionResolved.filter(
    (result) => result.targetResolution.wrongTarget,
  ).length;

  return {
    schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
    totalCases: results.length,
    errorCases: statusCounts.error,
    statusCounts,
    intentCounts,
    positive: {
      cases: positiveCases.length,
      scoredCases: positiveScored.length,
      erroredCases: positiveCases.filter(
        (result) => result.observedStatus === "error",
      ).length,
      meanPrecision: mean(
        positiveScored.map((result) => result.positive.precision),
      ),
      meanRecall: mean(positiveScored.map((result) => result.positive.recall)),
      meanF1: mean(positiveScored.map((result) => result.positive.f1)),
    },
    negative: {
      cases: negativeCases.length,
      resolvedCases: negativeResolved.length,
      trueNegativeCases,
      falsePositiveCases,
      specificity:
        negativeResolved.length === 0
          ? null
          : trueNegativeCases / negativeResolved.length,
      falsePositiveRate:
        negativeResolved.length === 0
          ? null
          : falsePositiveCases / negativeResolved.length,
    },
    candidate: {
      cases: candidateCases.length,
      scoredCases: candidateScored.length,
      expected: candidateExpected,
      covered: candidateCovered,
      predicted: candidatePredicted,
      coverage:
        candidateExpected === 0 ? null : candidateCovered / candidateExpected,
    },
    provenance: {
      checked: provenanceChecked,
      mismatches: provenanceMismatches,
      mismatchRate:
        provenanceChecked === 0
          ? null
          : provenanceMismatches / provenanceChecked,
    },
    epistemic: {
      cases: epistemicCases.length,
      correctUnknownCases,
      falseSafeCases,
      wrongCertaintyCases,
      correctUnknownRate:
        epistemicCases.length === 0
          ? null
          : correctUnknownCases / epistemicCases.length,
      falseSafeRate:
        epistemicCases.length === 0
          ? null
          : falseSafeCases / epistemicCases.length,
    },
    notFound: {
      cases: notFoundCases.length,
      correctCases: correctNotFoundCases,
      accuracy:
        notFoundCases.length === 0
          ? null
          : correctNotFoundCases / notFoundCases.length,
    },
    targetResolution: {
      cases: targetResolutionCases.length,
      resolvedCases: targetResolutionResolved.length,
      correctCases: correctTargetCases,
      wrongTargetCases,
      wrongTargetRate:
        targetResolutionResolved.length === 0
          ? null
          : wrongTargetCases / targetResolutionResolved.length,
    },
  };
}

function fmt(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

/** Fixed-order Phase 0 summary. No blended "overall" score is emitted. */
export function buildImpactHonestyMarkdown(
  aggregate: ImpactHonestyAggregate,
): string {
  return [
    "## Impact benchmark honesty (schema v1)",
    "",
    "| slice | cases | metric | value |",
    "|---|---:|---|---:|",
    `| positive | ${aggregate.positive.cases} | mean precision | ${fmt(
      aggregate.positive.meanPrecision,
    )} |`,
    `| positive | ${aggregate.positive.cases} | mean recall | ${fmt(
      aggregate.positive.meanRecall,
    )} |`,
    `| positive | ${aggregate.positive.cases} | mean F1 | ${fmt(
      aggregate.positive.meanF1,
    )} |`,
    `| negative | ${aggregate.negative.cases} | specificity | ${fmt(
      aggregate.negative.specificity,
    )} |`,
    `| negative | ${aggregate.negative.cases} | false-positive rate | ${fmt(
      aggregate.negative.falsePositiveRate,
    )} |`,
    `| candidate | ${aggregate.candidate.cases} | candidate coverage | ${fmt(
      aggregate.candidate.coverage,
    )} |`,
    `| provenance | ${aggregate.provenance.checked} | mismatch rate | ${fmt(
      aggregate.provenance.mismatchRate,
    )} |`,
    `| epistemic | ${aggregate.epistemic.cases} | correct-unknown rate | ${fmt(
      aggregate.epistemic.correctUnknownRate,
    )} |`,
    `| epistemic | ${aggregate.epistemic.cases} | false-safe rate | ${fmt(
      aggregate.epistemic.falseSafeRate,
    )} |`,
    `| not-found | ${aggregate.notFound.cases} | accuracy | ${fmt(
      aggregate.notFound.accuracy,
    )} |`,
    `| target resolution | ${aggregate.targetResolution.cases} | wrong-target rate | ${fmt(
      aggregate.targetResolution.wrongTargetRate,
    )} |`,
    "",
    `**Case accounting:** ${aggregate.totalCases} total · ${aggregate.errorCases} errored.`,
    "",
    "> No blended overall score is defined. Candidate evidence is not promoted",
    "> to confirmed dependency evidence.",
    "",
  ].join("\n");
}
