import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
  isDiscoverableSourceFile,
  MAX_FILE_SIZE_BYTES,
} from "../../lib/contracts/src/index.js";
import { isSnapshotPath } from "../../lib/core/src/semantic/collection/semantic-snapshot-hash.js";

export type SnapshotPathExclusionReason =
  | "source-file-path-escapes-snapshot"
  | "source-file-symlink"
  | "source-file-not-regular"
  | "source-file-over-discovery-size-limit"
  | "tracked-file-over-size-limit"
  | "source-file-unreadable";

export type SnapshotPathInspection =
  | {
      readonly status: "safe";
      readonly absolutePath: string;
      readonly sizeBytes: number;
    }
  | {
      readonly status: "excluded";
      readonly reason: SnapshotPathExclusionReason;
    };

export interface SnapshotPathPreflight {
  readonly trackedPathCount: number;
  readonly safePathCount: number;
  readonly oversizedSourceFiles: readonly {
    readonly path: string;
    readonly sizeBytes: number;
  }[];
  readonly exclusions: readonly {
    readonly path: string;
    readonly reason: SnapshotPathExclusionReason;
  }[];
}

export function inspectSnapshotPath(
  snapshotRoot: string,
  filePath: string,
): SnapshotPathInspection {
  if (
    !filePath ||
    path.isAbsolute(filePath) ||
    filePath
      .split(/[\\/]/)
      .some((segment) => segment === ".." || segment === ".")
  )
    return { status: "excluded", reason: "source-file-path-escapes-snapshot" };

  let root: string;
  try {
    root = realpathSync(snapshotRoot);
  } catch {
    return { status: "excluded", reason: "source-file-not-regular" };
  }
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0)
    return { status: "excluded", reason: "source-file-not-regular" };
  let current = root;
  try {
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      const entry = lstatSync(current);
      if (entry.isSymbolicLink())
        return { status: "excluded", reason: "source-file-symlink" };
      if (index < segments.length - 1 && !entry.isDirectory())
        return { status: "excluded", reason: "source-file-not-regular" };
      if (index === segments.length - 1 && !entry.isFile())
        return { status: "excluded", reason: "source-file-not-regular" };
    }
    const resolved = realpathSync(current);
    const relative = path.relative(root, resolved);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      return {
        status: "excluded",
        reason: "source-file-path-escapes-snapshot",
      };
    const entry = statSync(resolved);
    if (!entry.isFile())
      return { status: "excluded", reason: "source-file-not-regular" };
    return { status: "safe", absolutePath: resolved, sizeBytes: entry.size };
  } catch {
    return { status: "excluded", reason: "source-file-not-regular" };
  }
}

/** Preflights every hash-relevant or discoverable source path before any measurement reads. */
export function preflightSnapshotPaths(
  snapshotRoot: string,
  trackedPaths: readonly string[],
): SnapshotPathPreflight {
  const exclusions: SnapshotPathPreflight["exclusions"][number][] = [];
  const oversizedSourceFiles: SnapshotPathPreflight["oversizedSourceFiles"][number][] =
    [];
  let safePathCount = 0;
  for (const filePath of trackedPaths) {
    const inspection = inspectSnapshotPath(snapshotRoot, filePath);
    if (inspection.status === "excluded") {
      exclusions.push({ path: filePath, reason: inspection.reason });
    } else if (inspection.sizeBytes > MAX_FILE_SIZE_BYTES) {
      if (isDiscoverableSourceFile(filePath) && !isSnapshotPath(filePath)) {
        oversizedSourceFiles.push({
          path: filePath,
          sizeBytes: inspection.sizeBytes,
        });
      } else {
        exclusions.push({
          path: filePath,
          reason: isDiscoverableSourceFile(filePath)
            ? "source-file-over-discovery-size-limit"
            : "tracked-file-over-size-limit",
        });
      }
    } else {
      safePathCount++;
    }
  }
  return {
    trackedPathCount: trackedPaths.length,
    safePathCount,
    oversizedSourceFiles,
    exclusions,
  };
}

/** Checks size before reading; never follows a tracked symlink or escapes the fresh snapshot. */
export function readSnapshotSourceFile(
  snapshotRoot: string,
  filePath: string,
  maxBytes: number,
):
  | { readonly status: "readable"; readonly bytes: Buffer }
  | {
      readonly status: "excluded";
      readonly reason: SnapshotPathExclusionReason;
    } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    return { status: "excluded", reason: "source-file-not-regular" };
  const inspection = inspectSnapshotPath(snapshotRoot, filePath);
  if (inspection.status === "excluded") return inspection;
  if (inspection.sizeBytes > maxBytes)
    return {
      status: "excluded",
      reason: "source-file-over-discovery-size-limit",
    };
  try {
    const bytes = readFileSync(inspection.absolutePath);
    if (bytes.byteLength > maxBytes)
      return {
        status: "excluded",
        reason: "source-file-over-discovery-size-limit",
      };
    return { status: "readable", bytes };
  } catch {
    return { status: "excluded", reason: "source-file-unreadable" };
  }
}
