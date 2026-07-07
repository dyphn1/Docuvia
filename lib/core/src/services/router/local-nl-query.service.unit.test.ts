import { describe, it, expect, vi } from "vitest";
import {
  LocalIntentExtractionService,
  extractKeywordsHeuristically,
} from "./local-nl-query.service.js";

/** Builds a mocked LLM client factory (the boundary we mock, like other unit tests). */
const makeLlmFactory = (options: { content?: string | null; reject?: boolean }) => {
  const create = options.reject
    ? vi.fn().mockRejectedValue(new Error("LLM unreachable"))
    : vi.fn().mockResolvedValue({
        choices: [{ message: { content: options.content ?? null } }],
      });

  const factory = vi.fn().mockResolvedValue({
    client: { chat: { completions: { create } } },
    model: "test-model",
  });

  return { factory: factory as any, create };
};

describe("local-nl-query.service.ts", () => {
  describe("LocalIntentExtractionService.extractIntent", () => {
    it("parses a valid LLM JSON response into keywords and nodeRefs", async () => {
      // Arrange
      const { factory, create } = makeLlmFactory({
        content: JSON.stringify({
          keywords: ["authentication", "token"],
          nodeRefs: ["AuthService"],
        }),
      });
      const service = new LocalIntentExtractionService(factory);

      // Act
      const intent = await service.extractIntent("How does AuthService validate tokens?");

      // Assert
      expect(intent).toEqual({
        keywords: ["authentication", "token"],
        nodeRefs: ["AuthService"],
      });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("falls back to heuristic keywords when the LLM call fails", async () => {
      // Arrange
      const { factory } = makeLlmFactory({ reject: true });
      const service = new LocalIntentExtractionService(factory);

      // Act
      const intent = await service.extractIntent("How does the authentication module work?");

      // Assert
      expect(intent.nodeRefs).toEqual([]);
      expect(intent.keywords).toEqual(["authentication", "module", "work"]);
    });

    it("falls back to heuristic keywords when the LLM returns invalid JSON", async () => {
      // Arrange
      const { factory } = makeLlmFactory({ content: "not-json {" });
      const service = new LocalIntentExtractionService(factory);

      // Act
      const intent = await service.extractIntent("find intent router service");

      // Assert
      expect(intent.nodeRefs).toEqual([]);
      expect(intent.keywords).toEqual(["find", "intent", "router", "service"]);
    });

    it("falls back when the LLM returns empty keyword and nodeRef arrays", async () => {
      // Arrange
      const { factory } = makeLlmFactory({
        content: JSON.stringify({ keywords: [], nodeRefs: [] }),
      });
      const service = new LocalIntentExtractionService(factory);

      // Act
      const intent = await service.extractIntent("payment pipeline");

      // Assert
      expect(intent.keywords).toEqual(["payment", "pipeline"]);
    });

    it("drops non-string entries from LLM arrays", async () => {
      // Arrange
      const { factory } = makeLlmFactory({
        content: JSON.stringify({
          keywords: ["auth", 42, null, "  "],
          nodeRefs: [{}, "AuthService"],
        }),
      });
      const service = new LocalIntentExtractionService(factory);

      // Act
      const intent = await service.extractIntent("auth");

      // Assert
      expect(intent).toEqual({ keywords: ["auth"], nodeRefs: ["AuthService"] });
    });
  });

  describe("extractKeywordsHeuristically", () => {
    it("removes stop words and single-character tokens", () => {
      // Arrange
      const query = "How is the A auth flow in this repo?";

      // Act
      const keywords = extractKeywordsHeuristically(query);

      // Assert
      expect(keywords).toEqual(["auth", "flow", "repo"]);
    });

    it("keeps path-like tokens intact and dedupes", () => {
      // Arrange
      const query = "search src/services/auth.ts and src/services/auth.ts";

      // Act
      const keywords = extractKeywordsHeuristically(query);

      // Assert
      expect(keywords).toEqual(["search", "src/services/auth.ts"]);
    });
  });
});
