import { describe, it, expect } from "vitest";
import { calculateTemporalDecay } from "./decay.js";

describe("calculateTemporalDecay", () => {
  it("should return 1 for a date right now", () => {
    expect(calculateTemporalDecay(new Date())).toBeCloseTo(1.0, 2);
  });

  it("should clamp negative drift to 0 days", () => {
    const future = new Date(Date.now() + 86400000);
    expect(calculateTemporalDecay(future)).toBeCloseTo(1.0, 2);
  });

  it("should decay to approx 0.5 after 14 days", () => {
    const past = new Date(Date.now() - 14 * 86400000);
    expect(calculateTemporalDecay(past, 0.05)).toBeCloseTo(0.496, 2);
  });
});
