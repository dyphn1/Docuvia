import { applyBaseUrl, resolveUrl, setBaseUrl } from "./url-builder.js";
import { ApiError, ResponseParseError, parseErrorBody } from "./errors.js";
import { getMediaType, isJsonMediaType, isTextMediaType } from "./media-type.js";
import { hasNoBody, readNormalizedText, tryParseJson } from "./response-body.js";
import { buildBody } from "./content-type.js";
import {
  DEFAULT_JSON_ACCEPT,
  HEADER_NAMES,
  HTTP_METHODS,
  RESPONSE_TYPES,
  type ResolvedResponseType,
  type ResponseType,
} from "./constants.js";

export type CustomFetchOptions = RequestInit & {
  responseType?: ResponseType;
};

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

export type ErrorType<T = unknown> = ApiError<T>;

export { setBaseUrl };

let _authTokenGetter: AuthTokenGetter | null = null;

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(requestObj: Request | null, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (requestObj) return requestObj.method.toUpperCase();
  return HTTP_METHODS.GET;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    const sourceHeaders = source instanceof Headers ? source : new Headers(source);
    sourceHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string }
): Promise<unknown> {
  const { raw, normalized, trimmed } = await readNormalizedText(response);

  if (trimmed === "") {
    return null;
  }

  const parsed = tryParseJson(normalized);
  if (!parsed.ok) {
    throw new ResponseParseError(response, raw, parsed.error, requestInfo);
  }
  return parsed.value;
}

function inferResponseType(response: Response): ResolvedResponseType {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return RESPONSE_TYPES.JSON;
  if (isTextMediaType(mediaType) || mediaType == null) return RESPONSE_TYPES.TEXT;
  return RESPONSE_TYPES.BLOB;
}

async function parseSuccessBody(
  response: Response,
  responseType: ResponseType,
  requestInfo: { method: string; url: string }
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === RESPONSE_TYPES.AUTO ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case RESPONSE_TYPES.JSON:
      return parseJsonBody(response, requestInfo);

    case RESPONSE_TYPES.TEXT: {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case RESPONSE_TYPES.BLOB:
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            'Use responseType "json" or "text" instead.'
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {}
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = RESPONSE_TYPES.AUTO, headers: headersInit, ...init } = options;

  const requestObj = isRequest(input) ? input : null;
  const method = resolveMethod(requestObj, init.method);

  if (init.body != null && (method === HTTP_METHODS.GET || method === HTTP_METHODS.HEAD)) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(requestObj?.headers, headersInit);

  buildBody(init.body, headers);

  if (responseType === RESPONSE_TYPES.JSON && !headers.has(HEADER_NAMES.ACCEPT)) {
    headers.set(HEADER_NAMES.ACCEPT, DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has(HEADER_NAMES.AUTHORIZATION)) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set(HEADER_NAMES.AUTHORIZATION, `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const response = await fetch(input, { ...init, method, headers });

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}
