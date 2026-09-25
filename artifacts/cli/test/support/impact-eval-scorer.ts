/**
 * Issue #192's eval scorer plus issue #508's honesty-aware v2 contract.
 *
 * Legacy scoreCase()/aggregateCases() stay available for the original positive regression
 * report. The v2 contract keeps positive F1 as one slice while adding explicit negative,
 * epistemic and ambiguity semantics so those cases cannot be flattened into one headline score.
 *
 * TDD-SOURCE: issue #192 impact accuracy acceptance criteria
 * TDD-SOURCE: issue #508 phase 0 measurement contract
 * TDD-SOURCE: docs/gitbook/architecture/impact-evaluation-benchmark.md
 */

export const IMPACT_EVAL_MIN_MEAN_F1 = 0.75;
export const IMPACT_EVAL_REPORT_SCHEMA_VERSION = 2 as const;

export interface ImpactEvalCaseResult {
  scenario: string;
  target: string;
  status: "ok" | "error";
  /** Workspace-relative files the product predicted as dependents (empty on error). */
  predictedFiles: string[];
  /** Human-labeled ground truth files. */
  expectedFiles: string[];
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ImpactEvalAggregate {
  casesScored: number;
  casesErrored: number;
  meanPrecision: number | null;
  meanRecall: number | null;
  meanF1: number | null;
}

export type ImpactEvalMetricFamily =
  | "positive"
  | "negative"
  | "candidate"
  | "epistemic"
  | "ambiguity";

export type ImpactEvalDecision =
  | "confirmed-positive"
  | "verified-negative"
  | "unknown"
  | "ambiguous"
  | "stale"
  | "incomplete"
  | "error";

export interface ImpactEvalContractCase {
  scenario: string;
  target: string;
  family: ImpactEvalMetricFamily;
  expectedDecision: Exclude<ImpactEvalDecision, "error">;
  expectedFiles: string[];
  /**
   * Stable target identity used by ambiguity cases (for example file#symbol or a node id).
   * Omit when target identity is not part of this case's contract.
   */
  expectedTargetIdentity?: string;
}

export interface ImpactEvalObservation {
  decision: ImpactEvalDecision;
  predictedFiles: string[];
  /** Null means the evaluator explicitly abstained from binding a target. */
  resolvedTargetIdentity?: string | null;
}

export interface ImpactEvalContractResult {
  scenario: string;
  target: string;
  family: ImpactEvalMetricFamily;
  status: "ok" | "error";
  expectedDecision: Exclude<ImpactEvalDecision, "error">;
  observedDecision: ImpactEvalDecision;
  predictedFiles: string[];
  expectedFiles: string[];
  tp: number;
  fp: number;
  fn: number;
  /** Positive-family metrics only; null means not applicable to this family. */
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** Negative-family case-level result; null means not applicable. */
  negativeTrue: boolean | null;
  falsePositiveNegative: boolean | null;
  /** A verified-negative claim when the case did not expect verified-negative. */
  falseSafe: boolean;
  /** Exact uncertainty-state match for epistemic cases; null means not applicable. */
  correctAbstention: boolean | null;
  /** Ambiguity-family wrong binding; null means not applicable. */
  wrongTarget: boolean | null;
}

export interface ImpactEvalV2Aggregate {
  schemaVersion: typeof IMPACT_EVAL_REPORT_SCHEMA_VERSION;
  totalCases: number;
  casesErrored: number;
  errorRate: number | null;
  positive: {
    cases: number;
    meanPrecision: number | null;
    meanRecall: number | null;
    meanF1: number | null;
  };
  negative: {
    cases: number;
    trueNegativeCases: number;
    falsePositiveCases: number;
    /** Case-level specificity, not file-universe specificity. */
    specificity: number | null;
    /** Case-level false-positive rate, not file-universe FPR. */
    falsePositiveRate: number | null;
  };
  honesty: {
    /** Cases for which verified-negative would be an incorrect safety claim. */
    cases: number;
    falseSafeCases: number;
    falseSafeRate: number | null;
  };
  epistemic: {
    cases: number;
    correctAbstentionCases: number;
    correctAbstentionRate: number | null;
  };
  ambiguity: {
    cases: number;
    wrongTargetCases: number;
    wrongTargetRate: number | null;
  };
  candidate: {
    cases: number;
  };
}

interface FileSetMetrics {
  predictedFiles: string[];
  expectedFiles: string[];
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

function computeFileSetMetrics(
  predictedFiles: string[],
  expectedFiles: string[],
): FileSetMetrics {
  const predicted = new Set(predictedFiles);
  const actual = new Set(expectedFiles);
  let tp = 0;
  for (const file of predicted) {
    if (actual.has(file)) tp += 1;
  }
  const fp = predicted.size - tp;
  const fn = actual.size - tp;

  const precision = predicted.size === 0 ? 0 : tp / predicted.size;
  const recall = actual.size === 0 ? 0 : tp / actual.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return {
    predictedFiles: [...predicted].sort(),
    expectedFiles: [...actual].sort(),
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
  };
}

/** File-level positive-set scoring retained for the original #192 regression corpus. */
export function scoreCase(
  scenario: string,
  target: string,
  predictedFiles: string[],
  expectedFiles: string[],
): ImpactEvalCaseResult {
  return {
    scenario,
    target,
    status: "ok",
    ...computeFileSetMetrics(predictedFiles, expectedFiles),
  };
}

/** CRG-style legacy failure row: kept for forensics; the legacy aggregate excludes it. */
export function errorCase(
  scenario: string,
  target: string,
  expectedFiles: string[],
): ImpactEvalCaseResult {
  return {
    scenario,
    target,
    status: "error",
    predictedFiles: [],
    expectedFiles: [...new Set(expectedFiles)].sort(),
    tp: 0,
    fp: 0,
    fn: 0,
    precision: 0,
    recall: 0,
    f1: 0,
  };
}

/**
 * Legacy #192 aggregate. Kept unchanged for backwards compatibility until CI switches to the
 * v2 honesty report in a later #508 phase.
 */
export function aggregateCases(
  results: ImpactEvalCaseResult[],
): ImpactEvalAggregate {
  const ok = results.filter((r) => r.status === "ok");
  const mean = (pick: (r: ImpactEvalCaseResult) => number): number | null =>
    ok.length === 0
      ? null
      : ok.reduce((sum, r) => sum + pick(r), 0) / ok.length;

  return {
    casesScored: ok.length,
    casesErrored: results.length - ok.length,
    meanPrecision: mean((r) => r.precision),
    meanRecall: mean((r) => r.recall),
    meanF1: mean((r) => r.f1),
  };
}

/**
 * Honesty-aware v2 scorer. Metric families are explicit: non-positive cases never receive a
 * fabricated positive F1, and epistemic/ambiguity decisions remain distinct.
 */
export function scoreContractCase(
  contract: ImpactEvalContractCase,
  observation: ImpactEvalObservation,
): ImpactEvalContractResult {
  const metrics = computeFileSetMetrics(
    observation.predictedFiles,
    contract.expectedFiles,
  );
  const status = observation.decision === "error" ? "error" : "ok";
  const isPositive = contract.family === "positive";
  const isNegative = contract.family === "negative";
  const isEpistemic = contract.family === "epistemic";
  const isAmbiguity = contract.family === "ambiguity";

  const negativeTrue = isNegative
    ? observation.decision === "verified-negative" &&
      metrics.predictedFiles.length === 0
    : null;
  const falsePositiveNegative = isNegative
    ? metrics.predictedFiles.length > 0
    : null;

  const expectedUncertainty =
    contract.expectedDecision === "unknown" ||
    contract.expectedDecision === "stale" ||
    contract.expectedDecision === "incomplete";
  const correctAbstention = isEpistemic
    ? expectedUncertainty &&
      observation.decision === contract.expectedDecision
    : null;

  let wrongTarget: boolean | null = null;
  if (isAmbiguity) {
    wrongTarget =
      contract.expectedTargetIdentity !== undefined &&
      observation.resolvedTargetIdentity !== undefined &&
      observation.resolvedTargetIdentity !== null
        ? observation.resolvedTargetIdentity !== contract.expectedTargetIdentity
        : false;
  }

  return {
    scenario: contract.scenario,
    target: contract.target,
    family: contract.family,
    status,
    expectedDecision: contract.expectedDecision,
    observedDecision: observation.decision,
    predictedFiles: metrics.predictedFiles,
    expectedFiles: metrics.expectedFiles,
    tp: metrics.tp,
    fp: metrics.fp,
    fn: metrics.fn,
    precision: isPositive ? (status === "error" ? 0 : metrics.precision) : null,
    recall: isPositive ? (status === "error" ? 0 : metrics.recall) : null,
    f1: isPositive ? (status === "error" ? 0 : metrics.f1) : null,
    negativeTrue,
    falsePositiveNegative,
    falseSafe:
      observation.decision === "verified-negative" &&
      contract.expectedDecision !== "verified-negative",
    correctAbstention,
    wrongTarget,
  };
}

function meanNullable(
  values: Array<number | null>,
  denominator: number,
): number | null {
  if (denominator === 0) return null;
  return values.reduce((sum, value) => sum + (value ?? 0), 0) / denominator;
}

/**
 * Version-2 aggregate. Unlike the legacy aggregate, errored positive rows remain in the positive
 * denominator with a zero contribution. Other errored rows remain in their family counts and the
 * hard error gate rejects them independently.
 */
export function aggregateContractCases(
  results: ImpactEvalContractResult[],
): ImpactEvalV2Aggregate {
  const totalCases = results.length;
  const casesErrored = results.filter((r) => r.status === "error").length;
  const positive = results.filter((r) => r.family === "positive");
  const negative = results.filter((r) => r.family === "negative");
  const epistemic = results.filter((r) => r.family === "epistemic");
  const ambiguity = results.filter((r) => r.family === "ambiguity");
  const candidate = results.filter((r) => r.family === "candidate");
  const honestyEligible = results.filter(
    (r) => r.expectedDecision !== "verified-negative",
  );

  const trueNegativeCases = negative.filter((r) => r.negativeTrue).length;
  const falsePositiveCases = negative.filter(
    (r) => r.falsePositiveNegative,
  ).length;
  const falseSafeCases = honestyEligible.filter((r) => r.falseSafe).length;
  const correctAbstentionCases = epistemic.filter(
    (r) => r.correctAbstention,
  ).length;
  const wrongTargetCases = ambiguity.filter((r) => r.wrongTarget).length;

  return {
    schemaVersion: IMPACT_EVAL_REPORT_SCHEMA_VERSION,
    totalCases,
    casesErrored,
    errorRate: totalCases === 0 ? null : casesErrored / totalCases,
    positive: {
      cases: positive.length,
      meanPrecision: meanNullable(
        positive.map((r) => r.precision),
        positive.length,
      ),
      meanRecall: meanNullable(
        positive.map((r) => r.recall),
        positive.length,
      ),
      meanF1: meanNullable(
        positive.map((r) => r.f1),
        positive.length,
      ),
    },
    negative: {
      cases: negative.length,
      trueNegativeCases,
      falsePositiveCases,
      specificity:
        negative.length === 0 ? null : trueNegativeCases / negative.length,
      falsePositiveRate:
        negative.length === 0 ? null : falsePositiveCases / negative.length,
    },
    honesty: {
      cases: honestyEligible.length,
      falseSafeCases,
      falseSafeRate:
        honestyEligible.length === 0
          ? null
          : falseSafeCases / honestyEligible.length,
    },
    epistemic: {
      cases: epistemic.length,
      correctAbstentionCases,
      correctAbstentionRate:
        epistemic.length === 0
          ? null
          : correctAbstentionCases / epistemic.length,
    },
    ambiguity: {
      cases: ambiguity.length,
      wrongTargetCases,
      wrongTargetRate:
        ambiguity.length === 0 ? null : wrongTargetCases / ambiguity.length,
    },
    candidate: {
      cases: candidate.length,
    },
  };
}

/**
 * Deterministic synthetic honesty gate. Positive-F1 regression remains owned by
 * assertImpactEvalRegressionFloor(); this gate prevents dangerous failures in the new slices.
 */
export function assertImpactEvalHonestyGates(
  aggregate: ImpactEvalV2Aggregate,
): void {
  if (aggregate.casesErrored > 0) {
    throw new Error(
      `impact honesty gate: ${aggregate.casesErrored} case(s) errored`,
    );
  }
  if (
    aggregate.negative.specificity !== null &&
    aggregate.negative.specificity < 1
  ) {
    throw new Error(
      `impact honesty gate: negative specificity ${aggregate.negative.specificity.toFixed(3)} is below 1.000`,
    );
  }
  if (
    aggregate.honesty.falseSafeRate !== null &&
    aggregate.honesty.falseSafeRate > 0
  ) {
    throw new Error(
      `impact honesty gate: false-safe rate ${aggregate.honesty.falseSafeRate.toFixed(3)} must be 0.000`,
    );
  }
  if (
    aggregate.epistemic.correctAbstentionRate !== null &&
    aggregate.epistemic.correctAbstentionRate < 1
  ) {
    throw new Error(
      `impact honesty gate: correct-abstention rate ${aggregate.epistemic.correctAbstentionRate.toFixed(3)} is below 1.000`,
    );
  }
  if (
    aggregate.ambiguity.wrongTargetRate !== null &&
    aggregate.ambiguity.wrongTargetRate > 0
  ) {
    throw new Error(
      `impact honesty gate: wrong-target rate ${aggregate.ambiguity.wrongTargetRate.toFixed(3)} must be 0.000`,
    );
  }
}

/**
 * Phase 6 legacy positive-set regression gate. Error rows fail independently of F1.
 */
export function assertImpactEvalRegressionFloor(
  aggregate: ImpactEvalAggregate,
  minimumMeanF1 = IMPACT_EVAL_MIN_MEAN_F1,
): void {
  if (aggregate.casesErrored > 0) {
    throw new Error(
      `impact accuracy regression gate: ${aggregate.casesErrored} case(s) errored`,
    );
  }
  if (aggregate.meanF1 === null || aggregate.meanF1 < minimumMeanF1) {
    const actual =
      aggregate.meanF1 === null ? "n/a" : aggregate.meanF1.toFixed(3);
    throw new Error(
      `impact accuracy regression gate: mean F1 ${actual} is below ${minimumMeanF1.toFixed(3)}`,
    );
  }
}

const CSV_HEADER =
  "scenario,target,status,predicted_files,expected_files,tp,fp,fn,precision,recall,f1";

export function buildCsv(results: ImpactEvalCaseResult[]): string {
  const rows = results.map((r) =>
    [
      r.scenario,
      r.target,
      r.status,
      `"${r.predictedFiles.join(" ")}"`,
      `"${r.expectedFiles.join(" ")}"`,
      r.tp,
      r.fp,
      r.fn,
      r.precision.toFixed(3),
      r.recall.toFixed(3),
      r.f1.toFixed(3),
    ].join(","),
  );
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

/** Legacy #192 markdown summary retained until the CI-report migration phase. */
export function buildMarkdownSummary(
  results: ImpactEvalCaseResult[],
  aggregate: ImpactEvalAggregate,
): string {
  const fmt = (v: number | null) => (v === null ? "n/a" : v.toFixed(3));
  const table = results
    .map(
      (r) =>
        `| ${r.scenario} | \`${r.target}\` | ${r.status} | ${r.predictedFiles.join("<br>") || "—"} | ${r.precision.toFixed(3)} | ${r.recall.toFixed(3)} | ${r.f1.toFixed(3)} |`,
    )
    .join("\n");

  return [
    "## Impact accuracy eval (#192)",
    "",
    "| scenario | target | status | predicted | precision | recall | f1 |",
    "|---|---|---|---|---|---|---|",
    table,
    "",
    `**Aggregate (ok rows only):** precision ${fmt(aggregate.meanPrecision)} · recall ${fmt(aggregate.meanRecall)} · F1 ${fmt(aggregate.meanF1)} (${aggregate.casesScored} scored, ${aggregate.casesErrored} errored)`,
    "",
    `> Regression gate active: mean F1 must remain >= ${IMPACT_EVAL_MIN_MEAN_F1.toFixed(3)} and no case may error.`,
    "> Ground truth is human-labeled per case; see",
    "> `artifacts/cli/test/support/impact-corpus.ts`.",
    "",
  ].join("\n");
}

/** Versioned #508 summary. Rows are sorted so report bytes do not depend on execution order. */
export function buildContractMarkdownSummary(
  results: ImpactEvalContractResult[],
  aggregate: ImpactEvalV2Aggregate,
): string {
  const fmt = (value: number | null): string =>
    value === null ? "n/a" : value.toFixed(3);
  const sorted = [...results].sort(
    (a, b) =>
      a.scenario.localeCompare(b.scenario) || a.target.localeCompare(b.target),
  );
  const rows = sorted
    .map(
      (r) =>
        `| ${r.scenario} | ${r.family} | \`${r.target}\` | ${r.expectedDecision} | ${r.observedDecision} | ${r.status} |`,
    )
    .join("\n");

  return [
    `## Impact benchmark honesty eval (#508, schema v${aggregate.schemaVersion})`,
    "",
    "| scenario | family | target | expected decision | observed decision | status |",
    "|---|---|---|---|---|---|",
    rows,
    "",
    `- Positive F1: ${fmt(aggregate.positive.meanF1)} (n=${aggregate.positive.cases})`,
    `- Negative specificity: ${fmt(aggregate.negative.specificity)} (n=${aggregate.negative.cases})`,
    `- Negative false-positive rate: ${fmt(aggregate.negative.falsePositiveRate)}`,
    `- False-safe rate: ${fmt(aggregate.honesty.falseSafeRate)} (n=${aggregate.honesty.cases})`,
    `- Correct-abstention rate: ${fmt(aggregate.epistemic.correctAbstentionRate)} (n=${aggregate.epistemic.cases})`,
    `- Wrong-target rate: ${fmt(aggregate.ambiguity.wrongTargetRate)} (n=${aggregate.ambiguity.cases})`,
    `- Error rate: ${fmt(aggregate.errorRate)} (${aggregate.casesErrored}/${aggregate.totalCases})`,
    "",
    "> Metrics are separate slices. This report intentionally does not publish one blended overall score.",
    "",
  ].join("\n");
}
