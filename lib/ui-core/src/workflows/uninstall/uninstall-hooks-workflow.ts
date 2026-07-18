import { docuviaFactory, TOKENS, type ILogger } from "@workspace/contracts";

/**
 * `uninstall`'s hooks-removal workflow (phase1-decision-integration.md §10a) — removes both git
 * hooks `init` installs (post-commit, Tier A; pre-push, Tier B batch, decision 1a) via
 * `IKnowledgeGitService`'s symmetric `removePostCommitHook`/`removePrePushHook`. Mirrors
 * `ImpactWorkflow`'s thin shape. Never throws past this layer for a single hook's failure — each
 * removal is caught and logged independently, mirroring `uninstallCommand`'s own per-platform
 * non-fatal loop, so one hook's failure never skips the other or the caller's remaining cleanup
 * steps.
 */
export class UninstallHooksWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(): Promise<{
    postCommitRemoved: boolean;
    prePushRemoved: boolean;
  }> {
    const { workspaceRoot, logger } = this;
    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger,
    });

    const postCommitRemoved = await this.removeHookSafely(
      () => knowledgeGit.removePostCommitHook(workspaceRoot),
      "post-commit",
    );
    const prePushRemoved = await this.removeHookSafely(
      () => knowledgeGit.removePrePushHook(workspaceRoot),
      "pre-push",
    );

    return { postCommitRemoved, prePushRemoved };
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
