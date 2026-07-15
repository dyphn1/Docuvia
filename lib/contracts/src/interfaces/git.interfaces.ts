/**
 * Raw Git technology surface — implemented by `lib/libgit2`. Contains no Docuvia-specific
 * semantics (no "knowledge branch", no "post-commit hook" concept); see
 * `knowledge-git.interfaces.ts` for the Domain Core layer built on top of this.
 */
export const ChangedFileStatuses = {
  ADDED: "added",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
} as const;
export type ChangedFileStatus =
  (typeof ChangedFileStatuses)[keyof typeof ChangedFileStatuses];

export interface ChangedFileEntry {
  file: string;
  status: ChangedFileStatus;
}

export interface IGitProvider {
  isGitRepository(cwd: string): Promise<boolean>;

  /** Lists local branches matching `namePattern` exactly (used to check existence). */
  branchExists(cwd: string, branchName: string): Promise<boolean>;
  /** `git commit-tree <empty-tree-sha> -m <message>` — creates a rootless commit pointing at
   *  git's well-known empty tree, and returns the new commit sha. */
  commitEmptyTree(cwd: string, message: string): Promise<string>;
  /** `git update-ref refs/heads/<branchName> <commitSha>`. */
  updateBranchRef(
    cwd: string,
    branchName: string,
    commitSha: string,
  ): Promise<void>;

  hooksDirExists(cwd: string): Promise<boolean>;
  readHookFile(cwd: string, hookName: string): Promise<string | undefined>;
  appendHookFile(cwd: string, hookName: string, content: string): Promise<void>;
  makeHookExecutable(cwd: string, hookName: string): Promise<void>;

  listTrackedFilesWithBlobHash(cwd: string): Promise<Map<string, string>>;
  listUntrackedFiles(cwd: string): Promise<string[]>;
  listModifiedFiles(cwd: string): Promise<string[]>;
  readBlobContent(cwd: string, sha: string): Promise<string>;
  getRemoteUrl(cwd: string): Promise<string | undefined>;
  getRecentChangedFilePaths(
    cwd: string,
    maxCommits?: number,
  ): Promise<string[]>;
  hasUncommittedChanges(cwd: string): Promise<boolean>;
  getChangedFilesSince(
    cwd: string,
    baseRef?: string,
  ): Promise<ChangedFileEntry[]>;
  getFilesChangedByCommit(cwd: string, sha: string): Promise<string[]>;
  /** Full 40-char sha of the current source commit (`git rev-parse HEAD`), or `undefined` on an unborn/headless HEAD (e.g. a freshly `git init`-ed repo with no commits yet). */
  getHeadSha(cwd: string): Promise<string | undefined>;
  /** Full 40-char sha of `branchName`'s current tip, or `undefined` if the branch doesn't exist yet. Used to parent the next `packDirectoryToBranch` commit on it (STOR-001 point 2). */
  getBranchTipSha(cwd: string, branchName: string): Promise<string | undefined>;
  /** File content at `ref:filePath` (`git show <ref>:<filePath>`), or `undefined` if the ref or path doesn't exist. Used by hydration (STOR-002) to read `graph/*.jsonl` off the knowledge branch without checking it out. */
  readFileAtRef(
    cwd: string,
    ref: string,
    filePath: string,
  ): Promise<string | undefined>;
  /**
   * `ref`'s commit history (newest first), each with its full commit message body — raw, no
   * Docuvia-specific trailer parsing (that's `lib/core`'s job). `[]` if `ref` doesn't exist or has
   * no commits. `maxCount` bounds the walk (default 1000).
   */
  getCommitLog(
    cwd: string,
    ref: string,
    maxCount?: number,
  ): Promise<Array<{ sha: string; message: string }>>;
  /** Shas of `ref`'s ancestry (newest first, `ref` itself included). `[]` if `ref` doesn't exist or has no commits. `maxCount` bounds the walk (default 1000). */
  getCommitAncestry(
    cwd: string,
    ref: string,
    maxCount?: number,
  ): Promise<string[]>;
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
    commitMessage: string,
  ): Promise<void>;

  /** `git fetch <remote> <ref>` — updates `refs/remotes/<remote>/<ref>` from the remote. Used for cross-clone reconciliation (STOR-001 point 3). Throws on network/remote failure — callers decide whether that's fatal. */
  fetchRef(cwd: string, remote: string, ref: string): Promise<void>;
  /** `git push <remote> refs/heads/<branchName>:refs/heads/<branchName>` — an explicit refspec, since the knowledge branch is normally never checked out. */
  pushRef(cwd: string, remote: string, branchName: string): Promise<void>;
  /** Full 40-char sha `ref` resolves to (`git rev-parse --verify --quiet <ref>`), or `undefined` if it doesn't exist. Unlike `getBranchTipSha`, `ref` may be any ref form (e.g. `refs/remotes/origin/docuvia-knowledge`), not just `refs/heads/<name>`. */
  getRefSha(cwd: string, ref: string): Promise<string | undefined>;
  /** `true` if `ancestorSha` is an ancestor of (or equal to) `descendantSha` (`git merge-base --is-ancestor`) — used to detect a plain fast-forward before falling back to a full merge. */
  isAncestor(
    cwd: string,
    ancestorSha: string,
    descendantSha: string,
  ): Promise<boolean>;
  /** The tree object sha `commitish` points at (`git rev-parse <commitish>^{tree}`) — the tree wholesale-adopted by a tree-adoption merge commit (STOR-001 point 3). */
  getTreeSha(cwd: string, commitish: string): Promise<string>;
  /** Unix seconds of `sha`'s committer timestamp (`git show -s --format=%ct`) — the wall-clock fallback when neither side of a divergence is a source-topological descendant of the other. */
  getCommitTimestamp(cwd: string, sha: string): Promise<number>;
  /**
   * `git commit-tree <treeSha> -p <parentShas[0]> -p <parentShas[1]> ... -m <message>` — creates a
   * merge commit whose tree is wholesale adopted from one side (a "tree-adoption merge", STOR-001
   * point 3), not a content-level merge of both sides. Uses the same synthetic `Docuvia
   * <docuvia@localhost>` committer identity as `packDirectoryToBranch`, not the local git config.
   */
  createMergeCommit(
    cwd: string,
    treeSha: string,
    parentShas: string[],
    message: string,
  ): Promise<string>;

  /**
   * Blocks until the advisory `.git/docuvia-knowledge.lock` file is exclusively created (retrying
   * with a timeout), so `snapshot`'s pack and cross-clone reconciliation's fetch/merge/push can
   * never race each other's `update-ref` (STOR-001). A lock file older than a staleness threshold
   * is assumed to belong to a crashed process and is stolen rather than waited out forever. Throws
   * if the wait times out without acquiring it.
   */
  acquireKnowledgeLock(cwd: string): Promise<void>;
  /** Releases the lock acquired by `acquireKnowledgeLock` (best-effort — a missing lock file is not an error). */
  releaseKnowledgeLock(cwd: string): Promise<void>;
}
