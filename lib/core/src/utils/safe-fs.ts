import * as fs from "fs";
import path from "path";
import { UTF8_ENCODING } from "@workspace/contracts";

/**
 * Resolves `relativePath` against `rootDir` and verifies — lexically, via `path.resolve` — that
 * the result stays inside `rootDir`. Returns the absolute resolved path, or `null` when the
 * relative path escapes the root (`../` traversal, or an absolute path pointing elsewhere).
 *
 * Single containment choke point for the "join a trusted root with an untrusted relative path"
 * pattern (issue #208): tsconfig path aliases, monorepo workspace globs, and import specifiers
 * all originate in files inside the analyzed workspace, so any of them can carry a traversal
 * segment. Callers must go through this (or `readFileWithinRoot`) rather than a bare
 * `path.join(root, rel)` so the check cannot be skipped per call site.
 */
export function resolveWithinRoot(
  rootDir: string,
  relativePath: string,
): string | null {
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  return resolved === resolvedRoot || resolved.startsWith(rootWithSep)
    ? resolved
    : null;
}

/**
 * `resolveWithinRoot` + exists-check + `readFileSync(utf8)` in one call: returns the file's text,
 * or `null` when the path escapes `rootDir`, doesn't exist, or can't be read. Lets callers replace
 * the raw `path.join(this.workspaceRoot, ...) + fs.existsSync/fs.readFileSync` idiom (issue #208)
 * without re-implementing (or omitting) the containment check.
 */
export function readFileWithinRoot(
  rootDir: string,
  relativePath: string,
): string | null {
  const absolute = resolveWithinRoot(rootDir, relativePath);
  if (!absolute || !fs.existsSync(absolute)) return null;
  try {
    return fs.readFileSync(absolute, UTF8_ENCODING);
  } catch {
    return null;
  }
}
