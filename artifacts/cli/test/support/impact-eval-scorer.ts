/**
 * Issue #192's eval scorer: pure precision/recall/F1 math and report rendering for the impact
 * accuracy benchmark, split from the integration test so the scoring semantics are unit-testable
 * without a CLI subprocess. Design decisions mirror CRG's `eval/benchmarks/impact_accuracy.py`:
 *
 * - Scoring is at FILE granularity (a flagged symbol in the right file is a hit).
 * - Failures are recorded as `status: "error"` rows that stay in the report but are EXCLUDED
 *   from every aggregate -- a crashed case must never masquerade as a score.
 * - Phase 6 locks the corrected product-path baseline behind a real regression gate.
 *
 * TDD-SOURCE: issue #192 impact accuracy acceptance criteria
 */

export const IMPACT_EVAL_MIN_MEAN_F1 = 0.5;

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

/** File-level set scoring: precision = tp/predicted, recall = tp/actual, F1 = harmonic mean.
 * Empty sets score 0 rather than NaN -- a zero-prediction case is a real recall failure,
 * never a division error. */
export function scoreCase(
  scenario: string,
  target: string,
  predictedFiles: string[],
  expectedFiles: string[],
): ImpactEvalCaseResult {
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
    scenario,
    target,
    status: "ok",
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

/** CRG-style failure row: kept for forensics, excluded from aggregates downstream. */
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
    expectedFiles: [...expectedFiles].sort(),
    tp: 0,
    fp: 0,
    fn: 0,
    precision: 0,
    recall: 0,
    f1: 0,
  };
}

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
 * Phase 6 regression gate. Error rows fail independently of F1 so a crashed case can never be
 * hidden by the aggregate. The 0.500 floor is the corrected-product-path floor: the historical
 * raw-node_links report was 0.250, while the shipped impact fallback is required to recover the
 * two receiver/method-call cases in addition to the static-call and re-export controls.
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
    const actual = aggregate.meanF1 === null ? "n/a" : aggregate.meanF1.toFixed(3);
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

/** Markdown summary for CI job summaries / PR comments -- includes the aggregate caveat block
 * so a bare F1 number can never circulate without its context. */
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
