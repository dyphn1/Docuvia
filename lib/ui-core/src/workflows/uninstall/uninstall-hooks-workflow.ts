import { docuviaFactory, TOKENS, type ILogger } from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";

/**
 * `uninstall`'s git-artifact-removal workflow (phase1-decision-integration.md §10a) — removes
 * both git hooks `init` installs (post-commit, Tier A; pre-push, Tier B batch, decision 1a) via
 * `IKnowledgeGitService`'s symmetric `removePostCommitHook`/`removePrePushHook`, plus (unless
 * `keepDb` is set — the same flag that gates local.db's own removal, since the knowledge branch
 * is that same graph's git-portable twin, STOR-001/STOR-002) deletes the hidden orphan
 * `docuvia-knowledge` branch itself via `deleteKnowledgeBranch`. Mirrors `ImpactWorkflow`'s thin
 * shape. Never throws past this layer for a single step's failure — each removal is caught and
 * logged independently, mirroring `uninstallCommand`'s own per-platform non-fatal loop, so one
 * failure never skips the others or the caller's remaining cleanup steps.
 */
export class UninstallHooksWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(keepDb = false): Promise<{
    postCommitRemoved: boolean;
    prePushRemoved: boolean;
    knowledgeBranchDeleted: boolean;
  }> {
    const { workspaceRoot, logger } = this;
    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger,
    });

    const postCommitRemoved = await this.removeHookSafely(
      () => knowledgeGit.removePostCommitHook(workspaceRoot),
      GitConstants.POST_COMMIT_HOOK_NAME,
    );
    const prePushRemoved = await this.removeHookSafely(
      () => knowledgeGit.removePrePushHook(workspaceRoot),
      GitConstants.PRE_PUSH_HOOK_NAME,
    );

    let knowledgeBranchDeleted = false;
    if (!keepDb) {
      try {
        ({ deleted: knowledgeBranchDeleted } =
          await knowledgeGit.deleteKnowledgeBranch(workspaceRoot));
      } catch (err) {
        this.logger.warn("Failed to delete the docuvia-knowledge git branch", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { postCommitRemoved, prePushRemoved, knowledgeBranchDeleted };
  }

  /** Runs a single hook-removal call, catching and logging any failure rather than letting it
   *  propagate — so one hook's failure never skips the other. */
  private async removeHookSafely(
    remove: () => Promise<{ removed: boolean }>,
    hookName: string,
  ): Promise<boolean> {
    try {
      const { removed } = await remove();
      return removed;
    } catch (err) {
      this.logger.warn(`Failed to remove the ${hookName} git hook`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}
