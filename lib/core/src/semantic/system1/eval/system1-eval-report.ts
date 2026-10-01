import {
  SYSTEM1_HELD_OUT_SPLITS,
  SYSTEM1_SPLITS,
} from "../system1-constants.js";
import {
  SYSTEM1_EVAL_CERTIFICATION_MODES,
  SYSTEM1_EVAL_PRECISION_TARGET_KEYS,
  SYSTEM1_EVAL_REPORT_COLUMNS,
  SYSTEM1_EVAL_REPORT_TEXT,
  SYSTEM1_EVAL_SLICE_DIMENSIONS,
  SYSTEM1_EVAL_THRESHOLD_STATUSES,
} from "./system1-eval-constants.js";
import type {
  System1EvalCertificationMode,
  System1EvaluationPolicy,
  System1SplitMetrics,
  System1TargetMetrics,
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

function heldOutTargetStatus(
  split: string,
  target: System1TargetMetrics,
  certificationMode: System1EvalCertificationMode,
): string {
  if (
    split === SYSTEM1_SPLITS.CALIBRATION ||
    (split === SYSTEM1_SPLITS.TRAIN &&
      certificationMode ===
        SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT)
  )
    return SYSTEM1_EVAL_REPORT_TEXT.IN_SAMPLE;
  if (
    !SYSTEM1_HELD_OUT_SPLITS.includes(
      split as (typeof SYSTEM1_HELD_OUT_SPLITS)[number],
    )
  )
    return SYSTEM1_EVAL_REPORT_TEXT.NO_RATE;
  if (target.certification.status !== SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED)
    return "uncertifiable";
  const precision = target.requestLevel.exactSetPrecision;
  if (precision.rate === null || precision.interval95 === null)
    return SYSTEM1_EVAL_REPORT_TEXT.TARGET_MISSED;
  return precision.rate >= target.targetPrecision &&
    precision.interval95.lower >= target.targetPrecision
    ? SYSTEM1_EVAL_REPORT_TEXT.TARGET_MET
    : SYSTEM1_EVAL_REPORT_TEXT.TARGET_MISSED;
}

function formatRow(
  split: string,
  key: string,
  target: System1TargetMetrics,
  ece: number | null,
  certificationMode: System1EvalCertificationMode,
): string {
  const request = target.requestLevel;
  const inSample =
    split === SYSTEM1_SPLITS.CALIBRATION ||
    (split === SYSTEM1_SPLITS.TRAIN &&
      certificationMode ===
        SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT);
  const certified =
    target.certification.status === SYSTEM1_EVAL_THRESHOLD_STATUSES.CERTIFIED;
  const row = [
    split,
    key,
    certified ? "certified" : "uncertifiable",
    heldOutTargetStatus(split, target, certificationMode),
    formatPercentRate(request.lspAvoidanceRate),
    formatPercentRate(request.exactSetPrecision),
    formatPercent(target.candidateLevel.goldPositiveCoverage.rate),
    formatPercent(request.falseSafePerTrustedRequest.rate),
    inSample
      ? `${formatValue(ece)} (${SYSTEM1_EVAL_REPORT_TEXT.IN_SAMPLE})`
      : formatValue(ece),
    formatPercent(request.unknownRate.rate),
    formatPercent(request.verifyRate.rate),
  ];
  return `| ${row.join(" | ")} |`;
}

function targetRows(
  split: string,
  byPrecisionTarget: Readonly<Record<string, System1TargetMetrics>>,
  ece: number | null,
  certificationMode: System1EvalCertificationMode,
): string[] {
  return SYSTEM1_EVAL_PRECISION_TARGET_KEYS.map((key) => {
    const target = byPrecisionTarget[key];
    if (target) return formatRow(split, key, target, ece, certificationMode);
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
    output.push(
      `| split | key | samples | trusted | precision target | commit / avoidance | exact-set precision (95% CI) | false-safe | ECE | UNKNOWN | VERIFY |`,
    );
    output.push(
      "| --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |",
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
          `| ${split} | ${slice.key} | ${slice.sampleCount} | ${slice.trustedRequestCount} | ${key} | ${formatPercentRate(target.requestLevel.lspAvoidanceRate)} | ${formatPercentRate(target.requestLevel.exactSetPrecision)} | ${formatPercent(target.requestLevel.falseSafePerTrustedRequest.rate)} | ${formatValue(slice.calibration.ece)} | ${formatPercent(target.requestLevel.unknownRate.rate)} | ${formatPercent(target.requestLevel.verifyRate.rate)} |`,
        );
      }
    }
    output.push("");
  }
  return output;
}

function certificationModeRows(
  inputs: NonNullable<System1EvalReportInput["certificationModes"]>,
): string[] {
  const lines = [
    SYSTEM1_EVAL_REPORT_TEXT.CERTIFICATION_MODES_HEADER,
    "",
    "| mode | split | target | threshold | commit / LSP avoidance | exact-set precision (95% CI) | meets target |",
    "| --- | --- | ---: | ---: | --- | --- | --- |",
  ];
  for (const mode of inputs) {
    const sorted = [...mode.splitMetrics].sort(
      (left, right) => splitOrder(left.split) - splitOrder(right.split),
    );
    for (const split of sorted) {
      for (const key of SYSTEM1_EVAL_PRECISION_TARGET_KEYS) {
        const target = split.byPrecisionTarget[key];
        if (!target) continue;
        lines.push(
          `| ${mode.mode} | ${split.split} | ${key} | ${target.certification.threshold ?? SYSTEM1_EVAL_REPORT_TEXT.NO_RATE} | ${formatPercentRate(target.requestLevel.lspAvoidanceRate)} | ${formatPercentRate(target.requestLevel.exactSetPrecision)} | ${heldOutTargetStatus(split.split, target, mode.mode)} |`,
        );
      }
    }
  }
  return [...lines, ""];
}

function lofoFamilyRows(policy: System1EvaluationPolicy): string[] {
  const lines = [
    SYSTEM1_EVAL_REPORT_TEXT.LOFO_FAMILY_HEADER,
    "",
    "| target | diagnostic kind | threshold | pooled commits | pooled exact sets | pooled CP lower | worst-family CP lower | family | commits | exact-set precision | family CP lower | family gate |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |",
  ];
  for (const target of policy.precisionTargets) {
    const tables =
      target.oofFamilyDiagnostics ??
      (target.oofFamilyTable ? [target.oofFamilyTable] : []);
    for (const table of tables) {
      for (const family of table.families) {
        lines.push(
          `| ${target.targetPrecision.toFixed(3)} | ${table.diagnosticKind} | ${table.evaluatedThreshold ?? SYSTEM1_EVAL_REPORT_TEXT.NO_RATE} | ${table.pooledCommitCount} | ${table.pooledExactSetCount} | ${formatPercent(table.pooledLowerBound)} | ${formatPercent(table.worstFamilyLowerBound)} | ${family.family} | ${family.commits} | ${formatPercent(family.exactSetPrecision)} | ${formatPercent(family.lowerBound)} | ${family.usedForFamilyGate ? (family.familyGateSatisfied ? "pass" : "fail") : "below minimum"} |`,
        );
      }
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
  for (const split of sortedSplits) {
    lines.push(
      ...targetRows(
        split.split,
        split.byPrecisionTarget,
        split.calibration.ece,
        input.selectedCertificationMode,
      ),
    );
  }
  if (input.certificationModes?.length)
    lines.push(...certificationModeRows(input.certificationModes));
  if (input.lofoPolicy) lines.push(...lofoFamilyRows(input.lofoPolicy));
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
      ? "The calibration-only comparison fits and certifies on in-sample calibration rows alone. A target is uncertifiable if no threshold passes its mode's certification gates."
      : "The LOFO comparison fits fold-specific maps and certifies on out-of-fold train+calibration rows. A target is uncertifiable if no threshold passes its mode's certification gates.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
