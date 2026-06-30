import { describe, it, expect } from "vitest";
import { sanitizeQuery } from "./intent-router.js";
import { sanitizeLikeInput as escapeLike } from "./sql-utils.js";

describe("intent-router.ts", () => {
  describe("escapeLike", () => {
    it("escapes % and _ characters", () => {
      // Arrange
      const input = "%test_";

      // Act
      const result = escapeLike(input);

      // Assert
      expect(result).toBe("\\\\%test\\\\_");
    });

    it("escapes \\ characters", () => {
      // Arrange
      const input = "test\\";

      // Act
      const result = escapeLike(input);

      // Assert
      expect(result).toBe("test\\\\\\");
    });

    it("returns normal strings unchanged", () => {
      // Arrange
      const input = "normalString";

      // Act
      const result = escapeLike(input);

      // Assert
      expect(result).toBe("normalString");
    });
  });

  describe("sanitizeQuery", () => {
    it("removes control characters", () => {
      // Arrange
      const input = "test\x00query\x1F";

      // Act
      const result = sanitizeQuery(input);

      // Assert
      expect(result).toBe("test query");
    });

    it("trims the output", () => {
      // Arrange
      const input = "  hello world  ";

      // Act
      const result = sanitizeQuery(input);

      // Assert
      expect(result).toBe("hello world");
    });

    it("truncates to 2000 characters", () => {
      // Arrange
      const longQuery = "a".repeat(2500);

      // Act
      const result = sanitizeQuery(longQuery);

      // Assert
      expect(result.length).toBe(2000);
    });
  });
});
