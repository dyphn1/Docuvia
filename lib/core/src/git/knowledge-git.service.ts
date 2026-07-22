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

/** Knowledge branch is a dedicated orphan branch of small, purpose-built commits — this comfortably bounds `resolveNewestSourceTrailerSha`'s log scan without truncating any real history (mirrors `HydrationService`'s identical scan-depth choice). */
const KNOWLEDGE_LOG_SCAN_LIMIT = 5000;

/** Escapes regex metacharacters in a literal string before embedding it in a `RegExp` — used by
 *  `DOCUVIA_HOOK_BLOCK_PATTERN` below (defensive; `DOCUVIA_HOOK_HEADER_COMMENT` itself carries no
 *  metacharacters today, but this keeps the pattern correct if that ever changes). */
function escapeRegExpLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `doctor --fix`'s marker-bounded extraction pattern (phase1-decision-integration.md §10d,
 * decision 1f): matches an optional immediately-preceding `#!...` shebang line, then the shared
 * `# Docuvia Knowledge Graph Evolver Hook` header comment, through the next standalone `fi` line,
 * inclusive — a whole Docuvia-authored hook block (shebang included), regardless of minor
 * hand-edits elsewhere in the block that would break `installPostCommitHook`'s exact-content-match
 * technique. The leading shebang must be captured too: every Docuvia-authored block
 * (`POST_COMMIT_HOOK_CONTENT`/`LEGACY_POST_COMMIT_HOOK_CONTENT`) carries its own `#!/bin/bash`
 * line immediately above the header comment, so a hand-edited-legacy-block file with two
 * un-merged blocks has two of them — stripping only the header-through-`fi` span (and not the
 * shebang line above it) would leave both as orphaned comment lines, on top of the third shebang
 * line the freshly-appended canonical block itself contributes. Reused (global-flagged) across
 * `repairDuplicatePostCommitHook` calls; `String.prototype.replace` resets a global regex's
 * `lastIndex` to 0 on every call, so this is safe to share.
 */
const DOCUVIA_HOOK_BLOCK_PATTERN = new RegExp(
  `(?:^#!.*\\n)?${escapeRegExpLiteral(GitConstants.DOCUVIA_HOOK_HEADER_COMMENT)}[\\s\\S]*?^fi$\\n?`,
  "gm",
);

/**
 * Docuvia's git-specific domain logic, built entirely on `IGitProvider`'s raw primitives — the
 * "generating knowledge branches" example named directly in
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Domain Core section. If
 * `lib/git-local` is ever swapped for another git implementation, this class is untouched.
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
   * Installs the post-commit hook that fires `docuvia analyze` after every commit (PLAT-007
   * Tier A; flipped from `docuvia snapshot` in Slice 2 dispatch 2b —
   * phase1-decision-integration.md §6c). A hook file still carrying the legacy `docuvia
   * snapshot` block is upgraded in place: the old block's exact content is removed and the new
   * block appended, preserving any non-Docuvia user content in the same file. Non-fatal by
   * design: `.git/hooks` may not exist (e.g. a bare repo, or `.git` mounted read-only), and a
   * broken hook shouldn't fail `init` itself.
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

      // Legacy upgrade (phase1-decision-integration.md §6c, Slice 2 dispatch 2b's hook flip): a
      // pre-2b installation has the old `docuvia snapshot` marker but not the new `docuvia
      // analyze` one. Replace the old Docuvia block in place — remove its exact content, then
      // append the new block — rather than appending a second, duplicate Docuvia block alongside
      // the old one. Re-checked inside the lock for the same TOCTOU reason as the marker check
      // above (PLAT-006).
      const hasLegacyHook = recheckHook?.includes(
        GitConstants.LEGACY_POST_COMMIT_HOOK_MARKER,
      );

      try {
        if (hasLegacyHook) {
          const upgradedHook =
            recheckHook!
              .split(GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT)
              .join("") + GitConstants.POST_COMMIT_HOOK_CONTENT;
          await this.git.writeHookFile(cwd, hookName, upgradedHook);
        } else {
          await this.git.appendHookFile(
            cwd,
            hookName,
            GitConstants.POST_COMMIT_HOOK_CONTENT,
          );
        }
        await this.git.makeHookExecutable(cwd, hookName);
      } catch (err) {
        // Non-fatal to init — a broken hook write shouldn't fail the whole workflow.
        this.logger.warn(GitMessages.FAILED_TO_INSTALL_HOOK, {
          error: err instanceof Error ? err.message : String(err),
        });
        return { installed: false };
      }

      this.logger.info(
        hasLegacyHook
          ? GitMessages.UPGRADED_LEGACY_POST_COMMIT_HOOK
          : GitMessages.INSTALLED_POST_COMMIT_HOOK,
      );
      return { installed: true };
    });
  }

  /**
   * Installs the pre-push hook that fires the Tier B batch plus `sync-knowledge`
   * (`docuvia analyze --escalate-to-lsp && docuvia snapshot && docuvia sync-knowledge`,
   * phase1-decision-integration.md §8h; phase2-sync-knowledge-scheduling.md SKSCHED-001). Mirrors
   * `installPostCommitHook`'s marker + lock shape; as of the `sync-knowledge` composition
   * (SKSCHED-003) a legacy-upgrade branch exists too, for a hook installed before that step was
   * added — same exact-content-match technique `installPostCommitHook` already uses. Non-fatal by
   * design, same reasoning as `installPostCommitHook`.
   */
  public async installPrePushHook(
    cwd: string,
  ): Promise<{ installed: boolean }> {
    const hookName = GitConstants.PRE_PUSH_HOOK_NAME;

    if (!(await this.git.hooksDirExists(cwd))) {
      this.logger.debug(GitMessages.NO_GIT_HOOKS_DIR);
      return { installed: false };
    }

    const existingHook = await this.git.readHookFile(cwd, hookName);
    if (this.hasCurrentPrePushHook(existingHook)) {
      this.logger.debug(GitMessages.PRE_PUSH_HOOK_ALREADY_INSTALLED);
      return { installed: false };
    }

    return withKnowledgeBranchLock(this.git, cwd, async () => {
      const recheckHook = await this.git.readHookFile(cwd, hookName);
      if (this.hasCurrentPrePushHook(recheckHook)) {
        this.logger.warn(GitMessages.CONCURRENT_PRE_PUSH_HOOK_INSTALL_SKIPPED);
        return { installed: false };
      }

      // SKSCHED-003: a hook carrying the pre-Phase-2 marker but not the sync-knowledge one is a
      // legacy installation -- replace its exact block in place rather than appending a second,
      // duplicate Docuvia block alongside it (mirrors installPostCommitHook's legacy upgrade).
      const hasLegacyOnly = !!recheckHook?.includes(
        GitConstants.PRE_PUSH_HOOK_MARKER,
      );

      try {
        if (hasLegacyOnly) {
          const upgradedHook =
            recheckHook!
              .split(GitConstants.LEGACY_PRE_PUSH_HOOK_CONTENT)
              .join("") + GitConstants.PRE_PUSH_HOOK_CONTENT;
          await this.git.writeHookFile(cwd, hookName, upgradedHook);
        } else {
          await this.git.appendHookFile(
            cwd,
            hookName,
            GitConstants.PRE_PUSH_HOOK_CONTENT,
          );
        }
        await this.git.makeHookExecutable(cwd, hookName);
      } catch (err) {
        this.logger.warn(GitMessages.FAILED_TO_INSTALL_PRE_PUSH_HOOK, {
          error: err instanceof Error ? err.message : String(err),
        });
        return { installed: false };
      }

      this.logger.info(
        hasLegacyOnly
          ? GitMessages.UPGRADED_LEGACY_PRE_PUSH_HOOK
          : GitMessages.INSTALLED_PRE_PUSH_HOOK,
      );
      return { installed: true };
    });
  }

  /** True once the hook carries both the Tier B marker and the sync-knowledge marker -- i.e. is
   *  fully up to date, not just "installed at some prior version" (SKSCHED-003). */
  private hasCurrentPrePushHook(hook: string | undefined): boolean {
    return (
      !!hook?.includes(GitConstants.PRE_PUSH_HOOK_MARKER) &&
      !!hook?.includes(GitConstants.PRE_PUSH_SYNC_KNOWLEDGE_MARKER)
    );
  }

  /**
   * `uninstall`'s symmetric counterpart to `installPostCommitHook`
   * (phase1-decision-integration.md §10a) — strips both the current and (if also present) legacy
   * Docuvia block content via the same exact-content-match technique the install path's legacy
   * upgrade already uses (decision 1f: this is the established, accepted, best-effort technique;
   * `doctor`'s detection/repair is the safety net for whatever a hand-edited block causes it to
   * miss). Preserves any non-Docuvia content in the file byte-for-byte; never deletes the file
   * itself (`IGitProvider` has no delete primitive). Non-fatal by design.
   */
  public async removePostCommitHook(
    cwd: string,
  ): Promise<{ removed: boolean }> {
    const hookName = GitConstants.POST_COMMIT_HOOK_NAME;

    const existingHook = await this.git.readHookFile(cwd, hookName);
    if (!this.hasAnyPostCommitMarker(existingHook)) {
      this.logger.debug(GitMessages.NO_POST_COMMIT_HOOK_TO_REMOVE);
      return { removed: false };
    }

    return withKnowledgeBranchLock(this.git, cwd, async () => {
      const recheckHook = await this.git.readHookFile(cwd, hookName);
      if (!this.hasAnyPostCommitMarker(recheckHook)) {
        return { removed: false };
      }

      try {
        let remainder = recheckHook!;
        if (remainder.includes(GitConstants.POST_COMMIT_HOOK_CONTENT)) {
          remainder = remainder
            .split(GitConstants.POST_COMMIT_HOOK_CONTENT)
            .join("");
        }
        if (remainder.includes(GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT)) {
          remainder = remainder
            .split(GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT)
            .join("");
        }
        await this.git.writeHookFile(cwd, hookName, remainder);
      } catch (err) {
        this.logger.warn(GitMessages.FAILED_TO_REMOVE_POST_COMMIT_HOOK, {
          error: err instanceof Error ? err.message : String(err),
        });
        return { removed: false };
      }

      this.logger.info(GitMessages.REMOVED_POST_COMMIT_HOOK);
      return { removed: true };
    });
  }

  private hasAnyPostCommitMarker(hook: string | undefined): boolean {
    return (
      !!hook?.includes(GitConstants.POST_COMMIT_HOOK_MARKER) ||
      !!hook?.includes(GitConstants.LEGACY_POST_COMMIT_HOOK_MARKER)
    );
  }

  /**
   * `uninstall`'s symmetric counterpart to `installPrePushHook`
   * (phase1-decision-integration.md §10a, decision 1a) — mirrors `removePostCommitHook`'s shape,
   * including its two-content-variant strip now that `installPrePushHook` has a legacy (pre
   * sync-knowledge) content variant of its own (SKSCHED-003). Non-fatal by design.
   */
  public async removePrePushHook(cwd: string): Promise<{ removed: boolean }> {
    const hookName = GitConstants.PRE_PUSH_HOOK_NAME;

    const existingHook = await this.git.readHookFile(cwd, hookName);
    if (!existingHook?.includes(GitConstants.PRE_PUSH_HOOK_MARKER)) {
      this.logger.debug(GitMessages.NO_PRE_PUSH_HOOK_TO_REMOVE);
      return { removed: false };
    }

    return withKnowledgeBranchLock(this.git, cwd, async () => {
      const recheckHook = await this.git.readHookFile(cwd, hookName);
      if (!recheckHook?.includes(GitConstants.PRE_PUSH_HOOK_MARKER)) {
        return { removed: false };
      }

      try {
        let remainder = recheckHook;
        if (remainder.includes(GitConstants.PRE_PUSH_HOOK_CONTENT)) {
          remainder = remainder
            .split(GitConstants.PRE_PUSH_HOOK_CONTENT)
            .join("");
        }
        if (remainder.includes(GitConstants.LEGACY_PRE_PUSH_HOOK_CONTENT)) {
          remainder = remainder
            .split(GitConstants.LEGACY_PRE_PUSH_HOOK_CONTENT)
            .join("");
        }
        await this.git.writeHookFile(cwd, hookName, remainder);
      } catch (err) {
        this.logger.warn(GitMessages.FAILED_TO_REMOVE_PRE_PUSH_HOOK, {
          error: err instanceof Error ? err.message : String(err),
        });
        return { removed: false };
      }

      this.logger.info(GitMessages.REMOVED_PRE_PUSH_HOOK);
      return { removed: true };
    });
  }

  /**
   * `doctor --fix`'s explicit, opt-in repair of the legacy-hook duplicate-block case
   * (phase1-decision-integration.md §10d, decision 1f) — unlike `removePostCommitHook`'s
   * exact-content-match technique, this uses a marker-bounded extraction
   * (`DOCUVIA_HOOK_BLOCK_PATTERN`) anchored on the shared header comment through the matching
   * standalone `fi` line, so it correctly strips every Docuvia-authored block even when one of
   * them has been hand-edited (the exact scenario that created the duplicate in the first place).
   * Re-checks (TOCTOU-safe) inside the lock that the duplicate condition still holds before
   * writing anything — never silently mutates a healthy hook.
   */
  public async repairDuplicatePostCommitHook(
    cwd: string,
  ): Promise<{ repaired: boolean }> {
    const hookName = GitConstants.POST_COMMIT_HOOK_NAME;

    return withKnowledgeBranchLock(this.git, cwd, async () => {
      const recheckHook = await this.git.readHookFile(cwd, hookName);
      const hasBothMarkers =
        recheckHook?.includes(GitConstants.POST_COMMIT_HOOK_MARKER) &&
        recheckHook?.includes(GitConstants.LEGACY_POST_COMMIT_HOOK_MARKER);
      if (!recheckHook || !hasBothMarkers) {
        this.logger.debug(GitMessages.NOTHING_TO_REPAIR);
        return { repaired: false };
      }

      try {
        const stripped = recheckHook.replace(DOCUVIA_HOOK_BLOCK_PATTERN, "");
        const repaired = stripped + GitConstants.POST_COMMIT_HOOK_CONTENT;
        await this.git.writeHookFile(cwd, hookName, repaired);
      } catch (err) {
        this.logger.warn(GitMessages.FAILED_TO_INSTALL_HOOK, {
          error: err instanceof Error ? err.message : String(err),
        });
        return { repaired: false };
      }

      this.logger.info(GitMessages.REPAIRED_DUPLICATE_POST_COMMIT_HOOK);
      return { repaired: true };
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
   *  working offline. The remote simply not having this branch yet (a brand-new project's first
   *  sync) is a distinct, expected outcome, not a failure -- reported as `true` so `reconcile()`
   *  proceeds to `getRefSha`, which naturally returns `undefined` for a remote-tracking ref that
   *  was never created, letting `resolveMissingShaOutcome`'s existing "no remote sha yet -> push
   *  local" branch run instead of this being misreported as offline. */
  private async tryFetchRemoteBranch(
    cwd: string,
    branchName: string,
    remote: string,
  ): Promise<boolean> {
    try {
      await this.git.fetchRef(cwd, remote, branchName);
      return true;
    } catch (err) {
      if (this.isRemoteRefMissingError(err)) {
        this.logger.info(
          GitMessages.REMOTE_KNOWLEDGE_BRANCH_NOT_YET_ON_REMOTE,
          { branchName },
        );
        return true;
      }
      this.logger.warn(GitMessages.FAILED_TO_FETCH_CONTINUING_OFFLINE, {
        branchName,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** Distinguishes git's stable "ref doesn't exist on that remote" message from any other fetch
   *  failure (network timeout, auth failure, DNS, ...) -- see `tryFetchRemoteBranch`'s doc
   *  comment for why this distinction matters. */
  private isRemoteRefMissingError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes(GitMessages.REMOTE_REF_NOT_FOUND_TEXT);
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
    if (!sourceSha) return GitMessages.SNAPSHOT_UNKNOWN;
    return GitMessages.snapshotCommitMessage(sourceSha);
  }
}
