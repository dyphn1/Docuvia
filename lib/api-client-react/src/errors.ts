import { getMediaType, isJsonMediaType, isTextMediaType } from "./media-type.js";
import { hasNoBody, looksLikeJson, readNormalizedText, tryParseJson } from "./response-body.js";

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  const text = title && detail ? `${title} — ${detail}` : (detail ?? message ?? title);
  return text ? `${prefix}: ${text}` : prefix;
}

abstract class HttpResponseError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(message: string, response: Response, requestInfo: { method: string; url: string }) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ApiError<T = unknown> extends HttpResponseError {
  readonly name = "ApiError";
  readonly data: T | null;

  constructor(response: Response, data: T | null, requestInfo: { method: string; url: string }) {
    super(buildErrorMessage(response, data), response, requestInfo);
    this.data = data;
  }
}

export class ResponseParseError extends HttpResponseError {
  readonly name = "ResponseParseError";
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string }
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
      response,
      requestInfo
    );
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

export async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const { raw, normalized, trimmed } = await readNormalizedText(response);

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(trimmed)) {
    const parsed = tryParseJson(normalized);
    return parsed.ok ? parsed.value : raw;
  }

  return raw;
}
