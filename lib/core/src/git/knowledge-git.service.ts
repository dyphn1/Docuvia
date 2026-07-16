import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  IGitProvider,
  IKnowledgeGitService,
  ILogger,
  KnowledgeBranchSyncResult,
} from "@workspace/contracts";
import {
  createNoopLogger,
  KnowledgeBranchSyncStatuses,
} from "@workspace/contracts";
import { GitConstants, GitMessages } from "./git-constants.js";
import { parseSourceTrailer } from "./git-trailers.js";
import { withKnowledgeBranchLock } from "./knowledge-branch-lock.js";

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
      this.logger.debug(GitMessages.KNOWLEDGE_BRANCH_ALREADY_EXISTS, {
        branchName,
      });
      return { created: false };
    }

    return withKnowledgeBranchLock(this.git, cwd, async () => {
      // Re-check inside the lock: another process may have created the branch between our
      // pre-lock check above and acquiring the lock here (PLAT-006).
      if (await this.git.branchExists(cwd, branchName)) {
        this.logger.warn(GitMessages.CONCURRENT_INITIAL_COMMIT_SKIPPED, {
          branchName,
        });
        return { created: false };
      }

      const emptyDir = await fs.mkdtemp(
        path.join(os.tmpdir(), GitConstants.EMPTY_KNOWLEDGE_TEMP_DIR_PREFIX),
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

      this.logger.info(GitMessages.CREATED_KNOWLEDGE_BRANCH, { branchName });
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
      this.logger.debug(GitMessages.NO_GIT_HOOKS_DIR);
      return { installed: false };
    }

    const existingHook = await this.git.readHookFile(cwd, hookName);
    if (existingHook?.includes(GitConstants.POST_COMMIT_HOOK_MARKER)) {
      this.logger.debug(GitMessages.POST_COMMIT_HOOK_ALREADY_INSTALLED);
      return { installed: false };
    }

    // Reuses the knowledge-branch lock (the existing cross-process mutex for git-state writes
    // in this workspace, STOR-001) rather than a bespoke lockfile — the check above is a TOCTOU
    // race between processes, so it's re-checked here inside the lock (PLAT-006).
    return withKnowledgeBranchLock(this.git, cwd, async () => {
      const recheckHook = await this.git.readHookFile(cwd, hookName);
      if (recheckHook?.includes(GitConstants.POST_COMMIT_HOOK_MARKER)) {
        this.logger.warn(GitMessages.CONCURRENT_HOOK_INSTALL_SKIPPED);
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
        this.logger.warn(GitMessages.FAILED_TO_INSTALL_HOOK, {
          error: err instanceof Error ? err.message : String(err),
        });
        return { installed: false };
      }

      this.logger.info(GitMessages.INSTALLED_POST_COMMIT_HOOK);
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
    this.logger.info(GitMessages.PACKED_SNAPSHOT_ONTO_BRANCH, { branchName });
  }

  /**
   * Cross-clone reconciliation (STOR-001 point 3). Holds the knowledge-branch lock so this can't
   * race a concurrent `packSnapshotToKnowledgeBranch()` (e.g. the post-commit hook's background
   * snapshot firing mid-reconciliation).
   */
  public async syncKnowledgeBranch(
    cwd: string,
    branchName: string = GitConstants.KNOWLEDGE_ROOT,
    remote: string = GitConstants.DEFAULT_REMOTE_NAME,
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
      this.logger.debug(GitMessages.NO_REMOTE_SKIP_RECONCILIATION, {
        branchName,
      });
      return { status: KnowledgeBranchSyncStatuses.NO_REMOTE };
    }

    const fetched = await this.tryFetchRemoteBranch(cwd, branchName, remote);
    if (!fetched) return { status: KnowledgeBranchSyncStatuses.NO_REMOTE };

    const remoteSha = await this.git.getRefSha(
      cwd,
      `${GitConstants.REMOTE_REF_PREFIX}${remote}/${branchName}`,
    );
    const localSha = await this.git.getBranchTipSha(cwd, branchName);

    return this.resolveBranchSyncOutcome(
      cwd,
      branchName,
      remote,
      localSha,
      remoteSha,
    );
  }

  /** Fetches the remote's copy of the knowledge branch, degrading gracefully (rather than
   *  throwing) on a transient network/remote failure so the caller (snapshot/hydrate) can keep
   *  working offline. */
  private async tryFetchRemoteBranch(
    cwd: string,
    branchName: string,
    remote: string,
  ): Promise<boolean> {
    try {
      await this.git.fetchRef(cwd, remote, branchName);
      return true;
    } catch (err) {
      this.logger.warn(GitMessages.FAILED_TO_FETCH_CONTINUING_OFFLINE, {
        branchName,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** Decides the sync outcome once both `localSha`/`remoteSha` are known: missing-side adoption,
   *  already-in-sync, fast-forward, or (falling through) genuine divergence. */
  private async resolveBranchSyncOutcome(
    cwd: string,
    branchName: string,
    remote: string,
    localSha: string | undefined,
    remoteSha: string | undefined,
  ): Promise<KnowledgeBranchSyncResult> {
    const shaResolution = await this.resolveMissingShaOutcome(
      cwd,
      branchName,
      remote,
      localSha,
      remoteSha,
    );
    if ("resolved" in shaResolution) return shaResolution.resolved;
    const { localSha: local, remoteSha: remoteTip } = shaResolution;

    if (local === remoteTip) {
      return {
        status: KnowledgeBranchSyncStatuses.UP_TO_DATE,
        branchTipSha: local,
      };
    }

    const fastForwardResult = await this.resolveFastForwardOutcome(
      cwd,
      branchName,
      remote,
      local,
      remoteTip,
    );
    if (fastForwardResult) return fastForwardResult;

    return this.mergeDivergedBranches(
      cwd,
      branchName,
      remote,
      local,
      remoteTip,
    );
  }

  /** Handles the two "one side has no commit yet" cases (adopting the other side outright).
   *  Returns the resolved sync result for those cases, or the narrowed (both-defined) shas so
   *  the caller can proceed to fast-forward/divergence handling. */
  private async resolveMissingShaOutcome(
    cwd: string,
    branchName: string,
    remote: string,
    localSha: string | undefined,
    remoteSha: string | undefined,
  ): Promise<
    | { resolved: KnowledgeBranchSyncResult }
    | { localSha: string; remoteSha: string }
  > {
    if (!remoteSha) {
      if (localSha) await this.pushQuietly(cwd, remote, branchName);
      return {
        resolved: {
          status: KnowledgeBranchSyncStatuses.PUSHED_LOCAL,
          branchTipSha: localSha,
        },
      };
    }
    if (!localSha) {
      await this.git.updateBranchRef(cwd, branchName, remoteSha);
      this.logger.info(GitMessages.ADOPTED_REMOTE_BRANCH, { branchName });
      return {
        resolved: {
          status: KnowledgeBranchSyncStatuses.FAST_FORWARDED_LOCAL,
          branchTipSha: remoteSha,
        },
      };
    }
    return { localSha, remoteSha };
  }

  /** Handles the two non-diverged, both-shas-defined cases: local is an ancestor of remote (fast
   *  forward local), or remote is an ancestor of local (push local). Returns `undefined` when
   *  neither holds (genuine divergence), for the caller to handle. */
  private async resolveFastForwardOutcome(
    cwd: string,
    branchName: string,
    remote: string,
    localSha: string,
    remoteSha: string,
  ): Promise<KnowledgeBranchSyncResult | undefined> {
    if (await this.git.isAncestor(cwd, localSha, remoteSha)) {
      await this.git.updateBranchRef(cwd, branchName, remoteSha);
      this.logger.info(GitMessages.FAST_FORWARDED_LOCAL_BRANCH, {
        branchName,
        remoteSha,
      });
      return {
        status: KnowledgeBranchSyncStatuses.FAST_FORWARDED_LOCAL,
        branchTipSha: remoteSha,
      };
    }
    if (await this.git.isAncestor(cwd, remoteSha, localSha)) {
      await this.pushQuietly(cwd, remote, branchName);
      return {
        status: KnowledgeBranchSyncStatuses.PUSHED_LOCAL,
        branchTipSha: localSha,
      };
    }
    return undefined;
  }

  /** True divergence — tree-adoption merge (STOR-001 point 3): create a 2-parent merge commit
   *  wholesale adopting the winning side's tree, rather than a content-level merge of both. */
  private async mergeDivergedBranches(
    cwd: string,
    branchName: string,
    remote: string,
    localSha: string,
    remoteSha: string,
  ): Promise<KnowledgeBranchSyncResult> {
    const winnerSha = await this.resolveMergeWinner(cwd, localSha, remoteSha);
    const winningTree = await this.git.getTreeSha(cwd, winnerSha);
    const mergeMessage = GitMessages.mergeCommitMessage(winnerSha === localSha);
    const mergeSha = await this.git.createMergeCommit(
      cwd,
      winningTree,
      [localSha, remoteSha],
      mergeMessage,
    );
    await this.git.updateBranchRef(cwd, branchName, mergeSha);
    await this.pushQuietly(cwd, remote, branchName);

    this.logger.info(GitMessages.MERGED_DIVERGED_BRANCH, {
      branchName,
      winner:
        winnerSha === localSha
          ? GitMessages.MERGE_WINNER_LOCAL
          : GitMessages.MERGE_WINNER_REMOTE,
      mergeSha,
    });
    return {
      status: KnowledgeBranchSyncStatuses.MERGED,
      branchTipSha: mergeSha,
    };
  }

  private async pushQuietly(
    cwd: string,
    remote: string,
    branchName: string,
  ): Promise<void> {
    try {
      await this.git.pushRef(cwd, remote, branchName);
    } catch (err) {
      this.logger.warn(GitMessages.FAILED_TO_PUSH_WILL_RETRY, {
        branchName,
        error: err instanceof Error ? err.message : String(err),
      });
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
   * `Snapshot [<7-char>]` subject for human-facing `git log --grep` lookup, plus a full 40-char
   * `Docuvia-Source` trailer for unambiguous machine lookup (STOR-001 point 4) — 7-char prefixes
   * can collide in large repositories. Falls back to an unstamped message on an unborn HEAD (a
   * freshly `git init`-ed source repo with no commits yet) rather than failing `snapshot`/`init`
   * outright over a missing stamp.
   */
  private async buildSnapshotCommitMessage(cwd: string): Promise<string> {
    const sourceSha = await this.git.getHeadSha(cwd);
    if (!sourceSha) return GitMessages.SNAPSHOT_UNKNOWN;
    return GitMessages.snapshotCommitMessage(sourceSha);
  }
}
