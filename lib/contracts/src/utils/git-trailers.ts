import { GitConstants } from "../constants/git-conventions.js";

const SOURCE_TRAILER_PREFIX = `${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: `;

/** Extracts the `Docuvia-Source: <sha>` trailer (STOR-001 point 4) from a commit message body,
 *  or undefined if absent (e.g. the `Snapshot [unknown]` fallback message on an unborn source
 *  HEAD). Pure helper shared by `lib/core`'s hydration/snapshot services and `lib/ui-core`'s
 *  `analyze` workflow — lives in contracts (utils precedent: `process-lock.ts`) so both layers
 *  read the same trailer without a `lib/ui-core` -> `lib/core` import (Virtual Contracts §8). */
export function parseSourceTrailer(message: string): string | undefined {
  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(SOURCE_TRAILER_PREFIX)) {
      return trimmed.slice(SOURCE_TRAILER_PREFIX.length).trim();
    }
  }
  return undefined;
}
