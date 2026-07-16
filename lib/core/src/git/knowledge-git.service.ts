import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  IGitProvider,
  IKnowledgeGitService,
  ILogger,
  KnowledgeBranchSyncResult,
} from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import { GitConstants } from "./git-constants.js";
import { parseSourceTrailer } from "./git-trailers.js";
import { withKnowledgeBranchLock } from "./knowledge-branch-lock.js";

/** Knowledge branch is a dedicated orphan branch of small, purpose-built commits — this comfortably bounds `resolveNewestSourceTrailerSha`'s log scan without truncating any real history (mirrors `HydrationService`'s identical scan-depth choice). */
const KNOWLEDGE_LOG_SCAN_LIMIT = 5000;

/**
 * Docuvia's git-specific domain logic, built entirely on `IGitProvider`'s raw primitives — the
 * "generating knowledge branches" example named directly in
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Domain Core section. If
 * `lib/libgit2` is ever swapped for another git implementation, this class is untouched.
 */
export class KnowledgeGitService implements IKnowledgeGitService {
  constructor(
    private readonly git: IGitProvider,
    private readonly logger: ILogger = createNoopLogger(),
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
    branchName: string = GitConstants.KNOWLEDGE_ROOT,
  ): Promise<{ created: boolean }> {
    if (await this.git.branchExists(cwd, branchName)) {
      this.logger.debug("Knowledge branch already exists", { branchName });
      return { created: false };
    }

    return withKnowledgeBranchLock(this.git, cwd, async () => {
      // Re-check inside the lock: another process may have created the branch between our
      // pre-lock check above and acquiring the lock here (PLAT-006).
      if (await this.git.branchExists(cwd, branchName)) {
        this.logger.warn(
          "Knowledge branch was created by a concurrent process; skipping duplicate initial commit",
          { branchName },
        );
        return { created: false };
      }

      const emptyDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "docuvia-empty-knowledge-"),
      );
      try {
        await this.packSnapshotToKnowledgeBranchLocked(
          cwd,
          emptyDir,
          branchName,
        );
      } finally {
        await fs.rm(emptyDir, { recursive: true, force: true });
      }

      this.logger.info("Created hidden knowledge branch", { branchName });
      return { created: true };
    });
  }

  /**
   * Installs the post-commit hook that fires `docuvia snapshot` after every commit.
   * Non-fatal by design: `.git/hooks` may not exist (e.g. a bare repo, or `.git` mounted
   * read-only), and a broken hook shouldn't fail `init` itself.
   */
  public async installPostCommitHook(
    cwd: string,
  ): Promise<{ installed: boolean }> {
    const hookName = GitConstants.POST_COMMIT_HOOK_NAME;

    if (!(await this.git.hooksDirExists(cwd))) {
      this.logger.debug(
        "No .git/hooks directory; skipping post-commit hook install",
      );
      return { installed: false };
    }

    const existingHook = await this.git.readHookFile(cwd, hookName);
    if (existingHook?.includes(GitConstants.POST_COMMIT_HOOK_MARKER)) {
      this.logger.debug("Post-commit hook already installed");
      return { installed: false };
    }

    // Reuses the knowledge-branch lock (the existing cross-process mutex for git-state writes
    // in this workspace, STOR-001) rather than a bespoke lockfile — the check above is a TOCTOU
    // race between processes, so it's re-checked here inside the lock (PLAT-006).
    return withKnowledgeBranchLock(this.git, cwd, async () => {
      const recheckHook = await this.git.readHookFile(cwd, hookName);
      if (recheckHook?.includes(GitConstants.POST_COMMIT_HOOK_MARKER)) {
        this.logger.warn(
          "Post-commit hook was installed by a concurrent process; skipping duplicate append",
        );
        return { installed: false };
      }

      try {
        await this.git.appendHookFile(
          cwd,
          hookName,
          GitConstants.POST_COMMIT_HOOK_CONTENT,
        );
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
    });
  }

  /**
   * Packs a rendered snapshot directory (see `ISnapshotRenderer`) onto the hidden knowledge
   * branch, wholesale replacing its tree (parented on the branch's current tip — see
   * `IGitProvider.packDirectoryToBranch`) — the `snapshot` command's git-write step. Holds the
   * knowledge-branch lock so this can't race a concurrent `syncKnowledgeBranch()`.
   */
  public async packSnapshotToKnowledgeBranch(
    cwd: string,
    sourceDir: string,
    branchName: string = GitConstants.KNOWLEDGE_ROOT,
  ): Promise<void> {
    await withKnowledgeBranchLock(this.git, cwd, () =>
      this.packSnapshotToKnowledgeBranchLocked(cwd, sourceDir, branchName),
    );
  }

  /** Core of `packSnapshotToKnowledgeBranch`, without acquiring the lock itself — for callers
   *  (`ensureKnowledgeBranch`) that already hold it, avoiding a same-process re-acquire deadlock
   *  against the non-reentrant `acquireKnowledgeLock`. */
  private async packSnapshotToKnowledgeBranchLocked(
    cwd: string,
    sourceDir: string,
    branchName: string,
  ): Promise<void> {
    const commitMessage = await this.buildSnapshotCommitMessage(cwd);
    await this.git.packDirectoryToBranch(
      cwd,
      sourceDir,
      branchName,
      commitMessage,
    );
    this.logger.info("Packed snapshot onto knowledge branch", { branchName });
  }

  /**
   * Cross-clone reconciliation (STOR-001 point 3). Holds the knowledge-branch lock so this can't
   * race a concurrent `packSnapshotToKnowledgeBranch()` (e.g. the post-commit hook's background
   * snapshot firing mid-reconciliation).
   */
  public async syncKnowledgeBranch(
    cwd: string,
    branchName: string = GitConstants.KNOWLEDGE_ROOT,
    remote: string = "origin",
  ): Promise<KnowledgeBranchSyncResult> {
    return withKnowledgeBranchLock(this.git, cwd, () =>
      this.reconcile(cwd, branchName, remote),
    );
  }

  private async reconcile(
    cwd: string,
    branchName: string,
    remote: string,
  ): Promise<KnowledgeBranchSyncResult> {
    const remoteUrl = await this.git.getRemoteUrl(cwd);
    if (!remoteUrl) {
      this.logger.debug(
        "No remote configured; skipping knowledge branch reconciliation",
        {
          branchName,
        },
      );
      return { status: "no-remote" };
    }

    try {
      await this.git.fetchRef(cwd, remote, branchName);
    } catch (err) {
      // Network/remote failure — degrade gracefully offline rather than failing the caller
      // (snapshot/hydrate) over a transient network hiccup.
      this.logger.warn(
        "Failed to fetch knowledge branch from remote; continuing offline",
        {
          branchName,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return { status: "no-remote" };
    }

    const remoteSha = await this.git.getRefSha(
      cwd,
      `refs/remotes/${remote}/${branchName}`,
    );
    const localSha = await this.git.getBranchTipSha(cwd, branchName);

    if (!remoteSha) {
      if (localSha) await this.pushQuietly(cwd, remote, branchName);
      return { status: "pushed-local", branchTipSha: localSha };
    }
    if (!localSha) {
      await this.git.updateBranchRef(cwd, branchName, remoteSha);
      this.logger.info(
        "Adopted remote knowledge branch (no local copy existed)",
        { branchName },
      );
      return { status: "fast-forwarded-local", branchTipSha: remoteSha };
    }
    if (localSha === remoteSha) {
      return { status: "up-to-date", branchTipSha: localSha };
    }

    if (await this.git.isAncestor(cwd, localSha, remoteSha)) {
      await this.git.updateBranchRef(cwd, branchName, remoteSha);
      this.logger.info("Fast-forwarded local knowledge branch to remote", {
        branchName,
        remoteSha,
      });
      return { status: "fast-forwarded-local", branchTipSha: remoteSha };
    }
    if (await this.git.isAncestor(cwd, remoteSha, localSha)) {
      await this.pushQuietly(cwd, remote, branchName);
      return { status: "pushed-local", branchTipSha: localSha };
    }

    // True divergence — tree-adoption merge (STOR-001 point 3): create a 2-parent merge commit
    // wholesale adopting the winning side's tree, rather than a content-level merge of both.
    const winnerSha = await this.resolveMergeWinner(cwd, localSha, remoteSha);
    const winningTree = await this.git.getTreeSha(cwd, winnerSha);
    const mergeMessage = `Merge knowledge branch (${winnerSha === localSha ? "local" : "remote"} wins)`;
    const mergeSha = await this.git.createMergeCommit(
      cwd,
      winningTree,
      [localSha, remoteSha],
      mergeMessage,
    );
    await this.git.updateBranchRef(cwd, branchName, mergeSha);
    await this.pushQuietly(cwd, remote, branchName);

    this.logger.info("Merged diverged knowledge branch", {
      branchName,
      winner: winnerSha === localSha ? "local" : "remote",
      mergeSha,
    });
    return { status: "merged", branchTipSha: mergeSha };
  }

  private async pushQuietly(
    cwd: string,
    remote: string,
    branchName: string,
  ): Promise<void> {
    try {
      await this.git.pushRef(cwd, remote, branchName);
    } catch (err) {
      this.logger.warn(
        "Failed to push knowledge branch to remote; will retry on next sync",
        {
          branchName,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  /**
   * Picks the winning side of a genuine divergence: the side whose stamped `Docuvia-Source`
   * commit is a descendant of the other's (topological recency in the *source* repository — see
   * STOR-001 point 3), falling back to committer timestamp when neither stamped source is an
   * ancestor of the other (unrelated source lines, or one side's source commit isn't reachable in
   * this clone's object database at all — e.g. a peer analyzed a commit not yet fetched here).
   */
  private async resolveMergeWinner(
    cwd: string,
    shaA: string,
    shaB: string,
  ): Promise<string> {
    const [logA, logB] = await Promise.all([
      this.git.getCommitLog(cwd, shaA, 1),
      this.git.getCommitLog(cwd, shaB, 1),
    ]);
    const sourceA = logA[0] ? parseSourceTrailer(logA[0].message) : undefined;
    const sourceB = logB[0] ? parseSourceTrailer(logB[0].message) : undefined;

    if (sourceA && sourceB) {
      try {
        if (await this.git.isAncestor(cwd, sourceA, sourceB)) return shaB;
        if (await this.git.isAncestor(cwd, sourceB, sourceA)) return shaA;
      } catch {
        // Fall through to the timestamp fallback below.
      }
    }

    const [tsA, tsB] = await Promise.all([
      this.git.getCommitTimestamp(cwd, shaA),
      this.git.getCommitTimestamp(cwd, shaB),
    ]);
    return tsA >= tsB ? shaA : shaB;
  }

  /**
   * The `Docuvia-Source` trailer sha stamped on `branchName`'s most recent commit that carries
   * one — `analyze` auto mode's delta-baseline fallback for pre-Slice-2 workspaces where
   * `docuvia_meta`'s `lastIngestedSourceSha` key hasn't been written yet
   * (phase1-decision-integration.md §6a's fallback order). Unlike `HydrationService`'s
   * `resolveHydrationCommit` (which maps every stamped source sha and intersects with source
   * HEAD's ancestry to find the *matching* knowledge commit), this only wants the newest stamped
   * value, full stop — no ancestry walk needed.
   */
  public async resolveNewestSourceTrailerSha(
    cwd: string,
    branchName: string = GitConstants.KNOWLEDGE_ROOT,
  ): Promise<string | undefined> {
    const log = await this.git.getCommitLog(
      cwd,
      branchName,
      KNOWLEDGE_LOG_SCAN_LIMIT,
    );
    for (const entry of log) {
      const sourceSha = parseSourceTrailer(entry.message);
      if (sourceSha) return sourceSha;
    }
    return undefined;
  }

  /** Thin pass-through to `withKnowledgeBranchLock` — see `IKnowledgeGitService`'s doc comment. */
  public async runUnderKnowledgeLock<T>(
    cwd: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withKnowledgeBranchLock(this.git, cwd, fn);
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
