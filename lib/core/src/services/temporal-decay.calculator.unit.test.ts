import { describe, it, expect, vi } from "vitest";
import { calculateTemporalDecay } from "./temporal-decay.calculator.js";

describe("calculateTemporalDecay", () => {
  it("should return 1 for a date right now", () => {
    // Arrange
    const now = new Date();

    // Act
    const result = calculateTemporalDecay(now);

    // Assert
    expect(result).toBeCloseTo(1.0, 2);
  });

  it("should clamp negative drift to 0 days", () => {
    // Arrange
    const future = new Date(Date.now() + 86400000);

    // Act
    const result = calculateTemporalDecay(future);

    // Assert
    expect(result).toBeCloseTo(1.0, 2);
  });

  it("should decay to approx 0.5 after 14 days", () => {
    // Arrange
    const past = new Date(Date.now() - 14 * 86400000);

    // Act
    const result = calculateTemporalDecay(past, 0.05);

    // Assert
    expect(result).toBeCloseTo(0.496, 2);
  });
});
