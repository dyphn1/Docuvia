import { GitConstants } from "./git-constants.js";

const SOURCE_TRAILER_PREFIX = `${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: `;

/** Extracts the `Docuvia-Source: <sha>` trailer (STOR-001 point 4) from a commit message body, or undefined if absent (e.g. the `Snapshot [unknown]` fallback message on an unborn source HEAD). */
export function parseSourceTrailer(message: string): string | undefined {
  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(SOURCE_TRAILER_PREFIX)) {
      return trimmed.slice(SOURCE_TRAILER_PREFIX.length).trim();
    }
  }
  return undefined;
}
