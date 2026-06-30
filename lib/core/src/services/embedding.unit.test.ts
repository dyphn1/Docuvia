import { describe, it, expect } from "vitest";
import { cosineSimilarity, parseEmbedding } from "./embedding.js";

describe("embedding.ts", () => {
  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      // Arrange
      const a = [1, 2, 3];
      const b = [1, 2, 3];

      // Act
      const result = cosineSimilarity(a, b);

      // Assert
      expect(result).toBeCloseTo(1.0);
    });

    it("returns 0 for orthogonal vectors", () => {
      // Arrange
      const a = [1, 0];
      const b = [0, 1];

      // Act
      const result = cosineSimilarity(a, b);

      // Assert
      expect(result).toBeCloseTo(0.0);
    });

    it("returns -1 for opposite vectors", () => {
      // Arrange
      const a = [1, 2, 3];
      const b = [-1, -2, -3];

      // Act
      const result = cosineSimilarity(a, b);

      // Assert
      expect(result).toBeCloseTo(-1.0);
    });

    it("returns 0 for empty vectors", () => {
      // Arrange
      const a: number[] = [];
      const b: number[] = [];

      // Act
      const result = cosineSimilarity(a, b);

      // Assert
      expect(result).toBe(0);
    });

    it("returns 0 for vectors of different lengths", () => {
      // Arrange
      const a = [1, 2];
      const b = [1, 2, 3];

      // Act
      const result = cosineSimilarity(a, b);

      // Assert
      expect(result).toBe(0);
    });

    it("returns 0 if either vector has zero magnitude", () => {
      // Arrange
      const a = [0, 0];
      const b = [1, 1];

      // Act
      const result = cosineSimilarity(a, b);

      // Assert
      expect(result).toBe(0);
    });
  });

  describe("parseEmbedding", () => {
    it("parses valid JSON array of numbers", () => {
      // Arrange
      const raw = "[0.1, 0.2, 0.3]";

      // Act
      const result = parseEmbedding(raw);

      // Assert
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("returns null for invalid JSON", () => {
      // Arrange
      const raw = "[0.1, 0.2, ";

      // Act
      const result = parseEmbedding(raw);

      // Assert
      expect(result).toBeNull();
    });

    it("returns null for empty string or nullish values", () => {
      // Arrange
      const rawEmpty = "";
      const rawNull = null;
      const rawUndef = undefined;

      // Act
      const resEmpty = parseEmbedding(rawEmpty);
      const resNull = parseEmbedding(rawNull);
      const resUndef = parseEmbedding(rawUndef);

      // Assert
      expect(resEmpty).toBeNull();
      expect(resNull).toBeNull();
      expect(resUndef).toBeNull();
    });

    it("returns null for JSON that is not an array", () => {
      // Arrange
      const raw = '{"a": 1}';

      // Act
      const result = parseEmbedding(raw);

      // Assert
      expect(result).toBeNull();
    });

    it("returns null for empty arrays", () => {
      // Arrange
      const raw = "[]";

      // Act
      const result = parseEmbedding(raw);

      // Assert
      expect(result).toBeNull();
    });
  });
});
