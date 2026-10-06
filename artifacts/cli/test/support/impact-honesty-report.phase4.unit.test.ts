import { describe, expect, it } from "vitest";
import {
  IMPACT_HONESTY_REPORT_SCHEMA_VERSION,
  PHASE4_CASE_FAMILIES,
  PHASE4_SLICE_IDS,
  buildImpactHonestyReport,
  type ImpactHonestyReport,
  type ImpactHonestyReportInput,
} from "./impact-honesty-report.phase4.js";
import {
  assertImpactHonestyReportGates,
  PHASE4_GATE_IDS,
  phase4GateViolations,
} from "./impact-honesty-gates.phase4.js";
import {
  assertImpactHonestyMarkdownFormat,
  phase4MarkdownFormatViolations,
  renderImpactHonestyReport,
} from "./impact-honesty-renderer.phase4.js";
import {
  IMPACT_HONESTY_SCHEMA_VERSION,
  scoreImpactHonestyCase,
  type ImpactHonestyCaseResult,
} from "./impact-eval-honesty.js";
import {
  aggregateCases,
  scoreCase,
  type ImpactEvalCaseResult,
} from "./impact-eval-scorer.js";

// TDD-SOURCE: issue #508 Phase 4 honest CI report and hard regression gates
// TDD-SOURCE: issue #549 report-format gate must inspect metric labels, not data values
// TDD-SOURCE: docs/ai_plans/acceptance_508-phase4-honest-ci-report.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase4.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase3.md
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md

const LEGACY_CASE_IDS = ["legacy-a", "legacy-b"] as const;

function honestyResult(
  scenario: string,
  overrides: Partial<Parameters<typeof scoreImpactHonestyCase>[0]> = {},
): ImpactHonestyCaseResult {
  return scoreImpactHonestyCase({
    schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
    scenario,
    target: "evalTarget",
    intent: "confirmed-positive",
    expectedStatus: "resolved",
    expectedConfirmedFiles: ["src/dependent.ts"],
    expectedCandidateFiles: [],
    observedStatus: "resolved",
    predictions: [{ file: "src/dependent.ts", channel: "static" }],
    ...overrides,
  });
}

function legacyResult(
  scenario: string,
  predictedFiles = ["src/dependent.ts"],
): ImpactEvalCaseResult {
  return scoreCase(scenario, "evalTarget", predictedFiles, [
    "src/dependent.ts",
  ]);
}

function input(
  overrides: Partial<ImpactHonestyReportInput> = {},
): ImpactHonestyReportInput {
  const legacyResults = LEGACY_CASE_IDS.map((scenario) =>
    legacyResult(scenario),
  );
  const phase1 = honestyResult("phase1-positive");
  const phase2 = honestyResult("phase2-positive", {
    scenario: "phase2-candidate#candidate-boundary",
    intent: "candidate-boundary",
    expectedConfirmedFiles: [],
    expectedCandidateFiles: ["src/dynamic.ts"],
    expectedPredictions: [
      { file: "src/dynamic.ts", channel: "dynamic-candidate" },
    ],
    predictions: [{ file: "src/dynamic.ts", channel: "dynamic-candidate" }],
  });
  const phase3 = honestyResult("T0@after:evalTarget#confirmed-positive");

  return {
    schemaVersion: IMPACT_HONESTY_REPORT_SCHEMA_VERSION,
    legacy: {
      scope: "legacy #192 positive regression",
      caseFamily: PHASE4_CASE_FAMILIES.LEGACY_POSITIVE,
      declaredCaseIds: [...LEGACY_CASE_IDS],
      results: legacyResults,
      aggregate: aggregateCases(legacyResults),
      missingCaseIds: [],
      regressedCaseIds: [],
    },
    phase1: {
      scope: "synthetic TypeScript Phase 1",
      caseFamily: PHASE4_CASE_FAMILIES.NEGATIVE_AMBIGUITY,
      declaredCaseIds: ["phase1-positive"],
      records: [phase1],
      upstreamGateFailures: [],
      exclusions: [],
    },
    phase2: {
      scope: "synthetic TypeScript Phase 2",
      caseFamily: PHASE4_CASE_FAMILIES.EPISTEMIC_CANDIDATE,
      declaredCaseIds: ["phase2-candidate"],
      records: [phase2],
      candidateObservations: [
        {
          caseId: "phase2-candidate",
          candidateSetSize: 1,
          overflow: false,
          unresolved: false,
        },
      ],
      upstreamGateFailures: [],
      exclusions: [],
    },
    phase3: {
      scope: "synthetic TypeScript Phase 3",
      caseFamily: PHASE4_CASE_FAMILIES.STATE_TRANSITION,
      declaredCaseIds: ["T0@after"],
      records: [phase3],
      stateTransitions: [
        {
          kind: "initial-ingest",
          passed: true,
          caseIds: ["T0@after"],
          staleEdgeViolations: 0,
          staleRecordViolations: 0,
        },
      ],
      replayMismatches: [],
      upstreamGateFailures: [],
      exclusions: [],
    },
    knownDefects: [
      {
        defect: "D10",
        checkpoint: "T10@after",
        issue: 522,
        checkpointPassed: false,
      },
      {
        defect: "D12",
        checkpoint: "T12@after",
        issue: 521,
        checkpointPassed: false,
      },
    ],
    ...overrides,
  };
}

describe("Phase 4 report builder", () => {
  it("[happy] builds the four labeled slices from existing evaluator outputs", () => {
    const report = buildImpactHonestyReport(input());

    expect(report.schemaVersion).toBe(1);
    expect(report.slices.map((slice) => slice.id)).toEqual([
      PHASE4_SLICE_IDS.LEGACY,
      PHASE4_SLICE_IDS.PHASE1,
      PHASE4_SLICE_IDS.PHASE2,
      PHASE4_SLICE_IDS.PHASE3,
    ]);
    expect(report.slices.map((slice) => slice.sampleCount)).toEqual([
      2, 1, 1, 1,
    ]);
    expect(report.slices[1]).toMatchObject({
      scope: "synthetic TypeScript Phase 1",
      caseFamily: PHASE4_CASE_FAMILIES.NEGATIVE_AMBIGUITY,
    });
    expect(report.metrics.negativeDiscrimination.resolvedCases).toBe(0);
    expect(report.naMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "negative specificity",
          reason: "no resolved negative cases",
        }),
      ]),
    );
    expect(report.knownDefects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkpoint: "T10@after", issue: 522 }),
      ]),
    );
  });

  it("[determinism] renders byte-identical output for identical evaluator inputs", () => {
    const first = renderImpactHonestyReport(buildImpactHonestyReport(input()));
    const second = renderImpactHonestyReport(buildImpactHonestyReport(input()));

    expect(first.json).toBe(second.json);
    expect(first.markdown).toBe(second.markdown);
  });

  it("[happy] replays the serialized report shape through the hard gates", () => {
    const rendered = renderImpactHonestyReport(
      buildImpactHonestyReport(input()),
    );
    const parsed = JSON.parse(rendered.json) as ImpactHonestyReport & {
      gates: { passed: boolean };
    };

    expect(parsed.gates.passed).toBe(true);
    expect(phase4GateViolations(parsed)).toEqual([]);
    expect(parsed.metrics.confirmedDependencyAccuracy.f1).toBe(1);
  });

  it("[happy] renders each rate with its actual counts and F1 with confusion counts", () => {
    const imprecise = honestyResult("phase3-imprecise", {
      predictions: [{ file: "src/unexpected.ts", channel: "static" }],
    });
    const report = buildImpactHonestyReport(
      input({
        phase3: {
          ...input().phase3,
          declaredCaseIds: ["T0@after", "phase3-imprecise"],
          records: [input().phase3.records[0], imprecise],
        },
      }),
    );
    const rendered = renderImpactHonestyReport(report);
    const rates = [
      report.metrics.legacyPositiveRegression.precision,
      report.metrics.legacyPositiveRegression.recall,
      report.metrics.confirmedDependencyAccuracy.precision,
      report.metrics.confirmedDependencyAccuracy.recall,
      report.metrics.negativeDiscrimination.specificity,
      report.metrics.negativeDiscrimination.falsePositiveRate,
      report.metrics.targetIdentity.wrongTargetRate,
      report.metrics.candidateBoundary.goldInCandidateSet,
      report.metrics.epistemicHonesty.correctUnknownRate,
      report.metrics.epistemicHonesty.falseSafeRate,
      report.metrics.epistemicHonesty.provenanceMismatchRate,
    ];
    for (const metric of rates) {
      if (metric.value === null) {
        expect(metric.denominator).toBe(0);
      } else {
        expect(metric.value).toBeCloseTo(metric.numerator / metric.denominator);
      }
    }
    const renderedRates = [
      report.metrics.legacyPositiveRegression.precision,
      report.metrics.legacyPositiveRegression.recall,
      report.metrics.confirmedDependencyAccuracy.precision,
      report.metrics.confirmedDependencyAccuracy.recall,
      report.metrics.negativeDiscrimination.specificity,
      report.metrics.negativeDiscrimination.falsePositiveRate,
      report.metrics.targetIdentity.wrongTargetRate,
      report.metrics.candidateBoundary.goldInCandidateSet,
      report.metrics.epistemicHonesty.correctUnknownRate,
      report.metrics.epistemicHonesty.falseSafeRate,
      report.metrics.epistemicHonesty.provenanceMismatchRate,
    ];
    for (const metric of renderedRates) {
      const printed =
        metric.value === null
          ? "n/a"
          : `${metric.value.toFixed(3)} (${metric.numerator}/${metric.denominator})`;
      expect(rendered.markdown).toContain(printed);
    }
    expect(rendered.markdown).toContain("F1: 1.000 (TP=2, FP=0, FN=0)");
    expect(rendered.markdown).toContain("F1: 0.667 (TP=2, FP=1, FN=1)");
  });

  it("[invalid-input] renders n/a for a constructed empty metric denominator", () => {
    const emptyNegative = honestyResult("phase1-empty-negative", {
      intent: "negative",
      expectedConfirmedFiles: [],
      predictions: [],
      observedStatus: "unknown",
    });
    const report = buildImpactHonestyReport(
      input({
        phase1: {
          ...input().phase1,
          declaredCaseIds: ["phase1-empty-negative"],
          records: [emptyNegative],
        },
      }),
    );
    const rendered = renderImpactHonestyReport(report);

    expect(report.metrics.negativeDiscrimination.specificity).toEqual({
      value: null,
      numerator: 0,
      denominator: 0,
    });
    expect(report.naMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "negative specificity",
          reason: "no resolved negative cases",
        }),
        expect.objectContaining({
          metric: "negative false-positive rate",
          reason: "no resolved negative cases",
        }),
      ]),
    );
    expect(rendered.markdown).toContain("Specificity: n/a");
  });

  it("[happy] excludes registered known defects from metric gates and marks state rows", () => {
    const knownDefectTarget = honestyResult(
      "T12@after:evalTarget#confirmed-positive",
      {
        expectedTargetIdentity: "src/correct.ts#evalTarget",
        observedTargetIdentity: "src/wrong.ts#evalTarget",
      },
    );
    const report = buildImpactHonestyReport(
      input({
        phase3: {
          ...input().phase3,
          declaredCaseIds: ["T0@after", "T12@after"],
          records: [input().phase3.records[0], knownDefectTarget],
          stateTransitions: [
            {
              kind: "initial-ingest",
              passed: true,
              caseIds: ["T0@after"],
              staleEdgeViolations: 0,
              staleRecordViolations: 0,
            },
            {
              kind: "T12",
              passed: false,
              caseIds: ["T12@before", "T12@after"],
              staleEdgeViolations: 1,
              staleRecordViolations: 1,
            },
          ],
        },
      }),
    );

    expect(report.metrics.targetIdentity.wrongTargetCases).toBe(0);
    expect(report.metrics.stateRobustness.failCount).toBe(0);
    expect(report.metrics.stateRobustness.staleEdgeViolations).toBe(0);
    expect(report.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: "T12@after",
          reason: expect.stringContaining("D12"),
        }),
      ]),
    );
    expect(renderImpactHonestyReport(report).markdown).toContain(
      "| T12 | 0 | 0 | 0 | 0 | 1 | D12 |",
    );
    expect(
      phase4GateViolations(report).filter(
        (violation) =>
          violation.gateId === PHASE4_GATE_IDS.TARGET_IDENTITY ||
          violation.gateId === PHASE4_GATE_IDS.STATE_ROBUSTNESS,
      ),
    ).toEqual([]);
  });

  it("[negative-control] an unregistered failing checkpoint still fails target and state gates", () => {
    const unregisteredWrongTarget = honestyResult(
      "T5@after:evalTarget#confirmed-positive",
      {
        expectedTargetIdentity: "src/correct.ts#evalTarget",
        observedTargetIdentity: "src/wrong.ts#evalTarget",
      },
    );
    const report = buildImpactHonestyReport(
      input({
        phase3: {
          ...input().phase3,
          declaredCaseIds: ["T0@after", "T5@after"],
          records: [input().phase3.records[0], unregisteredWrongTarget],
          stateTransitions: [
            {
              kind: "initial-ingest",
              passed: true,
              caseIds: ["T0@after"],
              staleEdgeViolations: 0,
              staleRecordViolations: 0,
            },
            {
              kind: "T5",
              passed: false,
              caseIds: ["T5@after"],
              staleEdgeViolations: 1,
              staleRecordViolations: 1,
            },
          ],
        },
      }),
    );
    const violations = phase4GateViolations(report);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateId: PHASE4_GATE_IDS.TARGET_IDENTITY,
          sliceId: PHASE4_SLICE_IDS.PHASE3,
          caseIds: ["T5@after:evalTarget#confirmed-positive"],
        }),
        expect.objectContaining({
          gateId: PHASE4_GATE_IDS.STATE_ROBUSTNESS,
          sliceId: PHASE4_SLICE_IDS.PHASE3,
          caseIds: ["T5@after"],
        }),
      ]),
    );
  });

  it("[invalid-input] rejects an unsupported report schema version", () => {
    expect(() =>
      buildImpactHonestyReport({
        ...input(),
        schemaVersion: 99,
      }),
    ).toThrow(/unsupported.*report schema version/i);
  });
});

describe("Phase 4 hard gates", () => {
  it("[happy] accepts the unpoisoned golden report", () => {
    expect(() =>
      assertImpactHonestyReportGates(buildImpactHonestyReport(input())),
    ).not.toThrow();
  });

  it("[negative-control] injected false positive fails negative-discrimination", () => {
    const negative = honestyResult("phase1-negative#negative", {
      intent: "negative",
      expectedConfirmedFiles: [],
      predictions: [],
    });
    const poisoned = buildImpactHonestyReport(
      input({
        phase1: {
          ...input().phase1,
          declaredCaseIds: ["phase1-negative"],
          records: [
            {
              ...negative,
              predictions: [{ file: "src/poison.ts", channel: "static" }],
              confirmedPredictedFiles: ["src/poison.ts"],
              negativeClassification: "false-positive",
            },
          ],
        },
      }),
    );

    expect(() => assertImpactHonestyReportGates(poisoned)).toThrow(
      new RegExp(PHASE4_GATE_IDS.NEGATIVE_DISCRIMINATION),
    );
  });

  it("[negative-control] injected false-safe classification fails false-safe gate", () => {
    const falseSafe = honestyResult("phase2-unknown#epistemic-unknown", {
      intent: "epistemic-unknown",
      expectedStatus: "unknown",
      observedStatus: "resolved",
      expectedConfirmedFiles: [],
      predictions: [],
    });
    const report = buildImpactHonestyReport(
      input({
        phase2: {
          ...input().phase2,
          declaredCaseIds: ["phase2-unknown"],
          records: [falseSafe],
        },
      }),
    );

    expect(() => assertImpactHonestyReportGates(report)).toThrow(
      new RegExp(PHASE4_GATE_IDS.FALSE_SAFE),
    );
  });

  it("[negative-control] attributes metric violations to their owning slice", () => {
    const falseSafe = honestyResult("T0@after:evalTarget#epistemic-unknown", {
      intent: "epistemic-unknown",
      expectedStatus: "unknown",
      observedStatus: "resolved",
      expectedConfirmedFiles: [],
      predictions: [],
    });
    const report = buildImpactHonestyReport(
      input({
        phase3: {
          ...input().phase3,
          records: [falseSafe],
        },
      }),
    );

    expect(
      phase4GateViolations(report).filter(
        (violation) => violation.gateId === PHASE4_GATE_IDS.FALSE_SAFE,
      ),
    ).toEqual([
      expect.objectContaining({
        sliceId: PHASE4_SLICE_IDS.PHASE3,
        caseIds: ["T0@after:evalTarget#epistemic-unknown"],
      }),
    ]);
  });

  it("[negative-control] injected wrong target fails target-identity gate", () => {
    const wrongTarget = honestyResult("phase1-wrong-target", {
      intent: "negative",
      expectedConfirmedFiles: [],
      predictions: [],
      expectedTargetIdentity: "src/correct.ts#evalTarget",
      observedTargetIdentity: "src/wrong.ts#evalTarget",
    });
    const report = buildImpactHonestyReport(
      input({
        phase1: {
          ...input().phase1,
          declaredCaseIds: ["phase1-wrong-target"],
          records: [wrongTarget],
        },
      }),
    );

    expect(() => assertImpactHonestyReportGates(report)).toThrow(
      new RegExp(PHASE4_GATE_IDS.TARGET_IDENTITY),
    );
  });

  it("[error-handling] injected evaluator error fails error-cases gate", () => {
    const errored = legacyResult("legacy-error");
    const report = buildImpactHonestyReport(
      input({
        legacy: {
          ...input().legacy,
          declaredCaseIds: ["legacy-error"],
          results: [{ ...errored, status: "error" }],
          aggregate: aggregateCases([{ ...errored, status: "error" }]),
        },
      }),
    );

    expect(() => assertImpactHonestyReportGates(report)).toThrow(
      new RegExp(PHASE4_GATE_IDS.ERROR_CASES),
    );
  });

  it("[invalid-input] dropping a declared case fails the inventory gate", () => {
    const report = buildImpactHonestyReport(
      input({
        phase1: {
          ...input().phase1,
          declaredCaseIds: ["phase1-positive", "phase1-dropped"],
        },
      }),
    );

    expect(() => assertImpactHonestyReportGates(report)).toThrow(
      new RegExp(PHASE4_GATE_IDS.CASE_INVENTORY),
    );
  });

  it("[negative-control] promoted dynamic candidate fails provenance gate", () => {
    const promoted = honestyResult("phase2-candidate#candidate-boundary", {
      intent: "candidate-boundary",
      expectedConfirmedFiles: [],
      expectedCandidateFiles: ["src/dynamic.ts"],
      expectedPredictions: [
        { file: "src/dynamic.ts", channel: "dynamic-candidate" },
      ],
      predictions: [{ file: "src/dynamic.ts", channel: "static" }],
    });
    const report = buildImpactHonestyReport(
      input({
        phase2: {
          ...input().phase2,
          records: [promoted],
        },
      }),
    );

    expect(() => assertImpactHonestyReportGates(report)).toThrow(
      new RegExp(PHASE4_GATE_IDS.PROVENANCE),
    );
  });

  it("[negative-control] a passing known-defect checkpoint fails registry gate", () => {
    const report = buildImpactHonestyReport(
      input({
        knownDefects: [
          {
            defect: "D10",
            checkpoint: "T10@after",
            issue: 522,
            checkpointPassed: true,
          },
        ],
      }),
    );

    expect(() => assertImpactHonestyReportGates(report)).toThrow(
      new RegExp(PHASE4_GATE_IDS.KNOWN_DEFECT_REGISTRY),
    );
  });

  it("[invalid-input] allows forbidden-score words in report data values", () => {
    const overallCase = legacyResult("overall-fanout-negative");
    const legacyB = legacyResult("legacy-b");
    const report = buildImpactHonestyReport(
      input({
        legacy: {
          ...input().legacy,
          declaredCaseIds: ["overall-fanout-negative", "legacy-b"],
          results: [overallCase, legacyB],
          aggregate: aggregateCases([overallCase, legacyB]),
          exclusions: [
            {
              caseId: "overall-fanout-negative",
              reason: "blended is fixture metadata, not a metric",
            },
          ],
        },
      }),
    );

    expect(phase4GateViolations(report)).toEqual([]);
    expect(() => renderImpactHonestyReport(report)).not.toThrow();
    expect(
      phase4MarkdownFormatViolations(
        "- Exclusions: overall-fanout-negative (blended fixture metadata)",
      ),
    ).toEqual([]);
  });

  it("[invalid-input] renders failing gate lines when case ids contain forbidden-score words", () => {
    const legacyB = legacyResult("legacy-b");
    const report = buildImpactHonestyReport(
      input({
        legacy: {
          ...input().legacy,
          declaredCaseIds: ["overall-fanout-negative", "legacy-b"],
          results: [legacyB],
          aggregate: aggregateCases([legacyB]),
        },
      }),
    );

    expect(phase4GateViolations(report)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateId: PHASE4_GATE_IDS.CASE_INVENTORY,
          caseIds: ["overall-fanout-negative"],
        }),
      ]),
    );
    const rendered = renderImpactHonestyReport(report);
    expect(rendered.markdown).toContain("cases=overall-fanout-negative:");
    expect(phase4MarkdownFormatViolations(rendered.markdown)).toEqual([]);
  });

  it("[error-handling] renderer rejects blended scores and missing denominators", () => {
    const report = buildImpactHonestyReport(input());
    const blended = {
      ...report,
      metrics: {
        ...report.metrics,
        overallAccuracy: {
          value: 1,
          numerator: 1,
          denominator: 1,
        },
      },
    } as unknown as typeof report;
    expect(() => renderImpactHonestyReport(blended)).toThrow(
      new RegExp(PHASE4_GATE_IDS.REPORT_FORMAT),
    );

    const aggregate = {
      ...report,
      metrics: {
        ...report.metrics,
        aggregateAccuracy: {
          value: 1,
          numerator: 1,
          denominator: 1,
        },
      },
    } as unknown as typeof report;
    expect(() => renderImpactHonestyReport(aggregate)).toThrow(
      new RegExp(PHASE4_GATE_IDS.REPORT_FORMAT),
    );

    const missingDenominator = {
      ...report,
      metrics: {
        ...report.metrics,
        negativeDiscrimination: {
          ...report.metrics.negativeDiscrimination,
          falsePositiveRate: undefined,
        },
      },
    } as unknown as typeof report;
    expect(() => renderImpactHonestyReport(missingDenominator)).toThrow(
      new RegExp(PHASE4_GATE_IDS.REPORT_FORMAT),
    );
    expect(phase4MarkdownFormatViolations("## Overall accuracy")).toEqual([
      expect.objectContaining({ gateId: PHASE4_GATE_IDS.REPORT_FORMAT }),
    ]);
    expect(() =>
      assertImpactHonestyMarkdownFormat("## Overall accuracy"),
    ).toThrow(new RegExp(PHASE4_GATE_IDS.REPORT_FORMAT));
    expect(phase4MarkdownFormatViolations("- aggregateAccuracy: 1")).toEqual([
      expect.objectContaining({ gateId: PHASE4_GATE_IDS.REPORT_FORMAT }),
    ]);
    expect(
      phase4MarkdownFormatViolations("- aggregate_accuracy: 1"),
    ).toEqual([
      expect.objectContaining({ gateId: PHASE4_GATE_IDS.REPORT_FORMAT }),
    ]);
  });

  it("[state-diff] replay mismatch is reported by its named gate", () => {
    const report = buildImpactHonestyReport(
      input({
        phase3: {
          ...input().phase3,
          replayMismatches: ["T0@after"],
        },
      }),
    );

    expect(() => assertImpactHonestyReportGates(report)).toThrow(
      new RegExp(PHASE4_GATE_IDS.DETERMINISTIC_REPLAY),
    );
  });
});

describe("Phase 4 renderer", () => {
  it("[happy] prints fixed sections and denominators without a blended score", () => {
    const rendered = renderImpactHonestyReport(
      buildImpactHonestyReport(input()),
    );
    const headings = [
      "## Legacy positive regression",
      "## Confirmed dependency accuracy",
      "## Negative discrimination",
      "## Ambiguity / target identity",
      "## Candidate-boundary quality",
      "## Epistemic honesty",
      "## State robustness",
      "## Errors, N/A and exclusions",
      "## Known product defects",
      "## What these metrics do NOT prove",
    ];

    expect(
      headings.every((heading) => rendered.markdown.includes(heading)),
    ).toBe(true);
    const headingOffsets = headings.map((heading) =>
      rendered.markdown.indexOf(heading),
    );
    expect(headingOffsets).toEqual([...headingOffsets].sort((a, b) => a - b));
    expect(rendered.markdown).toContain("1.000 (2/2)");
    expect(rendered.markdown).toContain("n/a");
    expect(rendered.markdown).not.toMatch(
      /overall|blended|aggregate accuracy/i,
    );
    expect(phase4MarkdownFormatViolations(rendered.markdown)).toEqual([]);
  });
});
