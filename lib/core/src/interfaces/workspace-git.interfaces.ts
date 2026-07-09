/**
 * Single-responsibility abstraction over all local-workspace `git` shell-outs.
 * Consolidates what used to be independently duplicated `child_process` calls in
 * InitService, FileDiscoveryService, and VcsScannerService.
 */
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
}
