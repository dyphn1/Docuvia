import { describe, expect, it } from "vitest";
import {
  IMPACT_HONESTY_SCHEMA_VERSION,
  aggregateImpactHonesty,
  buildImpactHonestyMarkdown,
  scoreImpactHonestyCase,
  type ImpactHonestyCaseInput,
} from "./impact-eval-honesty.js";

// TDD-SOURCE: issue #508 Phase 0 benchmark honesty contract
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md

function input(
  overrides: Partial<ImpactHonestyCaseInput> = {},
): ImpactHonestyCaseInput {
  return {
    schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
    scenario: "fixture",
    target: "evalTarget",
    intent: "confirmed-positive",
    expectedStatus: "resolved",
    expectedConfirmedFiles: ["src/dependent.ts"],
    expectedCandidateFiles: [],
    observedStatus: "resolved",
    predictions: [{ file: "src/dependent.ts", channel: "static" }],
    ...overrides,
  };
}

describe("impact benchmark honesty Phase 0 scorer", () => {
  it("[happy] preserves positive precision/recall/F1 semantics", () => {
    const result = scoreImpactHonestyCase(input());

    expect(result.schemaVersion).toBe(1);
    expect(result.positive).toEqual({
      tp: 1,
      fp: 0,
      fn: 0,
      precision: 1,
      recall: 1,
      f1: 1,
    });
    expect(result.confirmedPredictedFiles).toEqual(["src/dependent.ts"]);
    expect(result.candidatePredictedFiles).toEqual([]);
  });

  it("[negative] distinguishes true negative from false positive", () => {
    const good = scoreImpactHonestyCase(
      input({
        scenario: "negative-good",
        intent: "negative",
        expectedConfirmedFiles: [],
        predictions: [],
      }),
    );
    const bad = scoreImpactHonestyCase(
      input({
        scenario: "negative-bad",
        intent: "negative",
        expectedConfirmedFiles: [],
        predictions: [{ file: "src/unrelated.ts", channel: "static" }],
      }),
    );

    expect(good.negativeClassification).toBe("true-negative");
    expect(bad.negativeClassification).toBe("false-positive");

    const goodAggregate = aggregateImpactHonesty([good]);
    const badAggregate = aggregateImpactHonesty([bad]);

    expect(goodAggregate.negative).toMatchObject({
      cases: 1,
      resolvedCases: 1,
      trueNegativeCases: 1,
      falsePositiveCases: 0,
      specificity: 1,
      falsePositiveRate: 0,
    });
    expect(badAggregate.negative).toMatchObject({
      cases: 1,
      resolvedCases: 1,
      trueNegativeCases: 0,
      falsePositiveCases: 1,
      specificity: 0,
      falsePositiveRate: 1,
    });
  });

  it("[negative] detects wrong-target binding even when the dependency set looks like a true negative", () => {
    const result = scoreImpactHonestyCase(
      input({
        scenario: "same-name-wrong-target",
        intent: "negative",
        expectedConfirmedFiles: [],
        predictions: [],
        expectedTargetIdentity: "src/correct.ts#sameName",
        observedTargetIdentity: "src/wrong.ts#sameName",
      }),
    );

    expect(result.negativeClassification).toBe("true-negative");
    expect(result.targetResolution).toEqual({
      checked: true,
      correct: false,
      wrongTarget: true,
    });

    const aggregate = aggregateImpactHonesty([result]);
    expect(aggregate.targetResolution).toEqual({
      cases: 1,
      resolvedCases: 1,
      correctCases: 0,
      wrongTargetCases: 1,
      wrongTargetRate: 1,
    });
  });

  it("[boundary] keeps ambiguity/abstention distinct from wrong-target binding", () => {
    const result = scoreImpactHonestyCase(
      input({
        scenario: "same-name-ambiguous",
        intent: "negative",
        expectedStatus: "ambiguous",
        expectedConfirmedFiles: [],
        predictions: [],
        observedStatus: "ambiguous",
        expectedTargetIdentity: "src/correct.ts#sameName",
      }),
    );

    expect(result.targetResolution).toEqual({
      checked: false,
      correct: false,
      wrongTarget: false,
    });

    const aggregate = aggregateImpactHonesty([result]);
    expect(aggregate.statusCounts.ambiguous).toBe(1);
    expect(aggregate.targetResolution).toEqual({
      cases: 1,
      resolvedCases: 0,
      correctCases: 0,
      wrongTargetCases: 0,
      wrongTargetRate: null,
    });
  });

  it("[negative] does not promote dynamic candidates to confirmed TPs", () => {
    const result = scoreImpactHonestyCase(
      input({
        predictions: [
          {
            file: "src/dependent.ts",
            channel: "dynamic-candidate",
          },
        ],
      }),
    );

    expect(result.confirmedPredictedFiles).toEqual([]);
    expect(result.candidatePredictedFiles).toEqual(["src/dependent.ts"]);
    expect(result.positive).toMatchObject({
      tp: 0,
      fp: 0,
      fn: 1,
      recall: 0,
      f1: 0,
    });
  });

  it("[boundary] scores candidate coverage only from candidate evidence", () => {
    const result = scoreImpactHonestyCase(
      input({
        intent: "candidate-boundary",
        expectedConfirmedFiles: [],
        expectedCandidateFiles: ["src/a.ts", "src/b.ts"],
        predictions: [
          { file: "src/a.ts", channel: "dynamic-candidate" },
          { file: "src/b.ts", channel: "static" },
        ],
      }),
    );

    expect(result.candidate).toEqual({
      expected: 2,
      covered: 1,
      coverage: 0.5,
      predicted: 1,
    });
    expect(result.confirmedPredictedFiles).toEqual(["src/b.ts"]);
    expect(result.candidatePredictedFiles).toEqual(["src/a.ts"]);
  });

  it("[negative] measures provenance mismatches independently", () => {
    const matched = scoreImpactHonestyCase(
      input({
        expectedPredictions: [
          {
            file: "src/dependent.ts",
            channel: "dynamic-candidate",
          },
        ],
        predictions: [
          {
            file: "src/dependent.ts",
            channel: "dynamic-candidate",
          },
        ],
      }),
    );
    const mismatched = scoreImpactHonestyCase(
      input({
        expectedPredictions: [
          {
            file: "src/dependent.ts",
            channel: "dynamic-candidate",
          },
        ],
        predictions: [{ file: "src/dependent.ts", channel: "static" }],
      }),
    );

    expect(matched.provenance).toEqual({
      checked: 1,
      mismatches: 0,
      mismatchRate: 0,
    });
    expect(mismatched.provenance).toEqual({
      checked: 1,
      mismatches: 1,
      mismatchRate: 1,
    });
    expect(aggregateImpactHonesty([matched, mismatched]).provenance).toEqual({
      checked: 2,
      mismatches: 1,
      mismatchRate: 0.5,
    });
  });

  it("[error-handling] distinguishes UNKNOWN from false-safe empty", () => {
    const honest = scoreImpactHonestyCase(
      input({
        scenario: "honest-unknown",
        intent: "epistemic-unknown",
        expectedStatus: "unknown",
        expectedConfirmedFiles: [],
        predictions: [],
        observedStatus: "unknown",
      }),
    );
    const falseSafe = scoreImpactHonestyCase(
      input({
        scenario: "false-safe",
        intent: "epistemic-unknown",
        expectedStatus: "unknown",
        expectedConfirmedFiles: [],
        predictions: [],
        observedStatus: "resolved",
      }),
    );

    expect(honest.epistemic).toEqual({
      correctUnknown: true,
      falseSafe: false,
      wrongCertainty: false,
    });
    expect(falseSafe.epistemic).toEqual({
      correctUnknown: false,
      falseSafe: true,
      wrongCertainty: false,
    });
    expect(aggregateImpactHonesty([honest, falseSafe]).epistemic).toEqual({
      cases: 2,
      correctUnknownCases: 1,
      falseSafeCases: 1,
      wrongCertaintyCases: 0,
      correctUnknownRate: 0.5,
      falseSafeRate: 0.5,
    });
  });

  it("[negative] keeps not-found distinct from resolved empty", () => {
    const correct = scoreImpactHonestyCase(
      input({
        scenario: "not-found-correct",
        intent: "not-found",
        expectedStatus: "not-found",
        expectedConfirmedFiles: [],
        predictions: [],
        observedStatus: "not-found",
      }),
    );
    const wrong = scoreImpactHonestyCase(
      input({
        scenario: "not-found-wrong-empty",
        intent: "not-found",
        expectedStatus: "not-found",
        expectedConfirmedFiles: [],
        predictions: [],
        observedStatus: "resolved",
      }),
    );

    const aggregate = aggregateImpactHonesty([correct, wrong]);

    expect(correct.statusCorrect).toBe(true);
    expect(wrong.statusCorrect).toBe(false);
    expect(aggregate.notFound).toEqual({
      cases: 2,
      correctCases: 1,
      accuracy: 0.5,
    });
  });

  it("[error-handling] keeps execution errors visible", () => {
    const errored = scoreImpactHonestyCase(
      input({
        observedStatus: "error",
        predictions: [],
      }),
    );
    const aggregate = aggregateImpactHonesty([errored]);

    expect(aggregate.totalCases).toBe(1);
    expect(aggregate.errorCases).toBe(1);
    expect(aggregate.statusCounts.error).toBe(1);
    expect(aggregate.positive.cases).toBe(1);
    expect(aggregate.positive.scoredCases).toBe(0);
    expect(aggregate.positive.erroredCases).toBe(1);
    expect(aggregate.positive.meanF1).toBeNull();
  });

  it("[invalid-input] rejects unsupported report schema versions", () => {
    expect(() =>
      scoreImpactHonestyCase({
        ...input(),
        schemaVersion: 2 as typeof IMPACT_HONESTY_SCHEMA_VERSION,
      }),
    ).toThrow(/unsupported impact honesty schema version/);
  });

  it("[boundary] uses null/n-a for empty metric slices", () => {
    const aggregate = aggregateImpactHonesty([]);
    const markdown = buildImpactHonestyMarkdown(aggregate);

    expect(aggregate.positive.meanF1).toBeNull();
    expect(aggregate.negative.specificity).toBeNull();
    expect(aggregate.negative.falsePositiveRate).toBeNull();
    expect(aggregate.candidate.coverage).toBeNull();
    expect(aggregate.provenance.mismatchRate).toBeNull();
    expect(aggregate.epistemic.correctUnknownRate).toBeNull();
    expect(aggregate.epistemic.falseSafeRate).toBeNull();
    expect(aggregate.notFound.accuracy).toBeNull();
    expect(aggregate.targetResolution.wrongTargetRate).toBeNull();
    expect(markdown).toContain("n/a");
    expect(markdown).not.toContain("NaN");
  });

  it("[determinism] normalizes predictions and renders stable reports", () => {
    const value = input({
      predictions: [
        { file: "src/z.ts", channel: "lsp-fallback" },
        { file: "src/a.ts", channel: "static" },
        { file: "src/z.ts", channel: "lsp-fallback" },
        {
          file: "src/candidate.ts",
          channel: "dynamic-candidate",
        },
        {
          file: "src/candidate.ts",
          channel: "dynamic-candidate",
        },
      ],
      expectedConfirmedFiles: ["src/z.ts", "src/a.ts", "src/a.ts"],
    });

    const first = scoreImpactHonestyCase(value);
    const second = scoreImpactHonestyCase({
      ...value,
      predictions: [...value.predictions].reverse(),
      expectedConfirmedFiles: [...value.expectedConfirmedFiles].reverse(),
    });

    expect(first).toEqual(second);
    expect(first.confirmedPredictedFiles).toEqual(["src/a.ts", "src/z.ts"]);
    expect(first.candidatePredictedFiles).toEqual(["src/candidate.ts"]);

    const a = buildImpactHonestyMarkdown(aggregateImpactHonesty([first]));
    const b = buildImpactHonestyMarkdown(aggregateImpactHonesty([second]));
    expect(a).toBe(b);
  });

  it("[negative-control] bad evidence degrades the negative metric", () => {
    const good = aggregateImpactHonesty([
      scoreImpactHonestyCase(
        input({
          intent: "negative",
          expectedConfirmedFiles: [],
          predictions: [],
        }),
      ),
    ]);
    const poisoned = aggregateImpactHonesty([
      scoreImpactHonestyCase(
        input({
          intent: "negative",
          expectedConfirmedFiles: [],
          predictions: [
            {
              file: "src/poison.ts",
              channel: "lsp-fallback",
            },
          ],
        }),
      ),
    ]);

    expect(good.negative.specificity).toBe(1);
    expect(poisoned.negative.specificity).toBe(0);
    expect(poisoned.negative.falsePositiveRate).toBeGreaterThan(
      good.negative.falsePositiveRate ?? -1,
    );
  });
});
