import { IWorkspaceGitService } from "../../interfaces/workspace-git.interfaces.js";
import { INIT_SERVICE_MESSAGES } from "../../constants/init-service-messages.js";

/**
 * Phase 1 of `InitCommand.execute()`: sets up the hidden `docuvia-knowledge` branch and
 * (non-fatally) installs the post-commit hook. Ported from old `InitService.init()`'s steps
 * 1-2 — `installPostCommitHook`'s "fail silently, return `{installed:false}`" behavior already
 * lives inside `WorkspaceGitService` itself, so no extra try/catch is needed here to preserve
 * that non-fatal contract. `ensureKnowledgeBranch` is deliberately left unguarded — a thrown
 * error there was, and remains, fatal to `init`.
 */
export async function ensureGitBranchAndHooks(
  git: IWorkspaceGitService,
  workspaceRoot: string,
  onProgress?: (msg: string) => void
): Promise<{ branchCreated: boolean; hookInstalled: boolean }> {
  const { created: branchCreated } = await git.ensureKnowledgeBranch(workspaceRoot);

  onProgress?.(INIT_SERVICE_MESSAGES.INSTALLING_HOOK);
  const { installed: hookInstalled } = await git.installPostCommitHook(workspaceRoot);

  return { branchCreated, hookInstalled };
}
