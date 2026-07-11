/**
 * Docuvia-specific git behavior — implemented by `lib/core/git` on top of `IGitProvider`.
 * This is the "generating knowledge branches" example named directly in
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Domain Core section.
 */
export interface IKnowledgeGitService {
  ensureKnowledgeBranch(cwd: string, branchName?: string): Promise<{ created: boolean }>;
  installPostCommitHook(cwd: string): Promise<{ installed: boolean }>;
}
