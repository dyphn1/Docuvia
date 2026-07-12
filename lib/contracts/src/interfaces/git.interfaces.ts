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
  /** Full 40-char sha of the current source commit (`git rev-parse HEAD`), or `undefined` on an unborn/headless HEAD (e.g. a freshly `git init`-ed repo with no commits yet). */
  getHeadSha(cwd: string): Promise<string | undefined>;
  /** Full 40-char sha of `branchName`'s current tip, or `undefined` if the branch doesn't exist yet. Used to parent the next `packDirectoryToBranch` commit on it (STOR-001 point 2). */
  getBranchTipSha(cwd: string, branchName: string): Promise<string | undefined>;
  /** File content at `ref:filePath` (`git show <ref>:<filePath>`), or `undefined` if the ref or path doesn't exist. Used by hydration (STOR-002) to read `graph/*.jsonl` off the knowledge branch without checking it out. */
  readFileAtRef(cwd: string, ref: string, filePath: string): Promise<string | undefined>;
  /**
   * `ref`'s commit history (newest first), each with its full commit message body — raw, no
   * Docuvia-specific trailer parsing (that's `lib/core`'s job). `[]` if `ref` doesn't exist or has
   * no commits. `maxCount` bounds the walk (default 1000).
   */
  getCommitLog(
    cwd: string,
    ref: string,
    maxCount?: number
  ): Promise<Array<{ sha: string; message: string }>>;
  /** Shas of `ref`'s ancestry (newest first, `ref` itself included). `[]` if `ref` doesn't exist or has no commits. `maxCount` bounds the walk (default 1000). */
  getCommitAncestry(cwd: string, ref: string, maxCount?: number): Promise<string[]>;
  /**
   * Packs every file under `sourceDir` onto `branchName` as a full-tree-replace commit
   * (`deleteall` + one `M 100644 inline <path>` per file) via `git fast-import`, parented on the
   * branch's current tip (via `getBranchTipSha`) when it already has one — a root commit only the
   * very first time the branch is created. Every import is therefore a fast-forward; no `--force`
   * is used (STOR-001 point 2 — "continuous stacking", never an unreachable, orphaned history).
   */
  packDirectoryToBranch(
    cwd: string,
    sourceDir: string,
    branchName: string,
    commitMessage: string
  ): Promise<void>;
}
