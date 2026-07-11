import type { IKnowledgeGitService, ILogger } from "@workspace/contracts";
import { INIT_MESSAGES } from "./init-messages.js";

/** Phase 1: sets up the hidden `docuvia-knowledge` branch and (non-fatally) installs the post-commit hook. A thrown error here (from `ensureKnowledgeBranch`) is fatal to `init`. */
export async function ensureGitBranchAndHooks(
  knowledgeGit: IKnowledgeGitService,
  workspaceRoot: string,
  logger: ILogger
): Promise<{ branchCreated: boolean; hookInstalled: boolean }> {
  const { created: branchCreated } = await knowledgeGit.ensureKnowledgeBranch(workspaceRoot);

  logger.info(INIT_MESSAGES.INSTALLING_HOOK);
  const { installed: hookInstalled } = await knowledgeGit.installPostCommitHook(workspaceRoot);

  return { branchCreated, hookInstalled };
}
