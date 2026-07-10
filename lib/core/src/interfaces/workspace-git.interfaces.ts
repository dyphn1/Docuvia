/**
 * Single-responsibility abstraction over all local-workspace `git` shell-outs.
 * Consolidates what used to be independently duplicated `child_process` calls in
 * InitService, FileDiscoveryService, and VcsScannerService.
 */
export interface ChangedFileEntry {
  file: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface IWorkspaceGitService {
  isGitRepository(cwd: string): Promise<boolean>;
  ensureKnowledgeBranch(cwd: string, branchName?: string): Promise<{ created: boolean }>;
  installPostCommitHook(cwd: string): Promise<{ installed: boolean }>;
  listTrackedFilesWithBlobHash(cwd: string): Promise<Map<string, string>>;
  listUntrackedFiles(cwd: string): Promise<string[]>;
  listModifiedFiles(cwd: string): Promise<string[]>;
  readBlobContent(cwd: string, sha: string): Promise<string>;
  getRemoteUrl(cwd: string): Promise<string | undefined>;
  getRecentChangedFilePaths(cwd: string, maxCommits?: number): Promise<string[]>;
  hasUncommittedChanges(cwd: string): Promise<boolean>;
  /**
   * Files changed relative to `baseRef` (or the working tree against HEAD when omitted),
   * with each entry classified by git's status letter. Used by `ChangeDetectionService`
   * (`docuvia review`) to scope which files to assess for structural risk.
   */
  getChangedFilesSince(cwd: string, baseRef?: string): Promise<ChangedFileEntry[]>;
  /**
   * Files touched by a specific commit sha, run against the local workspace directly
   * (as opposed to `LocalGitClient`, which operates against a cloned temp dir). Used by
   * `SyncService` (`docuvia sync <project_id> <sha>`) to scope which local L3 nodes are
   * candidates for a sync run.
   */
  getFilesChangedByCommit(cwd: string, sha: string): Promise<string[]>;
}
