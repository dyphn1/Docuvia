import type { IGitProvider, IKnowledgeGitService, ILogger } from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import { GitConstants } from "./git-constants.js";

/**
 * Docuvia's git-specific domain logic, built entirely on `IGitProvider`'s raw primitives — the
 * "generating knowledge branches" example named directly in
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Domain Core section. If
 * `lib/libgit2` is ever swapped for another git implementation, this class is untouched.
 */
export class KnowledgeGitService implements IKnowledgeGitService {
  constructor(
    private readonly git: IGitProvider,
    private readonly logger: ILogger = createNoopLogger()
  ) {}

  /** Ensures the hidden `docuvia-knowledge` branch exists, creating it as an empty, rootless commit if missing. A thrown error here is fatal to `init`. */
  public async ensureKnowledgeBranch(
    cwd: string,
    branchName: string = GitConstants.KNOWLEDGE_ROOT
  ): Promise<{ created: boolean }> {
    if (await this.git.branchExists(cwd, branchName)) {
      this.logger.debug("Knowledge branch already exists", { branchName });
      return { created: false };
    }

    const commitSha = await this.git.commitEmptyTree(cwd, GitConstants.KNOWLEDGE_BRANCH_COMMIT_MESSAGE);
    await this.git.updateBranchRef(cwd, branchName, commitSha);
    this.logger.info("Created hidden knowledge branch", { branchName });
    return { created: true };
  }

  /**
   * Installs the post-commit hook that fires `docuvia snapshot` after every commit.
   * Non-fatal by design: `.git/hooks` may not exist (e.g. a bare repo, or `.git` mounted
   * read-only), and a broken hook shouldn't fail `init` itself.
   */
  public async installPostCommitHook(cwd: string): Promise<{ installed: boolean }> {
    const hookName = GitConstants.POST_COMMIT_HOOK_NAME;

    if (!(await this.git.hooksDirExists(cwd))) {
      this.logger.debug("No .git/hooks directory; skipping post-commit hook install");
      return { installed: false };
    }

    const existingHook = await this.git.readHookFile(cwd, hookName);
    if (existingHook?.includes(GitConstants.POST_COMMIT_HOOK_MARKER)) {
      this.logger.debug("Post-commit hook already installed");
      return { installed: false };
    }

    try {
      await this.git.appendHookFile(cwd, hookName, GitConstants.POST_COMMIT_HOOK_CONTENT);
      await this.git.makeHookExecutable(cwd, hookName);
    } catch (err) {
      // Non-fatal to init — a broken hook write shouldn't fail the whole workflow.
      this.logger.warn("Failed to install post-commit hook", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { installed: false };
    }

    this.logger.info("Installed post-commit hook");
    return { installed: true };
  }
}
