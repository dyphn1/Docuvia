/**
 * Raw Git technology surface — implemented by `lib/git-local`. Contains no Docuvia-specific
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
  /** Previous path for a `status: "renamed"` entry (the `old` half of git's `R###\told\tnew` name-status line). Undefined for every other status. */
  oldFile?: string;
}

/** 0-indexed, tree-sitter-convention `[startRow, endRow]` (inclusive) line range touched by a diff hunk. */
export interface DiffLineRange {
  startRow: number;
  endRow: number;
}

export interface IGitProvider {
  isGitRepository(cwd: string): Promise<boolean>;

  /** Lists local branches matching `namePattern` exactly (used to check existence). */
  branchExists(cwd: string, branchName: string): Promise<boolean>;
  /** `git branch -D <branchName>` — force-deletes a local branch regardless of merge status (the
   *  knowledge branch is an orphan, never merged into source history, so a plain `-d` would
   *  always fail with "not fully merged"). Throws if the branch doesn't exist — callers that want
   *  a no-op in that case should check `branchExists()` first (see `IKnowledgeGitService`). */
  deleteBranch(cwd: string, branchName: string): Promise<void>;
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
  /** The directory hook files actually belong in for this repo — honors `core.hooksPath` (e.g.
   *  a husky-managed repo), unlike assuming `<git-dir>/hooks`. Exposed so callers like `doctor`
   *  can report exactly where a hook was checked/installed, rather than silently assuming a path
   *  that might not be where git (or the repo's hook manager) actually looks. */
  resolveHooksDir(cwd: string): Promise<string>;
  readHookFile(cwd: string, hookName: string): Promise<string | undefined>;
  appendHookFile(cwd: string, hookName: string, content: string): Promise<void>;
  /** Wholesale-overwrites the hook file's content (unlike `appendHookFile`) — used for an
   *  in-place legacy-hook upgrade (phase1-decision-integration.md §6c), where the caller has
   *  already computed the full replacement content (old Docuvia block removed, new block
   *  appended, any other user content preserved) and just needs it written back atomically. */
  writeHookFile(cwd: string, hookName: string, content: string): Promise<void>;
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
  /**
   * With no `toRef`: files changed relative to `baseRef`, diffed straight against the working
   * tree (not `<baseRef>...HEAD`) merged with untracked files — the original, commit-to-working-tree
   * semantics every pre-existing caller relies on. With `toRef` also given: a strict two-ref diff
   * (`git diff --name-status <baseRef> <toRef>`, no working-tree/untracked merging) — the
   * commit-to-commit semantics `analyze` auto mode's delta ingestion needs to diff
   * `lastIngestedSourceSha -> HEAD` (phase1-decision-integration.md §6b). Either way, renames
   * (`R###\told\tnew`) report the new path in `file`, with `oldFile` carrying the old one.
   */
  getChangedFilesSince(
    cwd: string,
    baseRef?: string,
    toRef?: string,
  ): Promise<ChangedFileEntry[]>;
  /**
   * 0-indexed line ranges (tree-sitter convention) touched by `fromRef -> toRef`'s diff of a
   * single file (`git diff --unified=0 <fromRef> <toRef> -- <filePath>`, parsed from unified-diff
   * hunk headers). Feeds `SemanticDiffDetector`'s classification pass
   * (phase1-decision-integration.md §6b) — approximate by design (context-free hunks, not a full
   * AST diff), and never the sole gate on whether a file gets re-parsed. `[]` if the file has no
   * textual diff between the two refs (or either ref/path doesn't exist).
   */
  getChangedLineRanges(
    cwd: string,
    fromRef: string,
    toRef: string,
    filePath: string,
  ): Promise<DiffLineRange[]>;
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
   * Names of the files directly inside `dirPath` at `ref` (`git ls-tree --name-only <ref> --
   * <dirPath>/`, full repo-relative posix paths, not basenames), or `[]` if `ref`/`dirPath`
   * doesn't exist at that commit. Used by L3 card hydration (phase2-l3-distribution.md
   * L3DIST-007) to list `knowledge/_l3/` without checking the knowledge branch out — the
   * directory-listing counterpart to `readFileAtRef`'s single-file read.
   */
  listFilesAtRef(cwd: string, ref: string, dirPath: string): Promise<string[]>;
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

  /** `git fetch <remote> <ref>` — updates `refs/remotes/<remote>/<ref>` from the remote. Used for cross-clone reconciliation (STOR-001 point 3). Throws on network/remote failure — callers decide whether that's fatal. `timeoutMs` bounds the shell-out (`undefined` — the default — waits for the transfer to finish, however long that takes; config-tunable, see `GitLocalProvider`'s doc comment on why the old hardcoded bound was removed). */
  fetchRef(
    cwd: string,
    remote: string,
    ref: string,
    timeoutMs?: number,
  ): Promise<void>;
  /** `git push <remote> refs/heads/<branchName>:refs/heads/<branchName>` — an explicit refspec, since the knowledge branch is normally never checked out. `timeoutMs` bounds the shell-out (`undefined` — the default — waits for the push to finish, however long that takes; config-tunable, see `GitLocalProvider`'s doc comment). */
  pushRef(
    cwd: string,
    remote: string,
    branchName: string,
    timeoutMs?: number,
  ): Promise<void>;
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
