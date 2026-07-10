export const RESPONSE_TYPES = {
  JSON: "json",
  TEXT: "text",
  BLOB: "blob",
  AUTO: "auto",
} as const;

export type ResponseType = (typeof RESPONSE_TYPES)[keyof typeof RESPONSE_TYPES];
export type ResolvedResponseType = Exclude<ResponseType, typeof RESPONSE_TYPES.AUTO>;

export const HTTP_METHODS = {
  GET: "GET",
  HEAD: "HEAD",
} as const;

export const HEADER_NAMES = {
  ACCEPT: "accept",
  AUTHORIZATION: "authorization",
  CONTENT_TYPE: "content-type",
  CONTENT_LENGTH: "content-length",
} as const;

export const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";
