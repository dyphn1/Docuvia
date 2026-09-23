import fs from "node:fs";
import path from "node:path";

/**
 * Returns true when `targetPath` resolves inside `workspaceRoot` (lexically, after
 * `path.resolve` normalization). Used as a pre-delete guardrail by destructive workflows
 * (`clean`, `uninstall` — issues #266/#267) so a future change to path construction can
 * never turn an unlink/rm into a workspace escape. Lexical only: it does not resolve
 * symlinks (see `fs.realpath`); callers operating on attacker-influenced symlinked trees
 * need a stronger check.
 */
export function isPathWithinWorkspace(
  targetPath: string,
  workspaceRoot: string,
): boolean {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(targetPath);
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

export type ExistingWorkspacePathResult =
  | { status: "ok"; resolvedPath: string }
  | { status: "outside" }
  | { status: "missing" };

/**
 * Validates an existing path in two stages:
 * 1. lexical containment before any target filesystem probe, so absolute/.. escapes cannot be
 *    used as an existence oracle outside the workspace;
 * 2. canonical containment with realpath, so an in-workspace symlink or Windows junction cannot
 *    redirect the staging path outside the workspace.
 *
 * This is a repository-input boundary, not an OS sandbox: a hostile local process racing path
 * replacement after this check is outside the cross-platform Node filesystem contract.
 */
export function resolveExistingPathWithinWorkspace(
  targetPath: string,
  workspaceRoot: string,
): ExistingWorkspacePathResult {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(resolvedRoot, targetPath);

  if (!isPathWithinWorkspace(resolvedTarget, resolvedRoot)) {
    return { status: "outside" };
  }

  // Only probe after the lexical boundary has passed.
  if (!fs.existsSync(resolvedTarget)) {
    return { status: "missing" };
  }

  try {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realTarget = fs.realpathSync(resolvedTarget);
    if (!isPathWithinWorkspace(realTarget, realRoot)) {
      return { status: "outside" };
    }
  } catch {
    return { status: "missing" };
  }

  // Keep the caller-visible lexical path rather than replacing it with the canonical target:
  // persisted node keys must remain workspace-relative to the path the repository actually uses.
  return { status: "ok", resolvedPath: resolvedTarget };
}
