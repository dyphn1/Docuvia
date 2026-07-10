import { looksLikeJson } from "./response-body.js";
import { HEADER_NAMES } from "./constants.js";

/**
 * Sets a `content-type: application/json` header when the request body is a
 * JSON-looking string and no content-type was explicitly provided.
 * FormData/Blob bodies set their own content-type (with multipart boundary,
 * for FormData) automatically via fetch and are left untouched here.
 */
export function buildBody(initBody: unknown, headers: Headers): void {
  if (
    typeof initBody === "string" &&
    !headers.has(HEADER_NAMES.CONTENT_TYPE) &&
    looksLikeJson(initBody)
  ) {
    headers.set(HEADER_NAMES.CONTENT_TYPE, "application/json");
  }
}
