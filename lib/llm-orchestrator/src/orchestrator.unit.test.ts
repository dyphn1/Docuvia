import { describe, it, expect } from "vitest";
import { openaiTransport } from "@workspace/llm-orchestrator";
import { anthropicTransport } from "@workspace/llm-orchestrator";
import { geminiTransport } from "@workspace/llm-orchestrator";
import { NormalizedRequest } from "@workspace/llm-orchestrator";

describe("LLM Transports", () => {
  const mockReq: NormalizedRequest = {
    model: "test-model",
    messages: [
      { role: "system", content: "system message" },
      { role: "user", content: "user message" },
    ],
    temperature: 0.7,
    max_tokens: 100,
  };

  describe("OpenAI", () => {
    it("transforms request correctly", () => {
      const result = openaiTransport.transformRequest(mockReq);
      expect(result.model).toBe("test-model");
      expect(result.messages.length).toBe(2);
      expect(result.temperature).toBe(0.7);
    });

    it("transforms response correctly", () => {
      const response = {
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      const result = openaiTransport.transformResponse(response);
      expect(result.content).toBe("hello");
      expect(result.usage?.total_tokens).toBe(15);
    });
  });

  describe("Anthropic", () => {
    it("transforms request correctly", () => {
      const result = anthropicTransport.transformRequest(mockReq);
      expect(result.model).toBe("test-model");
      expect(result.system).toBe("system message");
      expect(result.messages.length).toBe(1); // system removed
      expect(result.messages[0].role).toBe("user");
    });

    it("transforms response correctly", () => {
      const response = {
        content: [{ text: "hello" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = anthropicTransport.transformResponse(response);
      expect(result.content).toBe("hello");
      expect(result.usage?.total_tokens).toBe(15);
    });
  });

  describe("Gemini", () => {
    it("transforms request correctly", () => {
      const result = geminiTransport.transformRequest(mockReq);
      expect(result.systemInstruction.parts[0].text).toBe("system message");
      expect(result.contents.length).toBe(1);
      expect(result.contents[0].role).toBe("user");
      expect(result.contents[0].parts[0].text).toBe("user message");
    });

    it("transforms response correctly", () => {
      const response = {
        candidates: [{ content: { parts: [{ text: "hello" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      };
      const result = geminiTransport.transformResponse(response);
      expect(result.content).toBe("hello");
      expect(result.usage?.total_tokens).toBe(15);
    });
  });
});
