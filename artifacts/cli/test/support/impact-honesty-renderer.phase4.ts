/** Deterministic CI Markdown and JSON rendering for the Phase 4 report. */

import {
  PHASE4_FORBIDDEN_REPORT_TERMS,
  PHASE4_GATE_IDS,
  PHASE4_REPORT_SCOPE,
  phase4GateViolations,
  phase4ReportFormatViolations,
  type Phase4GateViolation,
} from "./impact-honesty-gates.phase4.js";
import type {
  ImpactHonestyReport,
  Phase4Rate,
  Phase4SliceReport,
  Phase4StateKindReport,
} from "./impact-honesty-report.phase4.js";

export const PHASE4_REPORT_SECTION_TITLES = {
  SLICES: "## Slices",
  LEGACY: "## Legacy positive regression",
  CONFIRMED: "## Confirmed dependency accuracy",
  NEGATIVE: "## Negative discrimination",
  IDENTITY: "## Ambiguity / target identity",
  CANDIDATE: "## Candidate-boundary quality",
  EPISTEMIC: "## Epistemic honesty",
  STATE: "## State robustness",
  ERRORS: "## Errors, N/A and exclusions",
  DEFECTS: "## Known product defects",
  GATES: "## Hard gates",
  FOOTER: "## What these metrics do NOT prove",
} as const;

export interface ImpactHonestyRenderedReport {
  readonly json: string;
  readonly markdown: string;
}

function formatRate(rate: Phase4Rate): string {
  return rate.value === null
    ? "n/a"
    : `${rate.value.toFixed(3)} (${rate.numerator}/${rate.denominator})`;
}

function formatF1(
  value: number | null,
  counts: { readonly tp: number; readonly fp: number; readonly fn: number },
): string {
  return value === null
    ? "n/a"
    : `${value.toFixed(3)} (TP=${counts.tp}, FP=${counts.fp}, FN=${counts.fn})`;
}

function formatSlice(slice: Phase4SliceReport): string {
  return `| ${slice.id} | ${slice.scope} | ${slice.caseFamily} | ${slice.sampleCount} | ${slice.errorCaseIds.length} |`;
}

function formatStateKind(kind: Phase4StateKindReport): string {
  return `| ${kind.kind} | ${kind.passCount} | ${kind.failCount} | ${kind.staleEdgeViolations} | ${kind.staleRecordViolations} | ${kind.excludedCount} | ${kind.knownDefectIds.join(", ") || "-"} |`;
}

function renderGateLines(violations: readonly Phase4GateViolation[]): string[] {
  if (violations.length === 0)
    return ["- PASS — all Phase 4 hard gates passed."];
  return violations.map(
    (violation) =>
      `- FAIL \`${violation.gateId}\` [${violation.sliceId}] cases=${violation.caseIds.join(", ") || "-"}: ${violation.detail}`,
  );
}

function ensureRenderable(report: ImpactHonestyReport): void {
  const [formatViolation] = phase4ReportFormatViolations(report);
  if (formatViolation) {
    throw new Error(
      `Phase 4 impact honesty gate ${formatViolation.gateId}: ${formatViolation.detail}`,
    );
  }
}

export function phase4MarkdownFormatViolations(
  markdown: string,
): Phase4GateViolation[] {
  const forbidden = PHASE4_FORBIDDEN_REPORT_TERMS.find((term) =>
    markdown.toLowerCase().includes(term),
  );
  return forbidden
    ? [
        {
          gateId: PHASE4_GATE_IDS.REPORT_FORMAT,
          sliceId: PHASE4_REPORT_SCOPE,
          caseIds: [],
          detail: `forbidden report term '${forbidden}' is present in Markdown`,
        },
      ]
    : [];
}

export function assertImpactHonestyMarkdownFormat(markdown: string): void {
  const [violation] = phase4MarkdownFormatViolations(markdown);
  if (violation) {
    throw new Error(
      `Phase 4 impact honesty gate ${violation.gateId}: ${violation.detail}`,
    );
  }
}

function renderMarkdown(report: ImpactHonestyReport): string {
  const metrics = report.metrics;
  const negative = metrics.negativeDiscrimination;
  const identity = metrics.targetIdentity;
  const candidate = metrics.candidateBoundary;
  const epistemic = metrics.epistemicHonesty;
  const state = metrics.stateRobustness;
  const gateViolations = phase4GateViolations(report);
  const lines = [
    "# Impact benchmark honesty",
    "",
    `Report schema version: ${String(report.schemaVersion)}`,
    "",
    PHASE4_REPORT_SECTION_TITLES.SLICES,
    "",
    "| slice | scope | case family | cases | errors |",
    "|---|---|---|---:|---:|",
    ...report.slices.map(formatSlice),
    "",
    PHASE4_REPORT_SECTION_TITLES.LEGACY,
    "",
    `- Cases: ${metrics.legacyPositiveRegression.cases}`,
    `- Errors: ${metrics.legacyPositiveRegression.errors}`,
    `- Precision: ${formatRate(metrics.legacyPositiveRegression.precision)}`,
    `- Recall: ${formatRate(metrics.legacyPositiveRegression.recall)}`,
    `- F1: ${formatF1(metrics.legacyPositiveRegression.f1, metrics.legacyPositiveRegression)}`,
    "",
    PHASE4_REPORT_SECTION_TITLES.CONFIRMED,
    "",
    `- Cases: ${metrics.confirmedDependencyAccuracy.cases}`,
    `- Errors: ${metrics.confirmedDependencyAccuracy.errors}`,
    `- Precision: ${formatRate(metrics.confirmedDependencyAccuracy.precision)}`,
    `- Recall: ${formatRate(metrics.confirmedDependencyAccuracy.recall)}`,
    `- F1: ${formatF1(metrics.confirmedDependencyAccuracy.f1, metrics.confirmedDependencyAccuracy)}`,
    "",
    PHASE4_REPORT_SECTION_TITLES.NEGATIVE,
    "",
    `- Resolved negative cases: ${negative.resolvedCases}/${negative.cases}`,
    `- Specificity: ${formatRate(negative.specificity)}`,
    `- False-positive case rate: ${formatRate(negative.falsePositiveRate)}`,
    "",
    PHASE4_REPORT_SECTION_TITLES.IDENTITY,
    "",
    `- Identity-checked cases: ${identity.checkedCases}`,
    `- Wrong-target count: ${identity.wrongTargetCases}`,
    `- Wrong-target rate: ${formatRate(identity.wrongTargetRate)}`,
    "",
    PHASE4_REPORT_SECTION_TITLES.CANDIDATE,
    "",
    `- Cases: ${candidate.cases}`,
    `- Gold-in-candidate-set rate: ${formatRate(candidate.goldInCandidateSet)}`,
    `- Median candidate set size: ${candidate.medianCandidateSetSize === null ? "n/a" : String(candidate.medianCandidateSetSize)}`,
    `- Maximum candidate set size: ${candidate.maxCandidateSetSize === null ? "n/a" : String(candidate.maxCandidateSetSize)}`,
    `- Overflow/unresolved cases: ${candidate.overflowOrUnresolvedCases}`,
    "",
    PHASE4_REPORT_SECTION_TITLES.EPISTEMIC,
    "",
    `- Unknown-required cases: ${epistemic.unknownRequiredCases}`,
    `- Correct-unknown rate: ${formatRate(epistemic.correctUnknownRate)}`,
    `- False-safe count: ${epistemic.falseSafeCases}`,
    `- False-safe rate: ${formatRate(epistemic.falseSafeRate)}`,
    `- Provenance checked: ${epistemic.provenanceChecked}`,
    `- Provenance mismatches: ${epistemic.provenanceMismatches}`,
    `- Provenance mismatch rate: ${formatRate(epistemic.provenanceMismatchRate)}`,
    "",
    PHASE4_REPORT_SECTION_TITLES.STATE,
    "",
    `- Transition pass/fail: ${state.passCount}/${state.failCount}`,
    `- Stale-edge violations: ${state.staleEdgeViolations}`,
    `- Stale-record violations: ${state.staleRecordViolations}`,
    `- Deterministic replay mismatches: ${state.replayMismatches.length}`,
    "",
    "| transition kind | pass | fail | stale-edge | stale-record | excluded | known defects |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...state.byKind.map(formatStateKind),
    "",
    PHASE4_REPORT_SECTION_TITLES.ERRORS,
    "",
    `- Error or missing-case ids: ${report.errors.join(", ") || "none"}`,
    `- N/A metrics: ${report.naMetrics.map((metric) => `${metric.metric} (${metric.reason})`).join(", ") || "none"}`,
    `- Exclusions: ${report.exclusions.map((exclusion) => `${exclusion.caseId} (${exclusion.reason})`).join(", ") || "none"}`,
    "",
    PHASE4_REPORT_SECTION_TITLES.DEFECTS,
    "",
    ...(report.knownDefects.length === 0
      ? ["- none"]
      : report.knownDefects.map(
          (defect) =>
            `- OPEN ${defect.defect} at \`${defect.checkpoint}\` → #${String(defect.issue ?? "?")}${defect.checkpointPassed ? " (checkpoint now passes; registry cleanup required)" : ""}`,
        )),
    "",
    PHASE4_REPORT_SECTION_TITLES.GATES,
    "",
    ...renderGateLines(gateViolations),
    "",
    PHASE4_REPORT_SECTION_TITLES.FOOTER,
    "",
    "This synthetic TypeScript report does not prove real-repository accuracy, other language coverage, correctness of unobserved runtime edges, or absence of product defects outside the registered checkpoints. See [the Phase 4 contract](docs/gitbook/analysis/impact-benchmark-honesty-phase4.md).",
    "",
  ];
  return lines.join("\n");
}

export function renderImpactHonestyReport(
  report: ImpactHonestyReport,
): ImpactHonestyRenderedReport {
  ensureRenderable(report);
  const markdown = renderMarkdown(report);
  assertImpactHonestyMarkdownFormat(markdown);
  const violations = phase4GateViolations(report);
  const json = `${JSON.stringify(
    {
      ...report,
      gates: {
        passed: violations.length === 0,
        violations,
      },
    },
    null,
    2,
  )}\n`;
  return { json, markdown };
}
