import { describe, expect, it } from "vitest";
import {
  evaluateTddQuality,
  type TddQualityEvidence,
} from "./tdd-quality-score.js";

function completeEvidence(): TddQualityEvidence {
  return {
    dimensions: {
      positiveParameters: { passed: 2, required: 2 },
      negativeParameters: { passed: 2, required: 2 },
      inputCompleteness: { passed: 3, required: 3 },
      outputCompleteness: { passed: 4, required: 4 },
      errorHandling: { passed: 3, required: 3 },
      unexpectedInput: { passed: 2, required: 2 },
      determinism: { passed: 1, required: 1 },
      sourceTraceability: { passed: 1, required: 1 },
    },
    sourceConformance: "PASS",
    skippedTests: 0,
  };
}

describe("quantitative TDD quality scoring", () => {
  it("returns PASS only when every required check and mandatory gate passes", () => {
    const result = evaluateTddQuality(completeEvidence());

    expect(result.score).toBe(100);
    expect(result.result).toBe("PASS");
    expect(result.gates).toEqual({
      allApplicableDimensionsHaveEvidence: true,
      allRequiredChecksPass: true,
      sourceConformancePasses: true,
      noSkippedTestsCountedAsPassed: true,
    });
  });

  it("negative control: a missing determinism check lowers the score and forces FAIL", () => {
    const evidence = completeEvidence();
    evidence.dimensions.determinism = { passed: 0, required: 1 };

    const result = evaluateTddQuality(evidence);

    expect(result.score).toBe(90);
    expect(result.result).toBe("FAIL");
    expect(result.gates.allRequiredChecksPass).toBe(false);
  });

  it("negative control: a source conflict fails even when the numeric score is 100", () => {
    const evidence = completeEvidence();
    evidence.sourceConformance = "SOURCE_CONFLICT";

    const result = evaluateTddQuality(evidence);

    expect(result.score).toBe(100);
    expect(result.result).toBe("FAIL");
    expect(result.gates.sourceConformancePasses).toBe(false);
  });

  it("negative control: silently omitting a dimension is rejected instead of being treated as N/A", () => {
    const evidence = completeEvidence();
    evidence.dimensions.unexpectedInput = { passed: 0, required: 0 };

    expect(() => evaluateTddQuality(evidence)).toThrow(
      "provide an explicit N/A reason",
    );
  });

  it("negative control: a missing dimension produces an explicit validation error", () => {
    const evidence = completeEvidence();
    delete (evidence.dimensions as Partial<TddQualityEvidence["dimensions"]>)
      .determinism;

    expect(() => evaluateTddQuality(evidence)).toThrow(
      "determinism evidence is missing",
    );
  });

  it("negative control: an unknown dimension is rejected instead of silently ignored", () => {
    const evidence = completeEvidence();
    Object.assign(evidence.dimensions, {
      determinismTypo: { passed: 1, required: 1 },
    });

    expect(() => evaluateTddQuality(evidence)).toThrow(
      "unknown TDD quality dimension: determinismTypo",
    );
  });

  it("allows a genuine N/A only when the reason is explicit and re-normalizes applicable weights", () => {
    const evidence = completeEvidence();
    evidence.dimensions.unexpectedInput = {
      passed: 0,
      required: 0,
      naReason:
        "The measured pure function accepts no external or malformed input surface.",
    };

    const result = evaluateTddQuality(evidence);

    expect(result.score).toBe(100);
    expect(result.result).toBe("PASS");
    expect(result.dimensions.unexpectedInput).toMatchObject({
      applicable: false,
      percentage: null,
    });
  });

  it("accepts a mathematically complete score despite harmless floating-point rounding", () => {
    const evidence = completeEvidence();
    const naReason =
      "Not applicable to this deliberately narrow test contract.";

    evidence.dimensions.positiveParameters = {
      passed: 0,
      required: 0,
      naReason,
    };
    evidence.dimensions.negativeParameters = {
      passed: 0,
      required: 0,
      naReason,
    };
    evidence.dimensions.inputCompleteness = {
      passed: 0,
      required: 0,
      naReason,
    };
    evidence.dimensions.outputCompleteness = {
      passed: 0,
      required: 0,
      naReason,
    };
    evidence.dimensions.errorHandling = { passed: 0, required: 0, naReason };
    evidence.dimensions.determinism = { passed: 0, required: 0, naReason };

    const result = evaluateTddQuality(evidence);

    expect(result.score).toBeCloseTo(100, 12);
    expect(result.result).toBe("PASS");
  });

  it("does not count a perfect numeric score as PASS when skipped tests exist", () => {
    const evidence = completeEvidence();
    evidence.skippedTests = 1;

    const result = evaluateTddQuality(evidence);

    expect(result.score).toBe(100);
    expect(result.result).toBe("FAIL");
    expect(result.gates.noSkippedTestsCountedAsPassed).toBe(false);
  });
});
