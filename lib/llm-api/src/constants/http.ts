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
  /** SSE event block separator (blank line, per the SSE wire format) used to split `generate`'s
   *  read buffer into individual blocks in `streamChatCompletion`. */
  SSE_BLOCK_SEPARATOR: "\n\n",
  bearerAuth: (apiKey: string) => `Bearer ${apiKey}`,
} as const;
