import {
  SYSTEM1_HELD_OUT_SPLITS,
  SYSTEM1_SPLITS,
} from "../system1-constants.js";
import {
  SYSTEM1_EVAL_CERTIFICATION_MODES,
  SYSTEM1_EVAL_PROTOCOL_VERSION,
  SYSTEM1_EVAL_PRECISION_TARGET_KEYS,
  SYSTEM1_EVAL_REPORT_COLUMNS,
  SYSTEM1_EVAL_SLICE_REPORT_COLUMNS,
  SYSTEM1_EVAL_REPORT_TEXT,
  SYSTEM1_EVAL_SLICE_DIMENSIONS,
  SYSTEM1_EVAL_THRESHOLD_STATUSES,
} from "./system1-eval-constants.js";
import type {
  System1EvalCertificationMode,
  System1EvaluationPolicy,
  System1SplitMetrics,
  System1TargetMetrics,
  System1SplitAccountingFunnel,
} from "./system1-eval-types.js";

export interface System1EvalSealReference {
  readonly sealSha256: string;
  readonly stateSha256: string;
  readonly labelsSha256: string;
  readonly recordCount: number;
}

export interface System1EvalReportInput {
  readonly scorerId: string;
  readonly policyHash: string;
  readonly selectedCertificationMode: System1EvalCertificationMode;
  readonly splitMetrics: readonly System1SplitMetrics[];
  readonly sealedInputs: Readonly<Record<string, System1EvalSealReference>>;
  readonly certificationModes?: readonly {
    readonly mode: System1EvalCertificationMode;
    readonly splitMetrics: readonly System1SplitMetrics[];
  }[];
  readonly lofoPolicy?: System1EvaluationPolicy;
  readonly accountingFunnels?: Readonly<
    Record<string, readonly System1SplitAccountingFunnel[]>
  >;
}

function formatValue(value: number | null): string {
  return value === null ? SYSTEM1_EVAL_REPORT_TEXT.NO_RATE : value.toFixed(4);
}

function formatPercentRate(
  metric: System1TargetMetrics["requestLevel"]["commitRate"],
): string {
  if (metric.rate === null) return SYSTEM1_EVAL_REPORT_TEXT.NO_RATE;
  const interval = metric.interval95;
  const point = `${(metric.rate * 100).toFixed(2)}%`;
  return interval === null
    ? point
    : `${point} [${(interval.lower * 100).toFixed(2)}%, ${(interval.upper * 100).toFixed(2)}%]`;
}

function formatPercent(value: number | null): string {
  return value === null
    ? SYSTEM1_EVAL_REPORT_TEXT.NO_RATE
    : `${(value * 100).toFixed(2)}%`;
}

function heldOutMetricStatus(
  split: string,
  targetPrecision: number,
  precision: System1TargetMetrics["requestLevel"]["exactSetPrecision"],
  certified: boolean,
): string {
  if (
    !SYSTEM1_HELD_OUT_SPLITS.includes(
      split as (typeof SYSTEM1_HELD_OUT_SPLITS)[number],
    )
  )
    return SYSTEM1_EVAL_REPORT_TEXT.NO_RATE;
  if (!certified) return "uncertifiable";
  if (precision.rate === null || precision.interval95 === null)
    return SYSTEM1_EVAL_REPORT_TEXT.TARGET_MISSED;
  return precision.rate >= targetPrecision &&
    precision.interval95.lower >= targetPrecision
    ? SYSTEM1_EVAL_REPORT_TEXT.TARGET_MET
    : SYSTEM1_EVAL_REPORT_TEXT.TARGET_MISSED;
}

function heldOutTargetStatus(
  split: string,
  target: System1TargetMetrics,
  certificationMode: System1EvalCertificationMode,
): string {
  const provenance = metricProvenance(split, certificationMode);
  if (provenance !== null) return provenance;
  return heldOutMetricStatus(
    split,
    target.targetPrecision,
    target.requestLevel.independentGroups.exactSetPrecision,
    target.certification.status === SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED,
  );
}

function heldOutRowTargetStatus(
  split: string,
  target: System1TargetMetrics,
  certificationMode: System1EvalCertificationMode,
): string {
  const provenance = metricProvenance(split, certificationMode);
  if (provenance !== null) return provenance;
  return heldOutMetricStatus(
    split,
    target.targetPrecision,
    target.requestLevel.exactSetPrecision,
    target.certification.rowLevelComparison?.status ===
      SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED,
  );
}

function metricProvenance(
  split: string,
  certificationMode: System1EvalCertificationMode,
): string | null {
  if (
    certificationMode ===
      SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT &&
    (split === SYSTEM1_SPLITS.TRAIN || split === SYSTEM1_SPLITS.CALIBRATION)
  )
    return SYSTEM1_EVAL_REPORT_TEXT.OUT_OF_FOLD;
  if (
    certificationMode === SYSTEM1_EVAL_CERTIFICATION_MODES.CALIBRATION_ONLY &&
    split === SYSTEM1_SPLITS.CALIBRATION
  )
    return SYSTEM1_EVAL_REPORT_TEXT.IN_SAMPLE;
  return null;
}

function formatRow(
  split: string,
  key: string,
  target: System1TargetMetrics,
  ece: number | null,
  brier: number | null,
  certificationMode: System1EvalCertificationMode,
): string {
  const request = target.requestLevel;
  const provenance = metricProvenance(split, certificationMode);
  const certified =
    target.certification.status === SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED;
  const row = [
    split,
    key,
    certified ? "certified" : "uncertifiable",
    heldOutTargetStatus(split, target, certificationMode),
    heldOutRowTargetStatus(split, target, certificationMode),
    formatPercentRate(request.lspAvoidanceRate),
    formatPercentRate(request.independentGroups.commitRate),
    formatPercentRate(request.exactSetPrecision),
    formatPercentRate(request.independentGroups.exactSetPrecision),
    formatPercent(target.candidateLevel.goldPositiveCoverage.rate),
    formatPercent(request.falseSafePerTrustedRequest.rate),
    `${request.independentGroups.committedCount}/${target.certification.minimumIndependentCommits}${request.independentGroups.committedCount >= target.certification.minimumIndependentCommits ? "" : " (insufficient)"}`,
    provenance !== null
      ? `${formatValue(ece)} (${provenance})`
      : formatValue(ece),
    provenance !== null
      ? `${formatValue(brier)} (${provenance})`
      : formatValue(brier),
    formatPercent(request.unknownRate.rate),
    formatPercent(request.verifyRate.rate),
  ];
  return `| ${row.join(" | ")} |`;
}

function targetRows(
  split: string,
  byPrecisionTarget: Readonly<Record<string, System1TargetMetrics>>,
  ece: number | null,
  brier: number | null,
  certificationMode: System1EvalCertificationMode,
): string[] {
  return SYSTEM1_EVAL_PRECISION_TARGET_KEYS.map((key) => {
    const target = byPrecisionTarget[key];
    if (target)
      return formatRow(split, key, target, ece, brier, certificationMode);
    const emptyCells = [
      split,
      key,
      SYSTEM1_EVAL_THRESHOLD_STATUSES.UNCERTIFIABLE,
      ...Array.from(
        { length: SYSTEM1_EVAL_REPORT_COLUMNS.length - 3 },
        () => SYSTEM1_EVAL_REPORT_TEXT.NO_RATE,
      ),
    ];
    return `| ${emptyCells.join(" | ")} |`;
  });
}

function splitOrder(split: string): number {
  const order = [
    SYSTEM1_SPLITS.CALIBRATION,
    SYSTEM1_SPLITS.TEMPORAL,
    SYSTEM1_SPLITS.TEST,
    SYSTEM1_SPLITS.TRAIN,
  ];
  const index = order.indexOf(split as (typeof order)[number]);
  return index < 0 ? order.length : index;
}

function sliceSections(splits: readonly System1SplitMetrics[]): string[] {
  const allSlices = splits.flatMap((split) =>
    split.slices.map((slice) => ({ split: split.split, slice })),
  );
  const dimensions = Object.values(SYSTEM1_EVAL_SLICE_DIMENSIONS);
  const output: string[] = [];
  for (const dimension of dimensions) {
    output.push(`### ${dimension}`, "");
    output.push(`| ${SYSTEM1_EVAL_SLICE_REPORT_COLUMNS.join(" | ")} |`);
    output.push(
      `| ${SYSTEM1_EVAL_SLICE_REPORT_COLUMNS.map(() => "---").join(" | ")} |`,
    );
    const rows = allSlices
      .filter(({ slice }) => slice.dimension === dimension)
      .sort(
        (left, right) =>
          splitOrder(left.split) - splitOrder(right.split) ||
          (left.slice.key < right.slice.key
            ? -1
            : left.slice.key > right.slice.key
              ? 1
              : 0),
      );
    for (const { split, slice } of rows) {
      for (const key of SYSTEM1_EVAL_PRECISION_TARGET_KEYS) {
        const target = slice.byPrecisionTarget[key];
        if (!target) continue;
        output.push(
          `| ${split} | ${slice.key} | ${slice.sampleCount} | ${slice.trustedRequestCount} | ${key} | ${formatPercentRate(target.requestLevel.lspAvoidanceRate)} | ${formatPercentRate(target.requestLevel.independentGroups.commitRate)} | ${formatPercentRate(target.requestLevel.exactSetPrecision)} | ${formatPercentRate(target.requestLevel.independentGroups.exactSetPrecision)} | ${formatPercent(target.requestLevel.falseSafePerTrustedRequest.rate)} | ${formatValue(slice.calibration.ece)} | ${formatValue(slice.calibration.brierScore)} | ${formatPercent(target.requestLevel.unknownRate.rate)} | ${formatPercent(target.requestLevel.verifyRate.rate)} |`,
        );
      }
    }
    output.push("");
  }
  return output;
}

function riskCoverageSections(
  splits: readonly System1SplitMetrics[],
): string[] {
  const lines = [
    SYSTEM1_EVAL_REPORT_TEXT.RISK_COVERAGE_HEADER,
    "",
    "Rows are confidence thresholds; pooled train+calibration points use fold-specific OOF calibrators under LOFO, while held-out points use the frozen full-pool calibrator.",
    "",
    "| split | threshold | row coverage | row exact-set precision | duplicate-group coverage | duplicate-group exact-set precision |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const split of [...splits].sort(
    (left, right) => splitOrder(left.split) - splitOrder(right.split),
  )) {
    for (const point of split.calibration.riskCoverage) {
      lines.push(
        `| ${split.split} | ${point.threshold} | ${formatPercent(point.rowCoverage)} | ${formatPercent(point.rowExactSetPrecision)} | ${formatPercent(point.independentCoverage)} | ${formatPercent(point.independentExactSetPrecision)} |`,
      );
    }
  }
  return [...lines, ""];
}

function oldRowComparisonCells(target: System1TargetMetrics): string[] {
  const comparison = target.certification.rowLevelComparison;
  if (!comparison)
    return [
      SYSTEM1_EVAL_REPORT_TEXT.NO_RATE,
      SYSTEM1_EVAL_REPORT_TEXT.NO_RATE,
      "0 / 0",
      SYSTEM1_EVAL_REPORT_TEXT.NO_RATE,
    ];
  return [
    comparison.status,
    String(comparison.threshold ?? SYSTEM1_EVAL_REPORT_TEXT.NO_RATE),
    `${comparison.commitCount} / ${comparison.exactSetCount}`,
    formatPercent(comparison.lowerBound),
  ];
}

function certificationModeRow(
  mode: NonNullable<System1EvalReportInput["certificationModes"]>[number],
  split: System1SplitMetrics,
  key: string,
  target: System1TargetMetrics,
): string {
  const certification = target.certification;
  const row = [
    mode.mode,
    split.split,
    key,
    certification.status,
    String(certification.threshold ?? SYSTEM1_EVAL_REPORT_TEXT.NO_RATE),
    `${certification.calibrationCommitCount} / ${certification.calibrationExactSetCount}`,
    formatPercent(certification.lowerBound),
    ...oldRowComparisonCells(target),
    formatPercentRate(target.requestLevel.lspAvoidanceRate),
    formatPercentRate(target.requestLevel.exactSetPrecision),
    formatPercentRate(target.requestLevel.independentGroups.exactSetPrecision),
    heldOutTargetStatus(split.split, target, mode.mode),
    heldOutRowTargetStatus(split.split, target, mode.mode),
  ];
  return `| ${row.join(" | ")} |`;
}

function certificationModeSplitRows(
  mode: NonNullable<System1EvalReportInput["certificationModes"]>[number],
  split: System1SplitMetrics,
): string[] {
  return SYSTEM1_EVAL_PRECISION_TARGET_KEYS.flatMap((key) => {
    const target = split.byPrecisionTarget[key];
    return target ? [certificationModeRow(mode, split, key, target)] : [];
  });
}

function certificationModeRows(
  inputs: NonNullable<System1EvalReportInput["certificationModes"]>,
): string[] {
  const lines = [
    SYSTEM1_EVAL_REPORT_TEXT.CERTIFICATION_MODES_HEADER,
    "",
    SYSTEM1_EVAL_REPORT_TEXT.ROW_LEVEL_COMPARISON_DESCRIPTION,
    "",
    SYSTEM1_EVAL_REPORT_TEXT.METRIC_PROVENANCE_DESCRIPTION,
    "",
    "| mode | split | target | group status | group threshold | group commits / exact | group CP lower | old row status | old row threshold | row commits / exact | row CP lower | commit / LSP avoidance | row precision (95% CI) | group precision (95% CI) | group precision provenance / held-out target | row precision provenance / held-out target |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |",
  ];
  for (const mode of inputs) {
    const sorted = [...mode.splitMetrics].sort(
      (left, right) => splitOrder(left.split) - splitOrder(right.split),
    );
    for (const split of sorted)
      lines.push(...certificationModeSplitRows(mode, split));
  }
  return [...lines, ""];
}

function lofoFamilyRows(policy: System1EvaluationPolicy): string[] {
  const lines = [
    SYSTEM1_EVAL_REPORT_TEXT.LOFO_FAMILY_HEADER,
    "",
    "| target | diagnostic kind | threshold | pooled groups | pooled exact groups | pooled CP lower | pooled row commits | pooled row exact | worst-family CP lower | family | groups | exact groups | group precision | family CP lower | row commits | row exact | family gate |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const target of policy.precisionTargets) {
    const tables =
      target.oofFamilyDiagnostics ??
      (target.oofFamilyTable ? [target.oofFamilyTable] : []);
    for (const table of tables) {
      for (const family of table.families) {
        lines.push(
          `| ${target.targetPrecision.toFixed(3)} | ${table.diagnosticKind} | ${table.evaluatedThreshold ?? SYSTEM1_EVAL_REPORT_TEXT.NO_RATE} | ${table.pooledCommitCount} | ${table.pooledExactSetCount} | ${formatPercent(table.pooledLowerBound)} | ${table.pooledRowCommitCount} | ${table.pooledRowExactSetCount} | ${formatPercent(table.worstFamilyLowerBound)} | ${family.family} | ${family.commits} | ${family.exactSetCount} | ${formatPercent(family.exactSetPrecision)} | ${formatPercent(family.lowerBound)} | ${family.rowCommits} | ${family.rowExactSetCount} | ${family.usedForFamilyGate ? (family.familyGateSatisfied ? "pass" : "fail") : "below minimum"} |`,
        );
      }
    }
  }
  return [...lines, ""];
}

function accountingFunnelRows(
  funnels:
    | Readonly<Record<string, readonly System1SplitAccountingFunnel[]>>
    | undefined,
): string[] {
  if (!funnels) return [];
  const cell = (value: {
    readonly rows: number;
    readonly duplicateGroups: number;
  }) => `${value.rows} / ${value.duplicateGroups}`;
  const reasonCell = (
    reasons: Readonly<
      Record<
        string,
        { readonly rows: number; readonly duplicateGroups: number }
      >
    >,
  ) =>
    Object.entries(reasons)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([reason, value]) => `${reason}: ${cell(value)}`)
      .join("; ") || "none";
  const lines = [
    SYSTEM1_EVAL_REPORT_TEXT.ACCOUNTING_FUNNEL_HEADER,
    "",
    "Each count reports rows / duplicate groups. Eligible candidate requests split into a candidate-miss side count and model-eligible requests; misses on empty candidate sets are shown separately. Candidate-miss commits are listed as Tier A failures.",
    "",
    "| target | split | raw corpus | export excluded by reason | after export | untrusted by reason | trusted | eligible candidates | candidate misses | empty-set misses | model eligible | committed | exact | candidate-miss commits |",
    "| ---: | --- | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const target of Object.keys(funnels).sort()) {
    for (const funnel of [...funnels[target]].sort(
      (left, right) => splitOrder(left.split) - splitOrder(right.split),
    )) {
      lines.push(
        `| ${target} | ${funnel.split} | ${cell(funnel.rawCorpus)} | ${reasonCell(funnel.exportExclusionsByReason)} | ${cell(funnel.afterExportExclusions)} | ${reasonCell(funnel.untrustedLabelsByReason)} | ${cell(funnel.trusted)} | ${cell(funnel.eligibleWithCandidates)} | ${cell(funnel.candidateMisses)} | ${cell(funnel.candidateMissesWithoutCandidates)} | ${cell(funnel.eligibleWithoutCandidateMiss)} | ${cell(funnel.committed)} | ${cell(funnel.exact)} | ${cell(funnel.candidateMissCommits)} |`,
      );
    }
  }
  return [...lines, ""];
}

/** Stable Markdown report; it contains no run timestamps or durations. */
export function renderSystem1EvalReport(input: System1EvalReportInput): string {
  const lines = [
    SYSTEM1_EVAL_REPORT_TEXT.TITLE,
    "",
    `Scorer: \`${input.scorerId}\``,
    `Evaluation protocol: \`${SYSTEM1_EVAL_PROTOCOL_VERSION}\``,
    `Frozen policy SHA-256: \`${input.policyHash}\``,
    "",
    SYSTEM1_EVAL_REPORT_TEXT.SUMMARY_HEADER,
    "",
    `| ${SYSTEM1_EVAL_REPORT_COLUMNS.join(" | ")} |`,
    `| ${SYSTEM1_EVAL_REPORT_COLUMNS.map(() => "---").join(" | ")} |`,
  ];
  const sortedSplits = [...input.splitMetrics].sort(
    (left, right) => splitOrder(left.split) - splitOrder(right.split),
  );
  lines.push(
    SYSTEM1_EVAL_REPORT_TEXT.REGRESSION_CHECK_NOTICE,
    "",
    SYSTEM1_EVAL_REPORT_TEXT.METRIC_PROVENANCE_DESCRIPTION,
    "",
  );
  for (const split of sortedSplits) {
    lines.push(
      ...targetRows(
        split.split,
        split.byPrecisionTarget,
        split.calibration.ece,
        split.calibration.brierScore,
        input.selectedCertificationMode,
      ),
    );
  }
  if (input.certificationModes?.length)
    lines.push(...certificationModeRows(input.certificationModes));
  if (input.lofoPolicy) lines.push(...lofoFamilyRows(input.lofoPolicy));
  lines.push(...accountingFunnelRows(input.accountingFunnels));
  lines.push(...riskCoverageSections(sortedSplits));
  lines.push("", SYSTEM1_EVAL_REPORT_TEXT.SLICES_HEADER, "");
  lines.push(...sliceSections(sortedSplits));
  lines.push(SYSTEM1_EVAL_REPORT_TEXT.SEALS_HEADER, "");
  const sealEntries = Object.entries(input.sealedInputs).sort(
    ([left], [right]) => splitOrder(left) - splitOrder(right),
  );
  if (sealEntries.length === 0) lines.push(SYSTEM1_EVAL_REPORT_TEXT.NO_SEALS);
  for (const [split, seal] of sealEntries) {
    lines.push(
      `- ${split}: ${seal.recordCount} records; seal SHA-256 \`${seal.sealSha256}\`; state SHA-256 \`${seal.stateSha256}\`; labels SHA-256 \`${seal.labelsSha256}\`.`,
    );
  }
  lines.push(
    "",
    SYSTEM1_EVAL_REPORT_TEXT.POLICY_HEADER,
    "",
    input.selectedCertificationMode ===
      SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT
      ? SYSTEM1_EVAL_REPORT_TEXT.LOFO_POLICY_DESCRIPTION
      : SYSTEM1_EVAL_REPORT_TEXT.CALIBRATION_ONLY_POLICY_DESCRIPTION,
    input.selectedCertificationMode ===
      SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT
      ? SYSTEM1_EVAL_REPORT_TEXT.CALIBRATION_ONLY_COMPARISON
      : SYSTEM1_EVAL_REPORT_TEXT.LOFO_COMPARISON,
    "",
  );
  return `${lines.join("\n")}\n`;
}
