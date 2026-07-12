import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  /**
   * Ensures the hidden `docuvia-knowledge` branch exists. Its first commit is produced by the
   * exact same mechanism as every later `snapshot` — an empty graph (nothing has been analyzed
   * yet), stamped with the current source HEAD hash — rather than a separate, unstamped
   * "initialize empty knowledge graph" commit disconnected from source history (STOR-001 point
   * 5): the branch is never in a state that doesn't correspond to some source commit. A thrown
   * error here is fatal to `init`.
   */
  public async ensureKnowledgeBranch(
    cwd: string,
    branchName: string = GitConstants.KNOWLEDGE_ROOT
  ): Promise<{ created: boolean }> {
    if (await this.git.branchExists(cwd, branchName)) {
      this.logger.debug("Knowledge branch already exists", { branchName });
      return { created: false };
    }

    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "docuvia-empty-knowledge-"));
    try {
      await this.packSnapshotToKnowledgeBranch(cwd, emptyDir, branchName);
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }

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

  /**
   * Packs a rendered snapshot directory (see `ISnapshotRenderer`) onto the hidden knowledge
   * branch, wholesale replacing its tree (parented on the branch's current tip — see
   * `IGitProvider.packDirectoryToBranch`) — the `snapshot` command's git-write step.
   */
  public async packSnapshotToKnowledgeBranch(
    cwd: string,
    sourceDir: string,
    branchName: string = GitConstants.KNOWLEDGE_ROOT
  ): Promise<void> {
    const commitMessage = await this.buildSnapshotCommitMessage(cwd);
    await this.git.packDirectoryToBranch(cwd, sourceDir, branchName, commitMessage);
    this.logger.info("Packed snapshot onto knowledge branch", { branchName });
  }

  /**
   * `Snapshot [<7-char>]` subject for human-facing `git log --grep` lookup, plus a full 40-char
   * `Docuvia-Source` trailer for unambiguous machine lookup (STOR-001 point 4) — 7-char prefixes
   * can collide in large repositories. Falls back to an unstamped message on an unborn HEAD (a
   * freshly `git init`-ed source repo with no commits yet) rather than failing `snapshot`/`init`
   * outright over a missing stamp.
   */
  private async buildSnapshotCommitMessage(cwd: string): Promise<string> {
    const sourceSha = await this.git.getHeadSha(cwd);
    if (!sourceSha) return "Snapshot [unknown]";
    return `Snapshot [${sourceSha.slice(0, 7)}]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: ${sourceSha}`;
  }
}
