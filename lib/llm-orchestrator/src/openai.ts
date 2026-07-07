import { NormalizedRequest, NormalizedResponse, ProviderTransport } from "./types.js";

export const openaiTransport: ProviderTransport = {
  transformRequest: (req: NormalizedRequest) => {
    return {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
      max_tokens: req.max_tokens,
      stream: req.stream,
      response_format: req.response_format,
    };
  },
  transformResponse: (res: any): NormalizedResponse => {
    return {
      content: res.choices?.[0]?.message?.content || "",
      usage: res.usage,
    };
  },
  transformStreamChunk: (chunk: any): string => {
    return chunk.choices?.[0]?.delta?.content || "";
  },
};
