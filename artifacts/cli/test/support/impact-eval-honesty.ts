/**
 * Issue #508 Phase 0: pure benchmark-honesty semantics.
 *
 * This module intentionally lives in test/support. It evaluates benchmark evidence only and must
 * never change production impact behavior. Existing #192 positive-set scoring remains in
 * impact-eval-scorer.ts; this versioned model adds the missing negative/candidate/epistemic slices.
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
  | "resolved"
  | "unknown"
  | "ambiguous"
  | "not-found"
  | "error";

export type ImpactHonestyExpectedStatus = Exclude<
  ImpactHonestyObservedStatus,
  "error"
>;

export type ImpactHonestyEvidenceChannel =
  | "static"
  | "lsp-fallback"
  | "dynamic-candidate";

export interface ImpactHonestyPrediction {
  readonly file: string;
  readonly channel: ImpactHonestyEvidenceChannel;
}

export interface ImpactHonestyCaseInput {
  readonly schemaVersion: typeof IMPACT_HONESTY_SCHEMA_VERSION;
  readonly scenario: string;
  readonly target: string;
  readonly intent: ImpactHonestyCaseIntent;
  readonly expectedStatus: ImpactHonestyExpectedStatus;
  readonly expectedConfirmedFiles: readonly string[];
  readonly expectedCandidateFiles: readonly string[];
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

export type ImpactHonestyNegativeClassification =
  | "true-negative"
  | "false-positive";

export interface ImpactHonestyEpistemicResult {
  readonly correctUnknown: boolean;
  readonly falseSafe: boolean;
  readonly wrongCertainty: boolean;
}

export interface ImpactHonestyCaseResult {
  readonly schemaVersion: typeof IMPACT_HONESTY_SCHEMA_VERSION;
  readonly scenario: string;
  readonly target: string;
  readonly intent: ImpactHonestyCaseIntent;
  readonly expectedStatus: ImpactHonestyExpectedStatus;
  readonly observedStatus: ImpactHonestyObservedStatus;
  readonly expectedConfirmedFiles: string[];
  readonly expectedCandidateFiles: string[];
  readonly confirmedPredictedFiles: string[];
  readonly candidatePredictedFiles: string[];
  readonly predictions: ImpactHonestyPrediction[];
  readonly statusCorrect: boolean;
  readonly positive: ImpactHonestyPositiveMetrics | null;
  readonly negativeClassification: ImpactHonestyNegativeClassification | null;
  readonly candidate: ImpactHonestyCandidateMetrics | null;
  readonly epistemic: ImpactHonestyEpistemicResult | null;
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
}

const CONFIRMED_CHANNELS = new Set<ImpactHonestyEvidenceChannel>([
  "static",
  "lsp-fallback",
]);

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalizedPredictions(
  predictions: readonly ImpactHonestyPrediction[],
): ImpactHonestyPrediction[] {
  const byKey = new Map<string, ImpactHonestyPrediction>();
  for (const prediction of predictions) {
    byKey.set(
      `${prediction.channel}\u0000${prediction.file}`,
      Object.freeze({ file: prediction.file, channel: prediction.channel }),
    );
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.channel.localeCompare(b.channel),
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

export function scoreImpactHonestyCase(
  input: ImpactHonestyCaseInput,
): ImpactHonestyCaseResult {
  if (input.schemaVersion !== IMPACT_HONESTY_SCHEMA_VERSION) {
    throw new Error(
      `unsupported impact honesty schema version: ${String(input.schemaVersion)}`,
    );
  }

  const predictions = normalizedPredictions(input.predictions);
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

  const resolved = input.observedStatus === "resolved";
  const positive =
    input.intent === "confirmed-positive" && resolved
      ? setMetrics(confirmedPredictedFiles, expectedConfirmedFiles)
      : null;

  const negativeClassification =
    input.intent === "negative" && resolved
      ? confirmedPredictedFiles.length === 0
        ? "true-negative"
        : "false-positive"
      : null;

  const candidate =
    input.intent === "candidate-boundary" && resolved
      ? candidateMetrics(candidatePredictedFiles, expectedCandidateFiles)
      : null;

  const epistemic =
    input.intent === "epistemic-unknown"
      ? {
          correctUnknown:
            input.observedStatus === "unknown" ||
            input.observedStatus === "ambiguous",
          falseSafe:
            resolved && confirmedPredictedFiles.length === 0,
          wrongCertainty:
            resolved && confirmedPredictedFiles.length > 0,
        }
      : null;

  return {
    schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
    scenario: input.scenario,
    target: input.target,
    intent: input.intent,
    expectedStatus: input.expectedStatus,
    observedStatus: input.observedStatus,
    expectedConfirmedFiles,
    expectedCandidateFiles,
    confirmedPredictedFiles,
    candidatePredictedFiles,
    predictions,
    statusCorrect: input.observedStatus === input.expectedStatus,
    positive,
    negativeClassification,
    candidate,
    epistemic,
  };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

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
    (result): result is ImpactHonestyCaseResult & {
      positive: ImpactHonestyPositiveMetrics;
    } => result.positive !== null,
  );

  const negativeCases = results.filter((result) => result.intent === "negative");
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
    (result): result is ImpactHonestyCaseResult & {
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
  };
}

function fmt(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

/**
 * Fixed-order Phase 0 summary. No blended "overall" score is emitted.
 */
export function buildImpactHonestyMarkdown(
  aggregate: ImpactHonestyAggregate,
): string {
  return [
    "## Impact benchmark honesty (schema v1)",
    "",
    "| slice | cases | metric | value |",
    "|---|---:|---|---:|",
    `| positive | ${aggregate.positive.cases} | mean precision | ${fmt(aggregate.positive.meanPrecision)} |`,
    `| positive | ${aggregate.positive.cases} | mean recall | ${fmt(aggregate.positive.meanRecall)} |`,
    `| positive | ${aggregate.positive.cases} | mean F1 | ${fmt(aggregate.positive.meanF1)} |`,
    `| negative | ${aggregate.negative.cases} | specificity | ${fmt(aggregate.negative.specificity)} |`,
    `| negative | ${aggregate.negative.cases} | false-positive rate | ${fmt(aggregate.negative.falsePositiveRate)} |`,
    `| candidate | ${aggregate.candidate.cases} | candidate coverage | ${fmt(aggregate.candidate.coverage)} |`,
    `| epistemic | ${aggregate.epistemic.cases} | correct-unknown rate | ${fmt(aggregate.epistemic.correctUnknownRate)} |`,
    `| epistemic | ${aggregate.epistemic.cases} | false-safe rate | ${fmt(aggregate.epistemic.falseSafeRate)} |`,
    `| not-found | ${aggregate.notFound.cases} | accuracy | ${fmt(aggregate.notFound.accuracy)} |`,
    "",
    `**Case accounting:** ${aggregate.totalCases} total · ${aggregate.errorCases} errored.`,
    "",
    "> No blended overall score is defined. Candidate evidence is not promoted to confirmed dependency evidence.",
    "",
  ].join("\n");
}
