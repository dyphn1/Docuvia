import { describe, expect, it } from "vitest";
import { scoreCase } from "./impact-eval-scorer.js";
import {
  buildImpactHonestyReport,
  serializeImpactHonestyReport,
  type ImpactHonestyCase,
} from "./impact-eval-honesty.js";

// TDD-SOURCE: issue #508 Phase 0
// TDD-SOURCE: docs/gitbook/guidelines/impact-benchmark-honesty-contract.md

function caseOf(
  overrides: Partial<ImpactHonestyCase> = {},
): ImpactHonestyCase {
  return {
    scenario: "case",
    target: "target",
    intent: "confirmed-positive",
    outcome: "confirmed-positive",
    confirmedFiles: ["src/a.ts"],
    expectedConfirmedFiles: ["src/a.ts"],
    candidateFiles: [],
    expectedCandidateFiles: [],
    provenance: "static",
    expectedProvenance: "static",
    ...overrides,
  };
}

describe("issue #508 Phase 0 impact honesty contract", () => {
  it("keeps the existing positive-set F1 semantics unchanged", () => {
    const legacy = scoreCase("positive", "target", ["src/a.ts"], ["src/a.ts"]);
    expect(legacy).toMatchObject({
      tp: 1,
      fp: 0,
      fn: 0,
      precision: 1,
      recall: 1,
      f1: 1,
    });

    const report = buildImpactHonestyReport([
      caseOf({ scenario: "positive" }),
    ]);
    expect(report.metrics.positive).toMatchObject({
      cases: 1,
      meanPrecision: 1,
      meanRecall: 1,
      meanF1: 1,
    });
  });

  it("represents a perfect negative without forcing it through F1", () => {
    const report = buildImpactHonestyReport([
      caseOf({
        scenario: "negative",
        intent: "negative",
        outcome: "verified-negative",
        confirmedFiles: [],
        expectedConfirmedFiles: [],
        provenance: "none",
        expectedProvenance: "none",
      }),
    ]);

    expect(report.metrics.negative).toMatchObject({
      cases: 1,
      trueNegativeCases: 1,
      falsePositiveCases: 0,
      abstainedCases: 0,
      specificity: 1,
      falsePositiveRate: 0,
      verifiedNegativeRate: 1,
    });
    expect(report.metrics.positive.cases).toBe(0);
    expect(report.metrics.positive.meanF1).toBeNull();
  });

  it("lowers negative specificity and raises FPR for a false positive", () => {
    const report = buildImpactHonestyReport([
      caseOf({
        scenario: "tn",
        intent: "negative",
        outcome: "verified-negative",
        confirmedFiles: [],
        expectedConfirmedFiles: [],
      }),
      caseOf({
        scenario: "fp",
        intent: "negative",
        outcome: "confirmed-positive",
        confirmedFiles: ["src/unrelated.ts"],
        expectedConfirmedFiles: [],
      }),
    ]);

    expect(report.metrics.negative).toMatchObject({
      cases: 2,
      trueNegativeCases: 1,
      falsePositiveCases: 1,
      specificity: 0.5,
      falsePositiveRate: 0.5,
      verifiedNegativeRate: 0.5,
    });
  });

  it("does not promote candidate-only evidence into a confirmed true positive", () => {
    const report = buildImpactHonestyReport([
      caseOf({
        scenario: "candidate-is-not-confirmed",
        outcome: "candidate",
        confirmedFiles: [],
        expectedConfirmedFiles: ["src/a.ts"],
        candidateFiles: ["src/a.ts"],
        expectedCandidateFiles: ["src/a.ts"],
        provenance: "dynamic-candidate",
        expectedProvenance: "dynamic-candidate",
      }),
      caseOf({
        scenario: "candidate-slice",
        intent: "candidate-boundary",
        outcome: "candidate",
        confirmedFiles: [],
        expectedConfirmedFiles: [],
        candidateFiles: ["src/plugin-a.ts", "src/plugin-b.ts"],
        expectedCandidateFiles: ["src/plugin-a.ts"],
        provenance: "dynamic-candidate",
        expectedProvenance: "dynamic-candidate",
      }),
    ]);

    expect(report.metrics.positive).toMatchObject({
      cases: 1,
      meanPrecision: 0,
      meanRecall: 0,
      meanF1: 0,
    });
    expect(report.metrics.candidate).toMatchObject({
      cases: 1,
      meanCandidateRecall: 1,
      meanCandidateSetSize: 2,
      confirmedLeakageFiles: 0,
    });
  });

  it("keeps unknown, not-found, and error as distinct outcomes", () => {
    const report = buildImpactHonestyReport([
      caseOf({
        scenario: "unknown",
        intent: "epistemic-unknown",
        outcome: "unknown",
        confirmedFiles: [],
        expectedConfirmedFiles: [],
        provenance: "unresolved",
        expectedProvenance: "unresolved",
      }),
      caseOf({
        scenario: "not-found",
        intent: "not-found",
        outcome: "not-found",
        confirmedFiles: [],
        expectedConfirmedFiles: [],
        provenance: "none",
        expectedProvenance: "none",
      }),
      caseOf({
        scenario: "error",
        outcome: "error",
        confirmedFiles: [],
        expectedConfirmedFiles: ["src/a.ts"],
        provenance: "none",
        expectedProvenance: "static",
      }),
    ]);

    expect(report.accounting).toMatchObject({
      totalCases: 3,
      erroredCases: 1,
    });
    expect(report.metrics.epistemic).toMatchObject({
      cases: 1,
      correctUnknownCases: 1,
      falseSafeCases: 0,
      correctUnknownRate: 1,
      falseSafeRate: 0,
    });
    expect(report.metrics.targetResolution).toMatchObject({
      cases: 1,
      correctNotFoundCases: 1,
      correctNotFoundRate: 1,
    });
  });

  it("counts a verified-negative answer to an unknown case as false-safe", () => {
    const report = buildImpactHonestyReport([
      caseOf({
        scenario: "false-safe",
        intent: "epistemic-unknown",
        outcome: "verified-negative",
        confirmedFiles: [],
        expectedConfirmedFiles: [],
        provenance: "none",
        expectedProvenance: "unresolved",
      }),
    ]);

    expect(report.metrics.epistemic).toMatchObject({
      cases: 1,
      correctUnknownCases: 0,
      falseSafeCases: 1,
      correctUnknownRate: 0,
      falseSafeRate: 1,
    });
  });

  it("keeps errors in applicable denominators instead of improving the aggregate", () => {
    const perfect = caseOf({ scenario: "perfect" });
    const errored = caseOf({
      scenario: "errored",
      outcome: "error",
      confirmedFiles: [],
      expectedConfirmedFiles: ["src/b.ts"],
      provenance: "none",
      expectedProvenance: "static",
    });

    const clean = buildImpactHonestyReport([perfect]);
    const withError = buildImpactHonestyReport([perfect, errored]);

    expect(clean.metrics.positive.meanF1).toBe(1);
    expect(withError.accounting.erroredCases).toBe(1);
    expect(withError.metrics.positive.cases).toBe(2);
    expect(withError.metrics.positive.meanF1).toBe(0.5);
    expect(withError.metrics.provenance).toMatchObject({
      cases: 2,
      matchCases: 1,
      mismatchCases: 1,
      accuracy: 0.5,
    });
  });

  it("reports empty metric slices as n/a/null rather than fabricated perfection", () => {
    const report = buildImpactHonestyReport([]);

    expect(report.accounting).toEqual({ totalCases: 0, erroredCases: 0 });
    expect(report.metrics.positive.meanF1).toBeNull();
    expect(report.metrics.negative.specificity).toBeNull();
    expect(report.metrics.negative.falsePositiveRate).toBeNull();
    expect(report.metrics.candidate.meanCandidateRecall).toBeNull();
    expect(report.metrics.epistemic.falseSafeRate).toBeNull();
    expect(report.metrics.targetResolution.correctNotFoundRate).toBeNull();
    expect(report.metrics.provenance.accuracy).toBeNull();
  });

  it("counts provenance mismatch explicitly", () => {
    const report = buildImpactHonestyReport([
      caseOf({
        scenario: "provenance-mismatch",
        provenance: "dynamic-candidate",
        expectedProvenance: "static",
      }),
    ]);

    expect(report.metrics.provenance).toMatchObject({
      cases: 1,
      matchCases: 0,
      mismatchCases: 1,
      accuracy: 0,
    });
  });

  it("serializes semantically identical reports byte-for-byte deterministically", () => {
    const first = buildImpactHonestyReport([
      caseOf({
        scenario: "z-case",
        confirmedFiles: ["src/b.ts", "src/a.ts", "src/a.ts"],
        expectedConfirmedFiles: ["src/a.ts", "src/b.ts"],
      }),
      caseOf({
        scenario: "a-case",
        target: "other",
        confirmedFiles: ["src/c.ts"],
        expectedConfirmedFiles: ["src/c.ts"],
      }),
    ]);
    const second = buildImpactHonestyReport([
      caseOf({
        scenario: "a-case",
        target: "other",
        confirmedFiles: ["src/c.ts", "src/c.ts"],
        expectedConfirmedFiles: ["src/c.ts"],
      }),
      caseOf({
        scenario: "z-case",
        confirmedFiles: ["src/a.ts", "src/b.ts"],
        expectedConfirmedFiles: ["src/b.ts", "src/a.ts", "src/a.ts"],
      }),
    ]);

    expect(serializeImpactHonestyReport(first)).toBe(
      serializeImpactHonestyReport(second),
    );
    expect(first.cases.map((item) => item.scenario)).toEqual([
      "a-case",
      "z-case",
    ]);
    expect(first.cases[1]?.confirmedFiles).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});
