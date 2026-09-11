import path from "node:path";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";

const HOOK_PATH_TRAVERSAL_MESSAGE =
  "Git hook name must be a basename contained by the resolved hooks directory";

/**
 * Resolves a caller-supplied Git hook name beneath the effective hooks directory.
 *
 * Git hook APIs accept a hook *name*, not a path. Rejecting path separators up front keeps that
 * contract explicit on every platform (including Windows separators while tests run on POSIX),
 * while the final `path.relative` containment check is the defense-in-depth boundary against
 * absolute/drive-relative/path-normalization escapes.
 */
export function resolveHookPathWithinDir(
  hooksDir: string,
  hookName: string,
): string {
  if (
    hookName.length === 0 ||
    hookName === "." ||
    hookName === ".." ||
    hookName.includes("/") ||
    hookName.includes("\\") ||
    path.isAbsolute(hookName)
  ) {
    throw new DocuviaError(
      ErrorCodes.FS_PATH_TRAVERSAL,
      HOOK_PATH_TRAVERSAL_MESSAGE,
    );
  }

  const resolvedHooksDir = path.resolve(hooksDir);
  const resolvedHookPath = path.resolve(resolvedHooksDir, hookName);
  const relative = path.relative(resolvedHooksDir, resolvedHookPath);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new DocuviaError(
      ErrorCodes.FS_PATH_TRAVERSAL,
      HOOK_PATH_TRAVERSAL_MESSAGE,
    );
  }

  return resolvedHookPath;
}
