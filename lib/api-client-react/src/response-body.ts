import { HEADER_NAMES, HTTP_METHODS } from "./constants.js";

const NO_BODY_STATUS = new Set([204, 205, 304]);

export function hasNoBody(response: Response, method: string): boolean {
  if (method === HTTP_METHODS.HEAD) return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get(HEADER_NAMES.CONTENT_LENGTH) === "0") return true;
  if (response.body === null) return true;
  return false;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export async function readNormalizedText(
  response: Response
): Promise<{ raw: string; normalized: string; trimmed: string }> {
  const raw = await response.text();
  const normalized = stripBom(raw);
  return { raw, normalized, trimmed: normalized.trim() };
}

export function tryParseJson(
  text: string
): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}
