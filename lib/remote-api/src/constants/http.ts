/** HTTP protocol vocabulary for the fetch-backed remote sync client (method, headers, content types). */
export const RemoteApiHttp = {
  METHOD_POST: "POST",
  HEADER_AUTHORIZATION: "Authorization",
  HEADER_CONTENT_TYPE: "Content-Type",
  CONTENT_TYPE_JSON: "application/json",
  bearerAuth: (pat: string) => `Bearer ${pat}`,
} as const;
