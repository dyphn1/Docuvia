import { createHash } from "node:crypto";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const CONFIG_FILE =
  /(?:^|\/)(?:tsconfig[^/]*\.json|jsconfig[^/]*\.json|package\.json)$/;
const SHA256 = /^[a-f0-9]{64}$/;

/** C-01: files whose bytes define a collection snapshot. */
export function isSnapshotPath(path: string): boolean {
  return SOURCE_FILE.test(path) || CONFIG_FILE.test(path);
}

/** C-01: SHA-256 over sorted `<path>\0<sha256>\n` lines computed from actual file bytes. */
export function snapshotHash(
  entries: readonly { readonly path: string; readonly sha256: string }[],
): string {
  if (entries.length === 0) invalid("Snapshot has no files");
  const sorted = [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const hash = createHash("sha256");
  let previous: string | undefined;
  for (const { path, sha256 } of sorted) {
    if (!SHA256.test(sha256)) invalid("Snapshot digest must be SHA-256");
    if (path === previous) invalid("Duplicate snapshot path");
    previous = path;
    hash.update(`${path}\0${sha256}\n`, "utf8");
  }
  return hash.digest("hex");
}

function invalid(message: string): never {
  throw new DocuviaError(ErrorCodes.SEMANTIC_CORPUS_INVALID, message);
}
