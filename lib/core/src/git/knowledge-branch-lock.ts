import type { IGitProvider } from "@workspace/contracts";

/**
 * Runs `fn` while holding the knowledge-branch lock (`IGitProvider.acquireKnowledgeLock`),
 * releasing it (best-effort) even if `fn` throws — see `KnowledgeGitService`'s
 * `packSnapshotToKnowledgeBranch`/`syncKnowledgeBranch`, the two operations that mutate the
 * knowledge branch ref and must never race each other (STOR-001).
 */
export async function withKnowledgeBranchLock<T>(
  git: IGitProvider,
  cwd: string,
  fn: () => Promise<T>
): Promise<T> {
  await git.acquireKnowledgeLock(cwd);
  try {
    return await fn();
  } finally {
    await git.releaseKnowledgeLock(cwd);
  }
}
