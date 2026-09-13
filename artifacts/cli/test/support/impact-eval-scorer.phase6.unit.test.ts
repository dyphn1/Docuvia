import { describe, expect, it } from "vitest";
import {
  IMPACT_EVAL_MIN_MEAN_F1,
  aggregateCases,
  assertImpactEvalRegressionFloor,
  errorCase,
  scoreCase,
} from "./impact-eval-scorer.js";

// TDD-SOURCE: issue #192 impact accuracy acceptance criteria

describe("Phase 6 impact accuracy regression gate", () => {
  it("fails the regression gate when mean F1 drops below the locked baseline", () => {
    const aggregate = aggregateCases([
      scoreCase("regression", "target", [], ["src/dependent.ts"]),
    ]);

    expect(() =>
      assertImpactEvalRegressionFloor(aggregate, IMPACT_EVAL_MIN_MEAN_F1),
    ).toThrow(/mean F1 .* below/);
  });

  it("fails closed when any benchmark case errors", () => {
    const aggregate = aggregateCases([
      scoreCase("control", "target", ["src/a.ts"], ["src/a.ts"]),
      errorCase("errored", "other", ["src/b.ts"]),
    ]);

    expect(() => assertImpactEvalRegressionFloor(aggregate)).toThrow(
      /case\(s\) errored/,
    );
  });

  it("accepts an aggregate at the exact locked floor", () => {
    expect(() =>
      assertImpactEvalRegressionFloor(
        {
          casesScored: 1,
          casesErrored: 0,
          meanPrecision: IMPACT_EVAL_MIN_MEAN_F1,
          meanRecall: IMPACT_EVAL_MIN_MEAN_F1,
          meanF1: IMPACT_EVAL_MIN_MEAN_F1,
        },
        IMPACT_EVAL_MIN_MEAN_F1,
      ),
    ).not.toThrow();
  });

  it("keeps an unresolved target visible as an empty prediction rather than dropping the case", () => {
    const result = scoreCase(
      "unresolved-target",
      "missingSymbol",
      [],
      ["src/dependent.ts"],
    );

    expect(result.status).toBe("ok");
    expect(result.predictedFiles).toEqual([]);
    expect(result.fn).toBe(1);
    expect(result.recall).toBe(0);
    expect(result.f1).toBe(0);
  });
});
