import { HEADER_NAMES } from "./constants.js";

export function getMediaType(headers: Headers): string | null {
  const value = headers.get(HEADER_NAMES.CONTENT_TYPE);
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

export function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

export function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
    (mediaType.startsWith("text/") ||
      mediaType === "application/xml" ||
      mediaType === "text/xml" ||
      mediaType.endsWith("+xml") ||
      mediaType === "application/x-www-form-urlencoded")
  );
}
