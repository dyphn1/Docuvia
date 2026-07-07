import { NormalizedRequest, NormalizedResponse, ProviderTransport } from "./types.js";

export const geminiTransport: ProviderTransport = {
  transformRequest: (req: NormalizedRequest) => {
    const systemMessage = req.messages.find((m) => m.role === "system")?.content;
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const result: any = { contents };
    if (systemMessage) {
      result.systemInstruction = {
        parts: [{ text: systemMessage }],
      };
    }

    if (req.temperature !== undefined || req.max_tokens !== undefined) {
      result.generationConfig = {
        temperature: req.temperature,
        maxOutputTokens: req.max_tokens,
      };
    }

    return result;
  },
  transformResponse: (res: any): NormalizedResponse => {
    const candidate = res.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text || "";

    return {
      content,
      usage: res.usageMetadata
        ? {
            prompt_tokens: res.usageMetadata.promptTokenCount || 0,
            completion_tokens: res.usageMetadata.candidatesTokenCount || 0,
            total_tokens: res.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  },
  transformStreamChunk: (chunk: any): string => {
    return chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
  },
};
