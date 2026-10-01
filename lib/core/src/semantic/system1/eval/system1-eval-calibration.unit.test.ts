import { describe, expect, it } from "vitest";
import {
  calibrateSystem1Score,
  clopperPearsonLowerBound,
  fitSystem1IsotonicCalibrator,
} from "./system1-eval-calibration.js";

describe("System-1 calibration and confidence bounds", () => {
  it("fits a deterministic monotone isotonic map with pooled adjacent violators", () => {
    const calibrator = fitSystem1IsotonicCalibrator([
      { score: 0.1, positive: false },
      { score: 0.2, positive: true },
      { score: 0.3, positive: false },
      { score: 0.8, positive: true },
    ]);

    expect(calibrator.method).toBe("isotonic-pava-v1");
    expect(calibrator.fitted).toBe(true);
    expect(calibrateSystem1Score(calibrator, 0.1)).toBe(0);
    expect(calibrateSystem1Score(calibrator, 0.2)).toBe(0.5);
    expect(calibrateSystem1Score(calibrator, 0.3)).toBe(0.5);
    expect(calibrateSystem1Score(calibrator, 0.8)).toBe(1);
  });

  it("uses the raw value when calibration has no positive and negative support", () => {
    const calibrator = fitSystem1IsotonicCalibrator([
      { score: 0.8, positive: true },
    ]);

    expect(calibrator.fitted).toBe(false);
    expect(calibrateSystem1Score(calibrator, 0.42)).toBe(0.42);
  });

  it("floors scores in gaps between isotonic blocks", () => {
    const calibrator = {
      method: "isotonic-pava-v1",
      fitted: true,
      observationCount: 10,
      positiveCount: 8,
      negativeCount: 2,
      blocks: [
        {
          minimumScore: 0.1,
          maximumScore: 0.15,
          positiveCount: 4,
          observationCount: 5,
          probability: 0.8,
        },
        {
          minimumScore: 0.2,
          maximumScore: 0.3,
          positiveCount: 5,
          observationCount: 5,
          probability: 0.95,
        },
      ],
    };

    expect(calibrateSystem1Score(calibrator, 0.1656)).toBe(0.8);
  });

  it("computes exact one-sided Clopper-Pearson lower bounds", () => {
    expect(clopperPearsonLowerBound(0, 5)).toBe(0);
    expect(clopperPearsonLowerBound(5, 5)).toBeCloseTo(0.5492802717, 8);
    expect(clopperPearsonLowerBound(1, 1)).toBeCloseTo(0.05, 8);
    expect(clopperPearsonLowerBound(1, 2)).toBeCloseTo(0.0253205655, 8);
    expect(() => clopperPearsonLowerBound(2, 1)).toThrow();
  });
});
