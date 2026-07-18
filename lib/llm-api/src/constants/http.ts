/** HTTP protocol vocabulary for the fetch-backed LLM client (method, headers, content types, SSE framing). */
export const LlmApiHttp = {
  METHOD_POST: "POST",
  /** `checkAvailability()`'s reachability probe (decision 1e) -- a lightweight `GET`, not the
   *  full `chatCompletion` contract. */
  METHOD_GET: "GET",
  HEADER_CONTENT_TYPE: "Content-Type",
  HEADER_AUTHORIZATION: "Authorization",
  CONTENT_TYPE_JSON: "application/json",
  CONTENT_TYPE_EVENT_STREAM: "text/event-stream",
  SSE_DATA_PREFIX: "data: ",
  SSE_DONE_SENTINEL: "[DONE]",
  bearerAuth: (apiKey: string) => `Bearer ${apiKey}`,
} as const;
