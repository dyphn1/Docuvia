import { describe, expect, it } from "vitest";
import {
  IMPACT_EVAL_REPORT_SCHEMA_VERSION,
  aggregateContractCases,
  assertImpactEvalHonestyGates,
  buildContractMarkdownSummary,
  scoreContractCase,
  type ImpactEvalContractCase,
} from "./impact-eval-scorer.js";

// TDD-SOURCE: issue #508 phase 0 measurement contract
// TDD-SOURCE: docs/gitbook/architecture/impact-evaluation-benchmark.md

const positiveCase: ImpactEvalContractCase = {
  scenario: "positive-control",
  target: "evalAdd",
  family: "positive",
  expectedDecision: "confirmed-positive",
  expectedFiles: ["src/calculator.ts"],
};

const negativeCase: ImpactEvalContractCase = {
  scenario: "verified-negative-control",
  target: "unusedHelper",
  family: "negative",
  expectedDecision: "verified-negative",
  expectedFiles: [],
};

describe("impact eval v2 contract scoring (#508 phase 0)", () => {
  it("preserves positive precision/recall/F1 semantics", () => {
    const result = scoreContractCase(positiveCase, {
      decision: "confirmed-positive",
      predictedFiles: ["src/calculator.ts"],
    });

    expect(result).toMatchObject({
      family: "positive",
      status: "ok",
      precision: 1,
      recall: 1,
      f1: 1,
      falseSafe: false,
    });
  });

  it("treats expected=[] / predicted=[] as a successful negative case instead of F1=0", () => {
    const result = scoreContractCase(negativeCase, {
      decision: "verified-negative",
      predictedFiles: [],
    });
    const aggregate = aggregateContractCases([result]);

    expect(result.precision).toBeNull();
    expect(result.recall).toBeNull();
    expect(result.f1).toBeNull();
    expect(result.negativeTrue).toBe(true);
    expect(result.falsePositiveNegative).toBe(false);
    expect(aggregate.negative).toEqual({
      cases: 1,
      trueNegativeCases: 1,
      falsePositiveCases: 0,
      specificity: 1,
      falsePositiveRate: 0,
    });
  });

  it("penalizes a negative false positive without redefining positive-set F1", () => {
    const result = scoreContractCase(negativeCase, {
      decision: "confirmed-positive",
      predictedFiles: ["src/unrelated.ts"],
    });
    const aggregate = aggregateContractCases([result]);

    expect(result.negativeTrue).toBe(false);
    expect(result.falsePositiveNegative).toBe(true);
    expect(aggregate.negative.specificity).toBe(0);
    expect(aggregate.negative.falsePositiveRate).toBe(1);
    expect(() => assertImpactEvalHonestyGates(aggregate)).toThrow(
      /negative specificity/,
    );
  });

  it("distinguishes unknown from verified zero-impact and rejects false-safe classification", () => {
    const epistemicCase: ImpactEvalContractCase = {
      scenario: "stale-graph",
      target: "changedSymbol",
      family: "epistemic",
      expectedDecision: "stale",
      expectedFiles: [],
    };

    const honest = scoreContractCase(epistemicCase, {
      decision: "stale",
      predictedFiles: [],
    });
    const falseSafe = scoreContractCase(epistemicCase, {
      decision: "verified-negative",
      predictedFiles: [],
    });

    expect(honest.correctAbstention).toBe(true);
    expect(honest.falseSafe).toBe(false);
    expect(falseSafe.correctAbstention).toBe(false);
    expect(falseSafe.falseSafe).toBe(true);

    const aggregate = aggregateContractCases([falseSafe]);
    expect(aggregate.honesty.falseSafeCases).toBe(1);
    expect(aggregate.honesty.falseSafeRate).toBe(1);
    expect(() => assertImpactEvalHonestyGates(aggregate)).toThrow(/false-safe/);
  });

  it("keeps ambiguity abstention distinct from silently binding the wrong target", () => {
    const ambiguousCase: ImpactEvalContractCase = {
      scenario: "duplicate-symbol-name",
      target: "render",
      family: "ambiguity",
      expectedDecision: "ambiguous",
      expectedFiles: [],
      expectedTargetIdentity: "src/a.ts#render",
    };

    const abstained = scoreContractCase(ambiguousCase, {
      decision: "ambiguous",
      predictedFiles: [],
      resolvedTargetIdentity: null,
    });
    const wrong = scoreContractCase(ambiguousCase, {
      decision: "confirmed-positive",
      predictedFiles: ["src/caller.ts"],
      resolvedTargetIdentity: "src/b.ts#render",
    });

    expect(abstained.wrongTarget).toBe(false);
    expect(wrong.wrongTarget).toBe(true);

    const aggregate = aggregateContractCases([wrong]);
    expect(aggregate.ambiguity.wrongTargetRate).toBe(1);
    expect(() => assertImpactEvalHonestyGates(aggregate)).toThrow(
      /wrong-target/,
    );
  });

  it("counts an errored positive in the positive denominator so the mean cannot improve by dropping it", () => {
    const perfect = scoreContractCase(positiveCase, {
      decision: "confirmed-positive",
      predictedFiles: ["src/calculator.ts"],
    });
    const errored = scoreContractCase(
      {
        ...positiveCase,
        scenario: "positive-error",
        target: "otherTarget",
      },
      {
        decision: "error",
        predictedFiles: [],
      },
    );

    const aggregate = aggregateContractCases([perfect, errored]);

    expect(aggregate.totalCases).toBe(2);
    expect(aggregate.casesErrored).toBe(1);
    expect(aggregate.positive.cases).toBe(2);
    expect(aggregate.positive.meanF1).toBe(0.5);
    expect(() => assertImpactEvalHonestyGates(aggregate)).toThrow(
      /case\(s\) errored/,
    );
  });

  it("renders zero-case slices as n/a and emits deterministic versioned output", () => {
    const result = scoreContractCase(positiveCase, {
      decision: "confirmed-positive",
      predictedFiles: ["src/calculator.ts"],
    });
    const aggregate = aggregateContractCases([result]);

    expect(aggregate.schemaVersion).toBe(IMPACT_EVAL_REPORT_SCHEMA_VERSION);
    expect(aggregate.negative.specificity).toBeNull();
    expect(aggregate.honesty.falseSafeRate).toBe(0);
    expect(aggregate.ambiguity.wrongTargetRate).toBeNull();

    const first = buildContractMarkdownSummary([result], aggregate);
    const second = buildContractMarkdownSummary([result], aggregate);
    expect(second).toBe(first);
    expect(first).toContain("schema v2");
    expect(first).toContain("Negative specificity: n/a");
    expect(first).toContain("Wrong-target rate: n/a");
  });

  it("sorts report rows deterministically instead of depending on execution order", () => {
    const a = scoreContractCase(
      { ...positiveCase, scenario: "a-case", target: "a" },
      { decision: "confirmed-positive", predictedFiles: ["src/calculator.ts"] },
    );
    const z = scoreContractCase(
      { ...positiveCase, scenario: "z-case", target: "z" },
      { decision: "confirmed-positive", predictedFiles: ["src/calculator.ts"] },
    );

    const forward = aggregateContractCases([a, z]);
    const reverse = aggregateContractCases([z, a]);

    expect(buildContractMarkdownSummary([a, z], forward)).toBe(
      buildContractMarkdownSummary([z, a], reverse),
    );
  });
});
