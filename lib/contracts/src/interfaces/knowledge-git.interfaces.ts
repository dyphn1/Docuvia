export const KnowledgeBranchSyncStatuses = {
  NO_REMOTE: "no-remote",
  UP_TO_DATE: "up-to-date",
  FAST_FORWARDED_LOCAL: "fast-forwarded-local",
  PUSHED_LOCAL: "pushed-local",
  MERGED: "merged",
} as const;
export type KnowledgeBranchSyncStatus =
  (typeof KnowledgeBranchSyncStatuses)[keyof typeof KnowledgeBranchSyncStatuses];

/** Outcome of `IKnowledgeGitService.syncKnowledgeBranch()` (STOR-001 point 3). */
export interface KnowledgeBranchSyncResult {
  /**
   * `no-remote`: no `origin` configured, or the fetch failed (offline) — purely local, not an
   * error. `up-to-date`: local and remote already match. `fast-forwarded-local`: local moved to
   * match a strictly-ahead remote (or adopted the remote wholesale when no local copy existed).
   * `pushed-local`: local was strictly ahead (or the remote had no copy yet) and was pushed.
   * `merged`: local and remote had genuinely diverged; a tree-adoption merge commit was created
   * and pushed.
   */
  status: KnowledgeBranchSyncStatus;
  /** The branch's resulting tip sha. Undefined only for `no-remote`. */
  branchTipSha?: string;
}

/**
 * Docuvia-specific git behavior — implemented by `lib/core/git` on top of `IGitProvider`.
 * This is the "generating knowledge branches" example named directly in
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Domain Core section.
 */
export interface IKnowledgeGitService {
  ensureKnowledgeBranch(
    cwd: string,
    branchName?: string,
  ): Promise<{ created: boolean }>;
  installPostCommitHook(cwd: string): Promise<{ installed: boolean }>;
  /** Packs a rendered snapshot directory (see `ISnapshotRenderer`) onto the hidden knowledge branch, wholesale replacing its tree. */
  packSnapshotToKnowledgeBranch(
    cwd: string,
    sourceDir: string,
    branchName?: string,
  ): Promise<void>;
  /**
   * Cross-clone reconciliation (STOR-001 point 3): fetches `origin`'s copy of the knowledge
   * branch and reconciles it with the local one — a plain fast-forward in either direction when
   * possible, or a tree-adoption merge (winner = the side whose stamped source commit is a
   * descendant of the other's, falling back to committer timestamp) when they've genuinely
   * diverged. A no-op (`status: "no-remote"`) when there's no `origin`, or the fetch fails
   * (offline) — this never fails a caller's `snapshot`/`hydrate` over a network hiccup.
   */
  syncKnowledgeBranch(
    cwd: string,
    branchName?: string,
    remote?: string,
  ): Promise<KnowledgeBranchSyncResult>;
  /**
   * The `Docuvia-Source` trailer sha stamped on the knowledge branch's most recent commit that
   * carries one (STOR-001 point 4) — `analyze` auto mode's delta-baseline fallback for pre-Slice-2
   * workspaces where `docuvia_meta`'s `lastIngestedSourceSha` key hasn't been written yet
   * (phase1-decision-integration.md §6a's fallback order). Undefined if the branch doesn't exist
   * or none of its commits carry the trailer.
   */
  resolveNewestSourceTrailerSha(
    cwd: string,
    branchName?: string,
  ): Promise<string | undefined>;
  /**
   * Runs `fn` while holding the knowledge-branch lock (the same advisory
   * `.git/docuvia-knowledge.lock` `packSnapshotToKnowledgeBranch`/`syncKnowledgeBranch` use,
   * STOR-001/PLAT-006) — `analyze` auto mode's delta persist step takes this lock for its
   * local.db writes (phase1-decision-integration.md §6b's locking requirement; PLAT-007's
   * reliability section), even though it doesn't itself mutate the knowledge branch ref, so it
   * can't race a concurrent `snapshot`'s read-then-pack of the same local.db. Exposed as a
   * generic method (rather than requiring `lib/ui-core` to import `lib/core`'s
   * `withKnowledgeBranchLock` helper directly) to keep the Orchestration layer resolving
   * everything by token, per the Virtual Contracts architecture.
   */
  runUnderKnowledgeLock<T>(cwd: string, fn: () => Promise<T>): Promise<T>;
}
