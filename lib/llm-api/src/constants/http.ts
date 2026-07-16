/** HTTP protocol vocabulary for the fetch-backed LLM client (method, headers, content types, SSE framing). */
export const LlmApiHttp = {
  METHOD_POST: "POST",
  HEADER_CONTENT_TYPE: "Content-Type",
  HEADER_AUTHORIZATION: "Authorization",
  CONTENT_TYPE_JSON: "application/json",
  CONTENT_TYPE_EVENT_STREAM: "text/event-stream",
  SSE_DATA_PREFIX: "data: ",
  SSE_DONE_SENTINEL: "[DONE]",
  bearerAuth: (apiKey: string) => `Bearer ${apiKey}`,
} as const;
