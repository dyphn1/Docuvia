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
