import type { IKnowledgeGitService, ILogger } from "@workspace/contracts";
import { INIT_MESSAGES } from "./init-messages.js";

/** Phase 1: sets up the hidden `docuvia-knowledge` branch and (non-fatally) installs the
 *  post-commit hook (Tier A) and the pre-push hook (Tier B batch,
 *  phase1-decision-integration.md §8h). A thrown error here (from `ensureKnowledgeBranch`) is
 *  fatal to `init`; both hook installs are non-fatal (handled inside `KnowledgeGitService`). */
export async function ensureGitBranchAndHooks(
  knowledgeGit: IKnowledgeGitService,
  workspaceRoot: string,
  logger: ILogger,
): Promise<{
  branchCreated: boolean;
  hookInstalled: boolean;
  prePushHookInstalled: boolean;
}> {
  const { created: branchCreated } =
    await knowledgeGit.ensureKnowledgeBranch(workspaceRoot);

  logger.info(INIT_MESSAGES.INSTALLING_HOOK);
  const { installed: hookInstalled } =
    await knowledgeGit.installPostCommitHook(workspaceRoot);

  logger.info(INIT_MESSAGES.INSTALLING_PRE_PUSH_HOOK);
  const { installed: prePushHookInstalled } =
    await knowledgeGit.installPrePushHook(workspaceRoot);

  return { branchCreated, hookInstalled, prePushHookInstalled };
}
