import { NormalizedRequest, NormalizedResponse, ProviderTransport } from "./types.js";

export const anthropicTransport: ProviderTransport = {
  transformRequest: (req: NormalizedRequest) => {
    const systemMessage = req.messages.find((m) => m.role === "system")?.content;
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    return {
      model: req.model,
      messages,
      system: systemMessage,
      temperature: req.temperature,
      max_tokens: req.max_tokens || 1024,
      stream: req.stream,
    };
  },
  transformResponse: (res: any): NormalizedResponse => {
    return {
      content: res.content?.[0]?.text || "",
      usage: {
        prompt_tokens: res.usage?.input_tokens || 0,
        completion_tokens: res.usage?.output_tokens || 0,
        total_tokens: (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0),
      },
    };
  },
  transformStreamChunk: (chunk: any): string => {
    if (chunk.type === "content_block_delta" && chunk.delta?.text) {
      return chunk.delta.text;
    }
    return "";
  },
};
