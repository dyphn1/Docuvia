/** Pure Phase 4 hard gates over the normalized report model. */

import {
  PHASE4_SLICE_IDS,
  PHASE4_METRIC_IDS,
  assertImpactHonestyReportSchemaVersion,
  phase4RecordCaseId,
  type ImpactHonestyReport,
  type Phase4Rate,
  type Phase4SliceId,
} from "./impact-honesty-report.phase4.js";

export const PHASE4_GATE_IDS = {
  CASE_INVENTORY: "case-inventory",
  ERROR_CASES: "error-cases",
  FALSE_SAFE: "false-safe",
  PROVENANCE: "provenance",
  NEGATIVE_DISCRIMINATION: "negative-discrimination",
  TARGET_IDENTITY: "target-identity",
  DETERMINISTIC_REPLAY: "deterministic-replay",
  LEGACY_REGRESSION: "legacy-regression",
  PHASE_REGRESSION: "phase-regression",
  STATE_ROBUSTNESS: "state-robustness",
  KNOWN_DEFECT_REGISTRY: "known-defect-registry",
  REPORT_FORMAT: "report-format",
} as const;

export const PHASE4_REPORT_SCOPE = "report";

export type Phase4GateId =
  (typeof PHASE4_GATE_IDS)[keyof typeof PHASE4_GATE_IDS];

export interface Phase4GateViolation {
  readonly gateId: Phase4GateId;
  readonly sliceId: string;
  readonly caseIds: string[];
  readonly detail: string;
}

export const PHASE4_FORBIDDEN_REPORT_TERMS = [
  "overall",
  "blended",
  "aggregate accuracy",
] as const;

function violation(
  gateId: Phase4GateId,
  sliceId: string,
  caseIds: readonly string[],
  detail: string,
): Phase4GateViolation {
  return {
    gateId,
    sliceId,
    caseIds: [...new Set(caseIds)].sort(),
    detail,
  };
}

function rateProblem(name: string, value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return `${name} is missing its numerator/denominator`;
  }
  const rate = value as Partial<Phase4Rate>;
  if (
    typeof rate.numerator !== "number" ||
    typeof rate.denominator !== "number"
  ) {
    return `${name} is missing its numerator/denominator`;
  }
  if (rate.denominator === 0) {
    return rate.value === null
      ? null
      : `${name} must be n/a for an empty denominator`;
  }
  if (typeof rate.value !== "number" || !Number.isFinite(rate.value)) {
    return `${name} is missing its value`;
  }
  return Math.abs(rate.value - rate.numerator / rate.denominator) < 1e-12
    ? null
    : `${name} value does not match its numerator/denominator`;
}

function reportFormatViolations(
  report: ImpactHonestyReport,
): Phase4GateViolation[] {
  const serialized = JSON.stringify(report).toLowerCase();
  const forbidden = PHASE4_FORBIDDEN_REPORT_TERMS.find((term) =>
    serialized.includes(term),
  );
  if (forbidden) {
    return [
      violation(
        PHASE4_GATE_IDS.REPORT_FORMAT,
        PHASE4_REPORT_SCOPE,
        [],
        `forbidden blended-score term '${forbidden}' is present`,
      ),
    ];
  }

  const rateEntries: Array<[string, unknown]> = [
    [
      PHASE4_METRIC_IDS.LEGACY_PRECISION,
      report.metrics.legacyPositiveRegression.precision,
    ],
    [
      PHASE4_METRIC_IDS.LEGACY_RECALL,
      report.metrics.legacyPositiveRegression.recall,
    ],
    [
      PHASE4_METRIC_IDS.CONFIRMED_PRECISION,
      report.metrics.confirmedDependencyAccuracy.precision,
    ],
    [
      PHASE4_METRIC_IDS.CONFIRMED_RECALL,
      report.metrics.confirmedDependencyAccuracy.recall,
    ],
    [
      PHASE4_METRIC_IDS.NEGATIVE_SPECIFICITY,
      report.metrics.negativeDiscrimination.specificity,
    ],
    [
      PHASE4_METRIC_IDS.NEGATIVE_FALSE_POSITIVE_RATE,
      report.metrics.negativeDiscrimination.falsePositiveRate,
    ],
    [
      PHASE4_METRIC_IDS.WRONG_TARGET_RATE,
      report.metrics.targetIdentity.wrongTargetRate,
    ],
    [
      PHASE4_METRIC_IDS.GOLD_IN_CANDIDATE_SET,
      report.metrics.candidateBoundary.goldInCandidateSet,
    ],
    [
      PHASE4_METRIC_IDS.CORRECT_UNKNOWN_RATE,
      report.metrics.epistemicHonesty.correctUnknownRate,
    ],
    [
      PHASE4_METRIC_IDS.FALSE_SAFE_RATE,
      report.metrics.epistemicHonesty.falseSafeRate,
    ],
    [
      PHASE4_METRIC_IDS.PROVENANCE_MISMATCH_RATE,
      report.metrics.epistemicHonesty.provenanceMismatchRate,
    ],
  ];
  const problems = rateEntries.flatMap(([name, value]) => {
    const problem = rateProblem(name, value);
    return problem === null ? [] : [problem];
  });
  return problems.length === 0
    ? []
    : [
        violation(
          PHASE4_GATE_IDS.REPORT_FORMAT,
          PHASE4_REPORT_SCOPE,
          [],
          problems.join("; "),
        ),
      ];
}

function inventoryViolations(
  report: ImpactHonestyReport,
): Phase4GateViolation[] {
  return report.slices.flatMap((slice) => {
    const ids = [...slice.missingCaseIds, ...slice.unexpectedCaseIds];
    return ids.length === 0
      ? []
      : [
          violation(
            PHASE4_GATE_IDS.CASE_INVENTORY,
            slice.id,
            ids,
            `declared ${slice.sampleCount} case(s), observed ${slice.observedCaseIds.length}; missing=${slice.missingCaseIds.join(",") || "-"}; unexpected=${slice.unexpectedCaseIds.join(",") || "-"}`,
          ),
        ];
  });
}

function errorViolations(report: ImpactHonestyReport): Phase4GateViolation[] {
  const knownDefectCheckpoints = new Set(
    report.knownDefects.map((defect) => defect.checkpoint),
  );
  const errorIds = report.slices
    .flatMap((slice) => slice.errorCaseIds)
    .filter(
      (caseId) => !knownDefectCheckpoints.has(phase4RecordCaseId(caseId)),
    );
  const legacyErrors = report.metrics.legacyPositiveRegression.errors;
  const confirmedErrors = report.metrics.confirmedDependencyAccuracy.errors;
  return errorIds.length === 0 && legacyErrors === 0 && confirmedErrors === 0
    ? []
    : [
        violation(
          PHASE4_GATE_IDS.ERROR_CASES,
          PHASE4_REPORT_SCOPE,
          errorIds,
          `errors=${String(Math.max(errorIds.length, legacyErrors, confirmedErrors))}; dropped=${String(report.errors.length - errorIds.length)}`,
        ),
      ];
}

function metricViolations(report: ImpactHonestyReport): Phase4GateViolation[] {
  const metrics = report.metrics;
  const violations: Phase4GateViolation[] = [];
  const knownDefectCheckpoints = new Set(
    report.knownDefects.map((defect) => defect.checkpoint),
  );
  const activeHonestyResults = report.honestyCaseResults.filter(
    (result) =>
      !knownDefectCheckpoints.has(phase4RecordCaseId(result.scenario)),
  );
  const sliceForScenario = (scenario: string): Phase4SliceId | null => {
    const caseId = phase4RecordCaseId(scenario);
    const matches = report.slices.filter(
      (slice) =>
        slice.id !== PHASE4_SLICE_IDS.LEGACY && slice.caseIds.includes(caseId),
    );
    return matches.length === 1 ? matches[0].id : null;
  };
  const groupedCaseIds = (
    scenarios: readonly string[],
  ): Map<Phase4SliceId | string, string[]> => {
    const grouped = new Map<Phase4SliceId | string, string[]>();
    for (const scenario of scenarios) {
      const sliceId = sliceForScenario(scenario) ?? PHASE4_REPORT_SCOPE;
      const current = grouped.get(sliceId) ?? [];
      grouped.set(sliceId, [...current, scenario]);
    }
    return grouped;
  };
  const groupedViolations = (
    gateId: Phase4GateId,
    scenarios: readonly string[],
    detail: string,
  ): Phase4GateViolation[] =>
    [...groupedCaseIds(scenarios)]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([sliceId, caseIds]) => violation(gateId, sliceId, caseIds, detail));
  if (metrics.epistemicHonesty.falseSafeCases > 0) {
    violations.push(
      ...groupedViolations(
        PHASE4_GATE_IDS.FALSE_SAFE,
        activeHonestyResults
          .filter((result) => result.epistemic?.falseSafe === true)
          .map((result) => result.scenario),
        `false-safe ${metrics.epistemicHonesty.falseSafeCases}/${metrics.epistemicHonesty.unknownRequiredCases}`,
      ),
    );
  }
  if (metrics.epistemicHonesty.provenanceMismatches > 0) {
    violations.push(
      ...groupedViolations(
        PHASE4_GATE_IDS.PROVENANCE,
        activeHonestyResults
          .filter((result) => result.provenance.mismatches > 0)
          .map((result) => result.scenario),
        `provenance mismatches ${metrics.epistemicHonesty.provenanceMismatches}/${metrics.epistemicHonesty.provenanceChecked}`,
      ),
    );
  }
  const negative = metrics.negativeDiscrimination;
  if (
    negative.cases > 0 &&
    (negative.specificity.value !== 1 || negative.falsePositiveRate.value !== 0)
  ) {
    violations.push(
      ...groupedViolations(
        PHASE4_GATE_IDS.NEGATIVE_DISCRIMINATION,
        activeHonestyResults
          .filter((result) => result.intent === "negative")
          .map((result) => result.scenario),
        `specificity=${String(negative.specificity.value)}; false-positive rate=${String(negative.falsePositiveRate.value)}`,
      ),
    );
  }
  if (metrics.targetIdentity.wrongTargetCases > 0) {
    violations.push(
      ...groupedViolations(
        PHASE4_GATE_IDS.TARGET_IDENTITY,
        activeHonestyResults
          .filter((result) => result.targetResolution.wrongTarget)
          .map((result) => result.scenario),
        `wrong-target ${metrics.targetIdentity.wrongTargetCases}/${metrics.targetIdentity.checkedCases}`,
      ),
    );
  }
  if (metrics.stateRobustness.replayMismatches.length > 0) {
    violations.push(
      violation(
        PHASE4_GATE_IDS.DETERMINISTIC_REPLAY,
        PHASE4_SLICE_IDS.PHASE3,
        metrics.stateRobustness.replayMismatches,
        `replay mismatches=${String(metrics.stateRobustness.replayMismatches.length)}`,
      ),
    );
  }
  return violations;
}

function legacyViolations(report: ImpactHonestyReport): Phase4GateViolation[] {
  const legacy = report.slices.find(
    (slice) => slice.id === PHASE4_SLICE_IDS.LEGACY,
  );
  if (!legacy) {
    return [
      violation(
        PHASE4_GATE_IDS.LEGACY_REGRESSION,
        PHASE4_REPORT_SCOPE,
        [],
        "legacy slice missing",
      ),
    ];
  }
  const regressed = legacy.regressedCaseIds;
  const ids = [...legacy.missingCaseIds, ...regressed];
  return ids.length === 0
    ? []
    : [
        violation(
          PHASE4_GATE_IDS.LEGACY_REGRESSION,
          PHASE4_SLICE_IDS.LEGACY,
          ids,
          `missing=${legacy.missingCaseIds.join(",") || "-"}; regressed=${regressed.join(",") || "-"}`,
        ),
      ];
}

function upstreamViolations(
  report: ImpactHonestyReport,
): Phase4GateViolation[] {
  return report.upstreamGateFailures.map((failure) =>
    violation(
      PHASE4_GATE_IDS.PHASE_REGRESSION,
      failure.sliceId,
      failure.caseIds,
      `${failure.gateId}: ${failure.detail}`,
    ),
  );
}

function stateViolations(report: ImpactHonestyReport): Phase4GateViolation[] {
  const registered = new Set(
    report.knownDefects.map((defect) => defect.checkpoint),
  );
  const badKinds = report.metrics.stateRobustness.byKind.filter(
    (kind) =>
      kind.failCount > 0 &&
      kind.caseIds.some((caseId) => !registered.has(caseId)),
  );
  const stale = report.metrics.stateRobustness.byKind.flatMap((kind) =>
    kind.staleEdgeViolations + kind.staleRecordViolations > 0 &&
    kind.caseIds.some((caseId) => !registered.has(caseId))
      ? kind.caseIds
      : [],
  );
  return badKinds.length === 0 && stale.length === 0
    ? []
    : [
        violation(
          PHASE4_GATE_IDS.STATE_ROBUSTNESS,
          PHASE4_SLICE_IDS.PHASE3,
          [...badKinds.flatMap((kind) => kind.caseIds), ...stale],
          `failed transitions=${String(report.metrics.stateRobustness.failCount)}; stale-edge=${String(report.metrics.stateRobustness.staleEdgeViolations)}; stale-record=${String(report.metrics.stateRobustness.staleRecordViolations)}`,
        ),
      ];
}

function registryViolations(
  report: ImpactHonestyReport,
): Phase4GateViolation[] {
  const bad = report.knownDefects.filter(
    (defect) =>
      !Number.isInteger(defect.issue) ||
      (defect.issue ?? 0) <= 0 ||
      defect.checkpoint.length === 0 ||
      defect.checkpointPassed,
  );
  return bad.length === 0
    ? []
    : [
        violation(
          PHASE4_GATE_IDS.KNOWN_DEFECT_REGISTRY,
          PHASE4_SLICE_IDS.PHASE3,
          bad.map((defect) => defect.checkpoint),
          bad
            .map(
              (defect) =>
                `${defect.defect}@${defect.checkpoint}#${String(defect.issue)}`,
            )
            .join(", "),
        ),
      ];
}

export function phase4ReportFormatViolations(
  report: ImpactHonestyReport,
): Phase4GateViolation[] {
  return reportFormatViolations(report);
}

export function phase4GateViolations(
  report: ImpactHonestyReport,
): Phase4GateViolation[] {
  try {
    assertImpactHonestyReportSchemaVersion(report.schemaVersion);
  } catch (error) {
    return [
      violation(
        PHASE4_GATE_IDS.REPORT_FORMAT,
        PHASE4_REPORT_SCOPE,
        [],
        error instanceof Error ? error.message : String(error),
      ),
    ];
  }
  return [
    ...reportFormatViolations(report),
    ...inventoryViolations(report),
    ...errorViolations(report),
    ...metricViolations(report),
    ...legacyViolations(report),
    ...upstreamViolations(report),
    ...stateViolations(report),
    ...registryViolations(report),
  ];
}

export function assertImpactHonestyReportGates(
  report: ImpactHonestyReport,
): void {
  const [first] = phase4GateViolations(report);
  if (first) {
    throw new Error(
      `Phase 4 impact honesty gate ${first.gateId} [${first.sliceId}] cases=${first.caseIds.join(",") || "-"}: ${first.detail}`,
    );
  }
}
