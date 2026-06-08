import { describe, it, expect } from "vitest";
import { escapeLike, calculateTemporalDecay, sanitizeQuery } from "./intent-router.js";

describe("intent-router.ts", () => {
  describe("escapeLike", () => {
    it("escapes % and _ characters", () => {
      expect(escapeLike("%test_")).toBe("\\%test\\_");
    });

    it("escapes \\ characters", () => {
      expect(escapeLike("test\\")).toBe("test\\\\");
    });

    it("returns normal strings unchanged", () => {
      expect(escapeLike("normalString")).toBe("normalString");
    });
  });

  describe("calculateTemporalDecay", () => {
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    it("returns 1.0 for a date exactly now", () => {
      const now = Date.now();
      expect(calculateTemporalDecay(new Date(now), now)).toBeCloseTo(1.0);
    });

    it("returns 0.5 for a date exactly 30 days ago (half-life)", () => {
      const now = Date.now();
      const thirtyDaysAgo = new Date(now - 30 * MS_PER_DAY);
      expect(calculateTemporalDecay(thirtyDaysAgo, now)).toBeCloseTo(0.5);
    });

    it("returns 0.25 for a date exactly 60 days ago", () => {
      const now = Date.now();
      const sixtyDaysAgo = new Date(now - 60 * MS_PER_DAY);
      expect(calculateTemporalDecay(sixtyDaysAgo, now)).toBeCloseTo(0.25);
    });

    it("does not increase score for future dates", () => {
      const now = Date.now();
      const futureDate = new Date(now + 10 * MS_PER_DAY);
      expect(calculateTemporalDecay(futureDate, now)).toBeCloseTo(1.0);
    });
  });

  describe("sanitizeQuery", () => {
    it("removes control characters", () => {
      // \x00 is a control char, \n is also handled or preserved depending on the regex
      // sanitizeQuery strips \x00-\x1F\x7F
      const input = "test\x00query\x1F";
      expect(sanitizeQuery(input)).toBe("test query");
    });

    it("trims the output", () => {
      expect(sanitizeQuery("  hello world  ")).toBe("hello world");
    });

    it("truncates to 2000 characters", () => {
      const longQuery = "a".repeat(2500);
      expect(sanitizeQuery(longQuery).length).toBe(2000);
    });
  });
});
