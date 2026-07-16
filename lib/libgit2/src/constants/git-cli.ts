/**
 * Git CLI conventions shared across every raw shell-out in this package — `Libgit2Provider`,
 * `fast-import.ts`'s `runFastImport`, and `GitDiagnosticRunner`'s network reachability check.
 */

/** The `git` executable name, invoked identically by every git shell-out in this package. */
export const GIT_BIN = "git" as const;
