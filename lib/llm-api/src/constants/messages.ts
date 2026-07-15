/** Error messages thrown by the fetch-backed LLM client, wrapped as `DocuviaError`. */
export const LlmApiMessages = {
  CLIENT_USED_BEFORE_INITIALIZE:
    "FetchLlmClient used before initialize() was called",
  CHAT_COMPLETION_FAILED: "Chat completion failed",
  chatCompletionFailedWithReason: (message: string) =>
    `Chat completion failed: ${message}`,
  CHAT_COMPLETION_INVALID_JSON:
    "Chat completion failed: response body was not valid JSON",
  CHAT_COMPLETION_STREAM_FAILED: "Chat completion stream failed",
  chatCompletionStreamFailedWithReason: (message: string) =>
    `Chat completion stream failed: ${message}`,
  CHAT_COMPLETION_STREAM_INVALID_JSON:
    "Chat completion stream failed: chunk was not valid JSON",
} as const;
