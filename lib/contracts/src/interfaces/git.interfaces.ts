/**
 * Raw Git technology surface — implemented by `lib/libgit2`. Contains no Docuvia-specific
 * semantics (no "knowledge branch", no "post-commit hook" concept); see
 * `knowledge-git.interfaces.ts` for the Domain Core layer built on top of this.
 */
export interface ChangedFileEntry {
  file: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface IGitProvider {
  isGitRepository(cwd: string): Promise<boolean>;

  /** Lists local branches matching `namePattern` exactly (used to check existence). */
  branchExists(cwd: string, branchName: string): Promise<boolean>;
  /** `git commit-tree <empty-tree-sha> -m <message>` — creates a rootless commit pointing at
   *  git's well-known empty tree, and returns the new commit sha. */
  commitEmptyTree(cwd: string, message: string): Promise<string>;
  /** `git update-ref refs/heads/<branchName> <commitSha>`. */
  updateBranchRef(cwd: string, branchName: string, commitSha: string): Promise<void>;

  hooksDirExists(cwd: string): Promise<boolean>;
  readHookFile(cwd: string, hookName: string): Promise<string | undefined>;
  appendHookFile(cwd: string, hookName: string, content: string): Promise<void>;
  makeHookExecutable(cwd: string, hookName: string): Promise<void>;

  listTrackedFilesWithBlobHash(cwd: string): Promise<Map<string, string>>;
  listUntrackedFiles(cwd: string): Promise<string[]>;
  listModifiedFiles(cwd: string): Promise<string[]>;
  readBlobContent(cwd: string, sha: string): Promise<string>;
  getRemoteUrl(cwd: string): Promise<string | undefined>;
  getRecentChangedFilePaths(cwd: string, maxCommits?: number): Promise<string[]>;
  hasUncommittedChanges(cwd: string): Promise<boolean>;
  getChangedFilesSince(cwd: string, baseRef?: string): Promise<ChangedFileEntry[]>;
  getFilesChangedByCommit(cwd: string, sha: string): Promise<string[]>;
  /**
   * Packs every file under `sourceDir` onto `branchName` as a fresh root commit via
   * `git fast-import` (`deleteall` + one `M 100644 inline <path>` per file), wholesale replacing
   * the branch's entire tree. Always forces the ref update — `deleteall` makes every call a
   * complete, independent snapshot, so it must land regardless of the branch's prior history.
   */
  packDirectoryToBranch(cwd: string, sourceDir: string, branchName: string): Promise<void>;
}
