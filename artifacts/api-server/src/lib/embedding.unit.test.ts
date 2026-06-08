import { describe, it, expect } from "vitest";
import { cosineSimilarity, parseEmbedding } from "./embedding.js";

describe("embedding.ts", () => {
  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const a = [1, 2, 3];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
    });

    it("returns 0 for orthogonal vectors", () => {
      const a = [1, 0];
      const b = [0, 1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it("returns -1 for opposite vectors", () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });

    it("returns 0 for empty vectors", () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });

    it("returns 0 for vectors of different lengths", () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it("returns 0 if either vector has zero magnitude", () => {
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });
  });

  describe("parseEmbedding", () => {
    it("parses valid JSON array of numbers", () => {
      const raw = "[0.1, 0.2, 0.3]";
      expect(parseEmbedding(raw)).toEqual([0.1, 0.2, 0.3]);
    });

    it("returns null for invalid JSON", () => {
      const raw = "[0.1, 0.2, ";
      expect(parseEmbedding(raw)).toBeNull();
    });

    it("returns null for empty string or nullish values", () => {
      expect(parseEmbedding("")).toBeNull();
      expect(parseEmbedding(null)).toBeNull();
      expect(parseEmbedding(undefined)).toBeNull();
    });

    it("returns null for JSON that is not an array", () => {
      expect(parseEmbedding('{"a": 1}')).toBeNull();
    });

    it("returns null for empty arrays", () => {
      expect(parseEmbedding("[]")).toBeNull();
    });
  });
});
