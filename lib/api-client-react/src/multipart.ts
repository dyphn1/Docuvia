import { looksLikeJson } from "./errors.js";

/**
 * Builds the body and sets appropriate headers (e.g. content-type).
 * Can be expanded to handle multipart boundary generation and injection.
 */
export function buildBody(initBody: unknown, headers: Headers): void {
  if (typeof initBody === "string" && !headers.has("content-type") && looksLikeJson(initBody)) {
    headers.set("content-type", "application/json");
  }
}
