import fs from "fs";
import path from "path";
import { isSupportedSourceFile } from "@workspace/core";
import {
  DOCUVIA_DIR_NAME,
  UTF8_ENCODING,
  NODE_MODULES_DIR_NAME,
} from "@workspace/contracts";
import type { ILogger } from "@workspace/contracts";
import { ANALYZE_MESSAGES } from "./analyze-messages.js";

/** Files at/above this count are dropped from analysis rather than silently included. */
export const MAX_ANALYZE_FILES = 40;
/** Cumulative content bytes at/above this size are dropped from analysis. */
export const MAX_ANALYZE_BYTES = 200_000;

export interface CollectedFile {
  relativePath: string;
  content: string;
}

const GIT_DIR_NAME = ".git";

const EXCLUDED_DIR_NAMES = new Set([
  NODE_MODULES_DIR_NAME,
  GIT_DIR_NAME,
  DOCUVIA_DIR_NAME,
]);

/** Recursively lists every file path under `dir`, skipping `node_modules`/`.git`/`.docuvia`. */
function walkDirectory(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDirectory(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Walks `resolvedPath` (a single file or a directory) collecting only `isSupportedSourceFile()`
 * matches, capped at `MAX_ANALYZE_FILES` files / `MAX_ANALYZE_BYTES` cumulative bytes, whichever
 * comes first. Files dropped by the cap are returned in `droppedFiles` (not silently discarded)
 * so the caller can log what was left out — see
 * `lib/ui-core/src/workflows/analyze/analyze-workflow.ts`'s decision-extraction path. A file
 * that throws on read (e.g. `EACCES`) is a different case — it's skipped from both `files` and
 * `droppedFiles` (it was never a cap-drop) and reported to the caller via `logger.warn` here
 * directly, since this module has no module-level logger singleton (unlike old Docuvia's
 * `ExtractService`) and must be threaded an `ILogger` explicitly.
 */
export function collectSourceFiles(
  resolvedPath: string,
  workspaceRoot: string,
  logger: ILogger,
): { files: CollectedFile[]; droppedFiles: string[] } {
  // Boundary validation (issue #162): resolve symlinks so that a symlink
  // pointing outside workspaceRoot is caught, not silently followed.
  const realWorkspaceRoot = fs.realpathSync(workspaceRoot);
  const realResolvedPath = fs.realpathSync(resolvedPath);
  if (
    !realResolvedPath.startsWith(realWorkspaceRoot + path.sep) &&
    realResolvedPath !== realWorkspaceRoot
  ) {
    logger.warn(ANALYZE_MESSAGES.FILE_READ_FAILED, {
      filePath: resolvedPath,
      error: `Resolved path ${realResolvedPath} is outside workspace root ${realWorkspaceRoot}`,
    });
    return { files: [], droppedFiles: [] };
  }

  const stat = fs.statSync(resolvedPath);
  const candidatePaths: string[] = stat.isDirectory()
    ? walkDirectory(resolvedPath)
    : [resolvedPath];

  const files: CollectedFile[] = [];
  const droppedFiles: string[] = [];
  let totalBytes = 0;

  for (const filePath of candidatePaths) {
    if (!isSupportedSourceFile(filePath)) continue;

    // Per-file boundary validation (issue #162): symlinked files inside
    // the tree may resolve to a target outside workspaceRoot.
    let realFilePath: string;
    try {
      realFilePath = fs.realpathSync(filePath);
    } catch {
      logger.warn(ANALYZE_MESSAGES.FILE_READ_FAILED, {
        filePath,
        error: "Failed to resolve symlinks for file path",
      });
      continue;
    }
    if (!realFilePath.startsWith(realWorkspaceRoot + path.sep)) {
      continue;
    }

    const relativePath = path.relative(workspaceRoot, filePath);

    if (files.length >= MAX_ANALYZE_FILES) {
      droppedFiles.push(relativePath);
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, UTF8_ENCODING);
    } catch (err) {
      logger.warn(ANALYZE_MESSAGES.FILE_READ_FAILED, {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (totalBytes + content.length > MAX_ANALYZE_BYTES) {
      droppedFiles.push(relativePath);
      continue;
    }

    totalBytes += content.length;
    files.push({ relativePath, content });
  }

  return { files, droppedFiles };
}
