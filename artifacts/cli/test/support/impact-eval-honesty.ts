/**
 * Issue #508 Phase 0 impact benchmark honesty scorer.
 *
 * This module is additive to the #192 positive-set scorer. It intentionally does not change the
 * legacy impact F1 semantics or production impact behavior. Its purpose is to preserve epistemic
 * states and give negative/candidate/unknown cases metrics that match their actual contract.
 *
 * TDD-SOURCE: issue #508
 * TDD-SOURCE: docs/gitbook/guidelines/impact-benchmark-honesty-contract.md
 */

export const IMPACT_HONESTY_REPORT_VERSION = "impact-honesty.v1" as const;

export type ImpactHonestyCaseIntent =
  | "confirmed-positive"
  | "negative"
  | "candidate-boundary"
  | "epistemic-unknown"
  | "not-found";

export type ImpactHonestyOutcome =
  | "confirmed-positive"
  | "verified-negative"
  | "candidate"
  | "unknown"
  | "not-found"
  | "error";

export type ImpactHonestyProvenance =
  | "static"
  | "lsp-fallback"
  | "dynamic-candidate"
  | "unresolved"
  | "none";

export interface ImpactHonestyCase {
  scenario: string;
  target: string;
  intent: ImpactHonestyCaseIntent;
  outcome: ImpactHonestyOutcome;
  confirmedFiles: string[];
  expectedConfirmedFiles: string[];
  candidateFiles: string[];
  expectedCandidateFiles: string[];
  provenance: ImpactHonestyProvenance;
  expectedProvenance?: ImpactHonestyProvenance;
}

export interface ImpactHonestyPositiveMetrics {
  cases: number;
  meanPrecision: number | null;
  meanRecall: number | null;
  meanF1: number | null;
}

export interface ImpactHonestyNegativeMetrics {
  cases: number;
  trueNegativeCases: number;
  falsePositiveCases: number;
  abstainedCases: number;
  specificity: number | null;
  falsePositiveRate: number | null;
  verifiedNegativeRate: number | null;
}

export interface ImpactHonestyCandidateMetrics {
  cases: number;
  meanCandidateRecall: number | null;
  meanCandidateSetSize: number | null;
  confirmedLeakageFiles: number;
}

export interface ImpactHonestyEpistemicMetrics {
  cases: number;
  correctUnknownCases: number;
  falseSafeCases: number;
  otherOutcomeCases: number;
  correctUnknownRate: number | null;
  falseSafeRate: number | null;
}

export interface ImpactHonestyTargetResolutionMetrics {
  cases: number;
  correctNotFoundCases: number;
  correctNotFoundRate: number | null;
}

export interface ImpactHonestyProvenanceMetrics {
  cases: number;
  matchCases: number;
  mismatchCases: number;
  accuracy: number | null;
}

export interface ImpactHonestyReport {
  version: typeof IMPACT_HONESTY_REPORT_VERSION;
  accounting: {
    totalCases: number;
    erroredCases: number;
  };
  metrics: {
    positive: ImpactHonestyPositiveMetrics;
    negative: ImpactHonestyNegativeMetrics;
    candidate: ImpactHonestyCandidateMetrics;
    epistemic: ImpactHonestyEpistemicMetrics;
    targetResolution: ImpactHonestyTargetResolutionMetrics;
    provenance: ImpactHonestyProvenanceMetrics;
  };
  cases: ImpactHonestyCase[];
}

interface SetScore {
  precision: number;
  recall: number;
  f1: number;
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files)].sort();
}

function normalizeCase(input: ImpactHonestyCase): ImpactHonestyCase {
  return {
    ...input,
    confirmedFiles: normalizeFiles(input.confirmedFiles),
    expectedConfirmedFiles: normalizeFiles(input.expectedConfirmedFiles),
    candidateFiles: normalizeFiles(input.candidateFiles),
    expectedCandidateFiles: normalizeFiles(input.expectedCandidateFiles),
  };
}

function compareCase(
  left: ImpactHonestyCase,
  right: ImpactHonestyCase,
): number {
  const byScenario = left.scenario.localeCompare(right.scenario);
  return byScenario !== 0 ? byScenario : left.target.localeCompare(right.target);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function scoreConfirmedFiles(
  predictedFiles: string[],
  expectedFiles: string[],
): SetScore {
  const predicted = new Set(predictedFiles);
  const expected = new Set(expectedFiles);
  let tp = 0;

  for (const file of predicted) {
    if (expected.has(file)) tp += 1;
  }

  const precision = predicted.size === 0 ? 0 : tp / predicted.size;
  const recall = expected.size === 0 ? 0 : tp / expected.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1 };
}

function scoreCandidateRecall(
  candidateFiles: string[],
  expectedCandidateFiles: string[],
): number {
  const candidates = new Set(candidateFiles);
  const expected = new Set(expectedCandidateFiles);

  if (expected.size === 0) {
    return candidates.size === 0 ? 1 : 0;
  }

  let hits = 0;
  for (const file of expected) {
    if (candidates.has(file)) hits += 1;
  }
  return hits / expected.size;
}

function buildPositiveMetrics(
  cases: ImpactHonestyCase[],
): ImpactHonestyPositiveMetrics {
  const applicable = cases.filter(
    (item) => item.intent === "confirmed-positive",
  );
  const scores = applicable.map((item) =>
    item.outcome === "error"
      ? { precision: 0, recall: 0, f1: 0 }
      : scoreConfirmedFiles(item.confirmedFiles, item.expectedConfirmedFiles),
  );

  return {
    cases: applicable.length,
    meanPrecision: mean(scores.map((item) => item.precision)),
    meanRecall: mean(scores.map((item) => item.recall)),
    meanF1: mean(scores.map((item) => item.f1)),
  };
}

function buildNegativeMetrics(
  cases: ImpactHonestyCase[],
): ImpactHonestyNegativeMetrics {
  const applicable = cases.filter((item) => item.intent === "negative");

  let trueNegativeCases = 0;
  let falsePositiveCases = 0;

  for (const item of applicable) {
    const isFalsePositive =
      item.confirmedFiles.length > 0 || item.outcome === "confirmed-positive";
    const isTrueNegative =
      !isFalsePositive &&
      item.outcome === "verified-negative" &&
      item.confirmedFiles.length === 0;

    if (isFalsePositive) falsePositiveCases += 1;
    else if (isTrueNegative) trueNegativeCases += 1;
  }

  const decidedCases = trueNegativeCases + falsePositiveCases;
  const abstainedCases =
    applicable.length - trueNegativeCases - falsePositiveCases;

  return {
    cases: applicable.length,
    trueNegativeCases,
    falsePositiveCases,
    abstainedCases,
    specificity: ratio(trueNegativeCases, decidedCases),
    falsePositiveRate: ratio(falsePositiveCases, decidedCases),
    verifiedNegativeRate: ratio(trueNegativeCases, applicable.length),
  };
}

function buildCandidateMetrics(
  cases: ImpactHonestyCase[],
): ImpactHonestyCandidateMetrics {
  const applicable = cases.filter(
    (item) => item.intent === "candidate-boundary",
  );

  const recalls = applicable.map((item) =>
    item.outcome === "error"
      ? 0
      : scoreCandidateRecall(
          item.candidateFiles,
          item.expectedCandidateFiles,
        ),
  );

  return {
    cases: applicable.length,
    meanCandidateRecall: mean(recalls),
    meanCandidateSetSize: mean(
      applicable.map((item) => item.candidateFiles.length),
    ),
    confirmedLeakageFiles: applicable.reduce(
      (sum, item) => sum + item.confirmedFiles.length,
      0,
    ),
  };
}

function buildEpistemicMetrics(
  cases: ImpactHonestyCase[],
): ImpactHonestyEpistemicMetrics {
  const applicable = cases.filter(
    (item) => item.intent === "epistemic-unknown",
  );
  const correctUnknownCases = applicable.filter(
    (item) => item.outcome === "unknown",
  ).length;
  const falseSafeCases = applicable.filter(
    (item) => item.outcome === "verified-negative",
  ).length;
  const otherOutcomeCases =
    applicable.length - correctUnknownCases - falseSafeCases;

  return {
    cases: applicable.length,
    correctUnknownCases,
    falseSafeCases,
    otherOutcomeCases,
    correctUnknownRate: ratio(correctUnknownCases, applicable.length),
    falseSafeRate: ratio(falseSafeCases, applicable.length),
  };
}

function buildTargetResolutionMetrics(
  cases: ImpactHonestyCase[],
): ImpactHonestyTargetResolutionMetrics {
  const applicable = cases.filter((item) => item.intent === "not-found");
  const correctNotFoundCases = applicable.filter(
    (item) => item.outcome === "not-found",
  ).length;

  return {
    cases: applicable.length,
    correctNotFoundCases,
    correctNotFoundRate: ratio(correctNotFoundCases, applicable.length),
  };
}

function buildProvenanceMetrics(
  cases: ImpactHonestyCase[],
): ImpactHonestyProvenanceMetrics {
  const applicable = cases.filter(
    (item) => item.expectedProvenance !== undefined,
  );
  const matchCases = applicable.filter(
    (item) =>
      item.outcome !== "error" &&
      item.provenance === item.expectedProvenance,
  ).length;
  const mismatchCases = applicable.length - matchCases;

  return {
    cases: applicable.length,
    matchCases,
    mismatchCases,
    accuracy: ratio(matchCases, applicable.length),
  };
}

export function buildImpactHonestyReport(
  inputCases: ImpactHonestyCase[],
): ImpactHonestyReport {
  const cases = inputCases.map(normalizeCase).sort(compareCase);

  return {
    version: IMPACT_HONESTY_REPORT_VERSION,
    accounting: {
      totalCases: cases.length,
      erroredCases: cases.filter((item) => item.outcome === "error").length,
    },
    metrics: {
      positive: buildPositiveMetrics(cases),
      negative: buildNegativeMetrics(cases),
      candidate: buildCandidateMetrics(cases),
      epistemic: buildEpistemicMetrics(cases),
      targetResolution: buildTargetResolutionMetrics(cases),
      provenance: buildProvenanceMetrics(cases),
    },
    cases,
  };
}

/**
 * Stable machine-readable artifact for CI/report consumers.
 *
 * Object field insertion order is fixed by buildImpactHonestyReport(), cases are sorted, and all
 * file sets are normalized before serialization.
 */
export function serializeImpactHonestyReport(
  report: ImpactHonestyReport,
): string {
  return JSON.stringify(report, null, 2) + "\n";
}
