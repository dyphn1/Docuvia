import { describe, it, expect, vi } from "vitest";
import type { IGitProvider } from "@workspace/contracts";
import { createMockLogger } from "@workspace/contracts";
import { KnowledgeGitService } from "./knowledge-git.service.js";
import { GitConstants } from "@workspace/contracts";

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(false),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    commitEmptyTree: vi.fn().mockResolvedValue("deadbeef"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(true),
    resolveHooksDir: vi.fn().mockResolvedValue("/workspace/.git/hooks"),
    readHookFile: vi.fn().mockResolvedValue(undefined),
    appendHookFile: vi.fn().mockResolvedValue(undefined),
    writeHookFile: vi.fn().mockResolvedValue(undefined),
    makeHookExecutable: vi.fn().mockResolvedValue(undefined),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    listWorktrees: vi.fn().mockResolvedValue([]),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getChangedLineRanges: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    getHeadSha: vi
      .fn()
      .mockResolvedValue("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"),
    getBranchTipSha: vi.fn().mockResolvedValue(undefined),
    readFileAtRef: vi.fn().mockResolvedValue(undefined),
    listFilesAtRef: vi.fn().mockResolvedValue([]),
    getCommitLog: vi.fn().mockResolvedValue([]),
    getCommitAncestry: vi.fn().mockResolvedValue([]),
    packDirectoryToBranch: vi.fn().mockResolvedValue(undefined),
    fetchRef: vi.fn().mockResolvedValue(undefined),
    pushRef: vi.fn().mockResolvedValue(undefined),
    getRefSha: vi.fn().mockResolvedValue(undefined),
    isAncestor: vi.fn().mockResolvedValue(false),
    getTreeSha: vi.fn().mockResolvedValue("tree-sha"),
    getCommitTimestamp: vi.fn().mockResolvedValue(0),
    createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
    acquireKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    releaseKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("KnowledgeGitService.ensureKnowledgeBranch()", () => {
  it("creates the branch via the same packDirectoryToBranch mechanism as snapshot, stamped with the source HEAD hash, when it does not already exist", async () => {
    const git = makeMockGitProvider({
      branchExists: vi.fn().mockResolvedValue(false),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.ensureKnowledgeBranch("/workspace");

    expect(result).toEqual({ created: true });
    expect(git.commitEmptyTree).not.toHaveBeenCalled();
    expect(git.updateBranchRef).not.toHaveBeenCalled();
    expect(git.packDirectoryToBranch).toHaveBeenCalledTimes(1);
    const [cwd, sourceDir, branchName, commitMessage] = (
      git.packDirectoryToBranch as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(cwd).toBe("/workspace");
    expect(typeof sourceDir).toBe("string");
    expect(branchName).toBe(GitConstants.KNOWLEDGE_ROOT);
    expect(commitMessage).toBe(
      "Snapshot [a1b2c3d]\n\nDocuvia-Source: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    );
  });

  it("is idempotent: does not create a commit when the branch already exists", async () => {
    const git = makeMockGitProvider({
      branchExists: vi.fn().mockResolvedValue(true),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.ensureKnowledgeBranch("/workspace");

    expect(result).toEqual({ created: false });
    expect(git.packDirectoryToBranch).not.toHaveBeenCalled();
  });

  it("propagates a failure from the underlying git provider (fatal to init)", async () => {
    const git = makeMockGitProvider({
      packDirectoryToBranch: vi
        .fn()
        .mockRejectedValue(new Error("git fast-import failed")),
    });
    const service = new KnowledgeGitService(git);

    await expect(service.ensureKnowledgeBranch("/workspace")).rejects.toThrow(
      "git fast-import failed",
    );
  });

  it("PLAT-006: re-checks inside the lock and skips a duplicate initial commit when a concurrent process created the branch in between", async () => {
    // First check (before the lock) sees no branch; the re-check (after acquiring the lock)
    // sees it now exists — simulating a second process winning the race in between.
    const branchExists = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const git = makeMockGitProvider({ branchExists });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.ensureKnowledgeBranch("/workspace");

    expect(result).toEqual({ created: false });
    expect(git.packDirectoryToBranch).not.toHaveBeenCalled();
    expect(git.acquireKnowledgeLock).toHaveBeenCalledTimes(1);
    expect(git.releaseKnowledgeLock).toHaveBeenCalledTimes(1);
    expect(
      logger.events.some(
        (e) => e.level === "warn" && /concurrent process/.test(e.message),
      ),
    ).toBe(true);
  });
});

describe("KnowledgeGitService.installPostCommitHook()", () => {
  it("installs the hook when .git/hooks exists and no marker is present yet", async () => {
    const git = makeMockGitProvider();
    const service = new KnowledgeGitService(git);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: true });
    expect(git.appendHookFile).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.POST_COMMIT_HOOK_NAME,
      GitConstants.POST_COMMIT_HOOK_CONTENT,
    );
    expect(git.makeHookExecutable).toHaveBeenCalled();
  });

  it("does not install (non-fatal) when .git/hooks does not exist", async () => {
    const git = makeMockGitProvider({
      hooksDirExists: vi.fn().mockResolvedValue(false),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(git.appendHookFile).not.toHaveBeenCalled();
  });

  it("is idempotent: does not duplicate the hook when the current content is already present", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi
        .fn()
        .mockResolvedValue(
          `#!/bin/bash\n${GitConstants.POST_COMMIT_HOOK_CONTENT}\n`,
        ),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(git.appendHookFile).not.toHaveBeenCalled();
  });

  it("does not throw when writing the hook fails — logs a warning and reports installed:false instead", async () => {
    const git = makeMockGitProvider({
      appendHookFile: vi.fn().mockRejectedValue(new Error("EACCES")),
    });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });

  it("PLAT-006: re-checks inside the lock and skips a duplicate append when a concurrent process installed the hook in between", async () => {
    // First check (before the lock) sees no marker; the re-check (after acquiring the lock)
    // sees it now present — simulating a second process winning the race in between.
    const readHookFile = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(
        `#!/bin/bash\n${GitConstants.POST_COMMIT_HOOK_CONTENT}\n`,
      );
    const git = makeMockGitProvider({ readHookFile });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(git.appendHookFile).not.toHaveBeenCalled();
    expect(git.acquireKnowledgeLock).toHaveBeenCalledTimes(1);
    expect(git.releaseKnowledgeLock).toHaveBeenCalledTimes(1);
    expect(
      logger.events.some(
        (e) => e.level === "warn" && /concurrent process/.test(e.message),
      ),
    ).toBe(true);
  });

  describe("legacy hook upgrade (docuvia snapshot -> docuvia analyze, phase1-decision-integration.md §6c)", () => {
    it("replaces the legacy block in place: old block gone, new block present, non-Docuvia user content preserved", async () => {
      const existingHook =
        `#!/bin/bash\necho "user pre-commit-style content"\n` +
        GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT;
      const git = makeMockGitProvider({
        readHookFile: vi.fn().mockResolvedValue(existingHook),
      });
      const logger = createMockLogger();
      const service = new KnowledgeGitService(git, logger);

      const result = await service.installPostCommitHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.appendHookFile).not.toHaveBeenCalled();
      expect(git.writeHookFile).toHaveBeenCalledTimes(1);
      const [cwd, hookName, writtenContent] = (
        git.writeHookFile as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(cwd).toBe("/workspace");
      expect(hookName).toBe(GitConstants.POST_COMMIT_HOOK_NAME);

      // Old block gone (its exact legacy content is no longer present).
      expect(writtenContent).not.toContain(
        GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT,
      );
      expect(writtenContent).not.toContain(
        GitConstants.LEGACY_POST_COMMIT_HOOK_MARKER,
      );
      // New block present.
      expect(writtenContent).toContain(GitConstants.POST_COMMIT_HOOK_CONTENT);
      // Non-Docuvia user content preserved.
      expect(writtenContent).toContain('echo "user pre-commit-style content"');

      expect(git.makeHookExecutable).toHaveBeenCalled();
      expect(
        logger.events.some(
          (e) =>
            e.level === "info" &&
            /Upgraded legacy post-commit hook/.test(e.message),
        ),
      ).toBe(true);
    });

    it("upgrades a legacy hook with no other user content (old block was the entire file)", async () => {
      const git = makeMockGitProvider({
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT),
      });
      const service = new KnowledgeGitService(git);

      const result = await service.installPostCommitHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.writeHookFile).toHaveBeenCalledWith(
        "/workspace",
        GitConstants.POST_COMMIT_HOOK_NAME,
        GitConstants.POST_COMMIT_HOOK_CONTENT,
      );
    });

    it("PLAT-006: re-checks inside the lock and skips the legacy upgrade when a concurrent process already upgraded it in between", async () => {
      // First check (before the lock) sees only the legacy marker; the re-check (after acquiring
      // the lock) sees the new marker already present — simulating a second process winning the
      // upgrade race in between.
      const readHookFile = vi
        .fn()
        .mockResolvedValueOnce(GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT)
        .mockResolvedValueOnce(GitConstants.POST_COMMIT_HOOK_CONTENT);
      const git = makeMockGitProvider({ readHookFile });
      const logger = createMockLogger();
      const service = new KnowledgeGitService(git, logger);

      const result = await service.installPostCommitHook("/workspace");

      expect(result).toEqual({ installed: false });
      expect(git.writeHookFile).not.toHaveBeenCalled();
      expect(git.appendHookFile).not.toHaveBeenCalled();
      expect(git.acquireKnowledgeLock).toHaveBeenCalledTimes(1);
      expect(git.releaseKnowledgeLock).toHaveBeenCalledTimes(1);
      expect(
        logger.events.some(
          (e) => e.level === "warn" && /concurrent process/.test(e.message),
        ),
      ).toBe(true);
    });

    it("does not throw when the legacy-upgrade write fails — logs a warning and reports installed:false instead", async () => {
      const git = makeMockGitProvider({
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT),
        writeHookFile: vi.fn().mockRejectedValue(new Error("EACCES")),
      });
      const logger = createMockLogger();
      const service = new KnowledgeGitService(git, logger);

      const result = await service.installPostCommitHook("/workspace");

      expect(result).toEqual({ installed: false });
      expect(logger.events.some((e) => e.level === "warn")).toBe(true);
    });
  });

  describe("flush-l3 hook upgrade (docuvia analyze --flush-staged-l3 step, issue #42 §8.3)", () => {
    it("replaces the pre-flush-l3 block in place: old block gone, new block (with the flush step) present, non-Docuvia user content preserved, content-for-content not appended as a duplicate", async () => {
      const existingHook =
        `#!/bin/bash\necho "user pre-commit-style content"\n` +
        GitConstants.PRE_FLUSH_L3_POST_COMMIT_HOOK_CONTENT;
      const git = makeMockGitProvider({
        readHookFile: vi.fn().mockResolvedValue(existingHook),
      });
      const logger = createMockLogger();
      const service = new KnowledgeGitService(git, logger);

      const result = await service.installPostCommitHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.appendHookFile).not.toHaveBeenCalled();
      expect(git.writeHookFile).toHaveBeenCalledTimes(1);
      const [cwd, hookName, writtenContent] = (
        git.writeHookFile as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(cwd).toBe("/workspace");
      expect(hookName).toBe(GitConstants.POST_COMMIT_HOOK_NAME);

      expect(writtenContent).not.toContain(
        GitConstants.PRE_FLUSH_L3_POST_COMMIT_HOOK_CONTENT,
      );
      expect(writtenContent).toContain(GitConstants.POST_COMMIT_HOOK_CONTENT);
      expect(writtenContent).toContain(
        GitConstants.POST_COMMIT_FLUSH_L3_MARKER,
      );
      expect(writtenContent).toContain('echo "user pre-commit-style content"');

      expect(git.makeHookExecutable).toHaveBeenCalled();
      expect(
        logger.events.some(
          (e) =>
            e.level === "info" &&
            /Upgraded post-commit hook \(added flush-staged-l3 step/.test(
              e.message,
            ),
        ),
      ).toBe(true);
    });

    it("upgrades a pre-flush-l3 hook with no other user content (old block was the entire file)", async () => {
      const git = makeMockGitProvider({
        readHookFile: vi
          .fn()
          .mockResolvedValue(
            GitConstants.PRE_FLUSH_L3_POST_COMMIT_HOOK_CONTENT,
          ),
      });
      const service = new KnowledgeGitService(git);

      const result = await service.installPostCommitHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.writeHookFile).toHaveBeenCalledWith(
        "/workspace",
        GitConstants.POST_COMMIT_HOOK_NAME,
        GitConstants.POST_COMMIT_HOOK_CONTENT,
      );
    });
  });

  describe("nohup hook upgrade (issue #58)", () => {
    it("replaces the pre-nohup block in place: old block gone, new nohup block present, non-Docuvia user content preserved", async () => {
      const existingHook =
        `#!/bin/bash\necho "user pre-commit-style content"\n` +
        GitConstants.PRE_NOHUP_POST_COMMIT_HOOK_CONTENT;
      const git = makeMockGitProvider({
        readHookFile: vi.fn().mockResolvedValue(existingHook),
      });
      const logger = createMockLogger();
      const service = new KnowledgeGitService(git, logger);

      const result = await service.installPostCommitHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.appendHookFile).not.toHaveBeenCalled();
      expect(git.writeHookFile).toHaveBeenCalledTimes(1);
      const [cwd, hookName, writtenContent] = (
        git.writeHookFile as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(cwd).toBe("/workspace");
      expect(hookName).toBe(GitConstants.POST_COMMIT_HOOK_NAME);

      // Old block gone (its exact pre-nohup content is no longer present).
      expect(writtenContent).not.toContain(
        GitConstants.PRE_NOHUP_POST_COMMIT_HOOK_CONTENT,
      );
      // New block present.
      expect(writtenContent).toContain(GitConstants.POST_COMMIT_HOOK_CONTENT);
      // Non-Docuvia user content preserved.
      expect(writtenContent).toContain('echo "user pre-commit-style content"');

      expect(git.makeHookExecutable).toHaveBeenCalled();
      expect(
        logger.events.some(
          (e) =>
            e.level === "info" &&
            /Upgraded post-commit hook \(nohup/.test(e.message),
        ),
      ).toBe(true);
    });

    it("upgrades a pre-nohup hook with no other user content (old block was the entire file)", async () => {
      const git = makeMockGitProvider({
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.PRE_NOHUP_POST_COMMIT_HOOK_CONTENT),
      });
      const service = new KnowledgeGitService(git);

      const result = await service.installPostCommitHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.writeHookFile).toHaveBeenCalledWith(
        "/workspace",
        GitConstants.POST_COMMIT_HOOK_NAME,
        GitConstants.POST_COMMIT_HOOK_CONTENT,
      );
    });
  });
});

describe("KnowledgeGitService.installPrePushHook() (phase1-decision-integration.md §8h)", () => {
  it("installs the hook when .git/hooks exists and no marker is present yet", async () => {
    const git = makeMockGitProvider();
    const service = new KnowledgeGitService(git);

    const result = await service.installPrePushHook("/workspace");

    expect(result).toEqual({ installed: true });
    expect(git.appendHookFile).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.PRE_PUSH_HOOK_NAME,
      GitConstants.PRE_PUSH_HOOK_CONTENT,
    );
    expect(git.makeHookExecutable).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.PRE_PUSH_HOOK_NAME,
    );
  });

  it("does not install (non-fatal) when .git/hooks does not exist", async () => {
    const git = makeMockGitProvider({
      hooksDirExists: vi.fn().mockResolvedValue(false),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.installPrePushHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(git.appendHookFile).not.toHaveBeenCalled();
  });

  it("is idempotent: does not duplicate the hook when the Tier B, sync-knowledge, env-gate, and hooks-check markers are all already present", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi
        .fn()
        .mockResolvedValue(
          `#!/bin/bash\n${GitConstants.PRE_PUSH_HOOK_MARKER} ${GitConstants.PRE_PUSH_ENV_GATE_MARKER}\n${GitConstants.PRE_PUSH_SYNC_KNOWLEDGE_MARKER}\n${GitConstants.PRE_PUSH_HOOKS_CHECK_MARKER}\n`,
        ),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.installPrePushHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(git.appendHookFile).not.toHaveBeenCalled();
    expect(git.writeHookFile).not.toHaveBeenCalled();
  });

  it("does not throw when writing the hook fails — logs a warning and reports installed:false instead", async () => {
    const git = makeMockGitProvider({
      appendHookFile: vi.fn().mockRejectedValue(new Error("EACCES")),
    });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.installPrePushHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });

  it("PLAT-006: re-checks inside the lock and skips a duplicate append when a concurrent process installed the hook in between", async () => {
    const readHookFile = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(
        `#!/bin/bash\n${GitConstants.PRE_PUSH_HOOK_MARKER} ${GitConstants.PRE_PUSH_ENV_GATE_MARKER}\n${GitConstants.PRE_PUSH_SYNC_KNOWLEDGE_MARKER}\n${GitConstants.PRE_PUSH_HOOKS_CHECK_MARKER}\n`,
      );
    const git = makeMockGitProvider({ readHookFile });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.installPrePushHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(git.appendHookFile).not.toHaveBeenCalled();
    expect(git.acquireKnowledgeLock).toHaveBeenCalledTimes(1);
    expect(git.releaseKnowledgeLock).toHaveBeenCalledTimes(1);
  });

  describe("legacy hook upgrade (sync-knowledge composition, phase2-sync-knowledge-scheduling.md SKSCHED-003)", () => {
    it("replaces the legacy block in place: old block gone, new block (with sync-knowledge) present, non-Docuvia user content preserved", async () => {
      const existingHook =
        `#!/bin/bash\necho "user pre-push content"\n` +
        GitConstants.LEGACY_PRE_PUSH_HOOK_CONTENT;
      const git = makeMockGitProvider({
        readHookFile: vi.fn().mockResolvedValue(existingHook),
      });
      const logger = createMockLogger();
      const service = new KnowledgeGitService(git, logger);

      const result = await service.installPrePushHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.appendHookFile).not.toHaveBeenCalled();
      expect(git.writeHookFile).toHaveBeenCalledTimes(1);
      const [cwd, hookName, writtenContent] = (
        git.writeHookFile as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(cwd).toBe("/workspace");
      expect(hookName).toBe(GitConstants.PRE_PUSH_HOOK_NAME);

      expect(writtenContent).not.toContain(
        GitConstants.LEGACY_PRE_PUSH_HOOK_CONTENT,
      );
      expect(writtenContent).toContain(GitConstants.PRE_PUSH_HOOK_CONTENT);
      expect(writtenContent).toContain(
        GitConstants.PRE_PUSH_SYNC_KNOWLEDGE_MARKER,
      );
      expect(writtenContent).toContain('echo "user pre-push content"');

      expect(git.makeHookExecutable).toHaveBeenCalled();
      expect(
        logger.events.some(
          (e) =>
            e.level === "info" &&
            /Upgraded legacy pre-push hook/.test(e.message),
        ),
      ).toBe(true);
    });

    it("upgrades a legacy hook with no other user content (old block was the entire file)", async () => {
      const git = makeMockGitProvider({
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.LEGACY_PRE_PUSH_HOOK_CONTENT),
      });
      const service = new KnowledgeGitService(git);

      const result = await service.installPrePushHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.writeHookFile).toHaveBeenCalledWith(
        "/workspace",
        GitConstants.PRE_PUSH_HOOK_NAME,
        GitConstants.PRE_PUSH_HOOK_CONTENT,
      );
    });

    it("does not throw when the legacy-upgrade write fails — logs a warning and reports installed:false instead", async () => {
      const git = makeMockGitProvider({
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.LEGACY_PRE_PUSH_HOOK_CONTENT),
        writeHookFile: vi.fn().mockRejectedValue(new Error("EACCES")),
      });
      const logger = createMockLogger();
      const service = new KnowledgeGitService(git, logger);

      const result = await service.installPrePushHook("/workspace");

      expect(result).toEqual({ installed: false });
      expect(logger.events.some((e) => e.level === "warn")).toBe(true);
    });
  });

  describe("env-gate hook upgrade (--fallback-ast for D2's non-interactive gate, 2026-07 C#/TS benchmark environment-detection follow-up)", () => {
    it("replaces the sync-knowledge-era block in place: old block gone, new block (with --fallback-ast) present, non-Docuvia user content preserved", async () => {
      const existingHook =
        `#!/bin/bash\necho "user pre-push content"\n` +
        GitConstants.SYNC_KNOWLEDGE_PRE_PUSH_HOOK_CONTENT;
      const git = makeMockGitProvider({
        readHookFile: vi.fn().mockResolvedValue(existingHook),
      });
      const logger = createMockLogger();
      const service = new KnowledgeGitService(git, logger);

      const result = await service.installPrePushHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.appendHookFile).not.toHaveBeenCalled();
      expect(git.writeHookFile).toHaveBeenCalledTimes(1);
      const [cwd, hookName, writtenContent] = (
        git.writeHookFile as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(cwd).toBe("/workspace");
      expect(hookName).toBe(GitConstants.PRE_PUSH_HOOK_NAME);

      expect(writtenContent).not.toContain(
        GitConstants.SYNC_KNOWLEDGE_PRE_PUSH_HOOK_CONTENT,
      );
      expect(writtenContent).toContain(GitConstants.PRE_PUSH_HOOK_CONTENT);
      expect(writtenContent).toContain(GitConstants.PRE_PUSH_ENV_GATE_MARKER);
      expect(writtenContent).toContain('echo "user pre-push content"');

      expect(git.makeHookExecutable).toHaveBeenCalled();
      expect(
        logger.events.some(
          (e) =>
            e.level === "info" &&
            /Upgraded legacy pre-push hook/.test(e.message),
        ),
      ).toBe(true);
    });

    it("upgrades a sync-knowledge-era hook with no other user content (old block was the entire file)", async () => {
      const git = makeMockGitProvider({
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.SYNC_KNOWLEDGE_PRE_PUSH_HOOK_CONTENT),
      });
      const service = new KnowledgeGitService(git);

      const result = await service.installPrePushHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.writeHookFile).toHaveBeenCalledWith(
        "/workspace",
        GitConstants.PRE_PUSH_HOOK_NAME,
        GitConstants.PRE_PUSH_HOOK_CONTENT,
      );
    });
  });

  describe("hooks-check hook upgrade (docuvia hooks check tier-b-c-prepush gate, issue #42 §7.5)", () => {
    it("replaces the env-gate-era block in place: old block gone, new block (with the hooks-check gate) present, non-Docuvia user content preserved", async () => {
      const existingHook =
        `#!/bin/bash\necho "user pre-push content"\n` +
        GitConstants.ENV_GATE_PRE_PUSH_HOOK_CONTENT;
      const git = makeMockGitProvider({
        readHookFile: vi.fn().mockResolvedValue(existingHook),
      });
      const logger = createMockLogger();
      const service = new KnowledgeGitService(git, logger);

      const result = await service.installPrePushHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.appendHookFile).not.toHaveBeenCalled();
      expect(git.writeHookFile).toHaveBeenCalledTimes(1);
      const [cwd, hookName, writtenContent] = (
        git.writeHookFile as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(cwd).toBe("/workspace");
      expect(hookName).toBe(GitConstants.PRE_PUSH_HOOK_NAME);

      expect(writtenContent).not.toContain(
        GitConstants.ENV_GATE_PRE_PUSH_HOOK_CONTENT,
      );
      expect(writtenContent).toContain(GitConstants.PRE_PUSH_HOOK_CONTENT);
      expect(writtenContent).toContain(
        GitConstants.PRE_PUSH_HOOKS_CHECK_MARKER,
      );
      expect(writtenContent).toContain('echo "user pre-push content"');

      expect(git.makeHookExecutable).toHaveBeenCalled();
      expect(
        logger.events.some(
          (e) =>
            e.level === "info" &&
            /Upgraded legacy pre-push hook/.test(e.message),
        ),
      ).toBe(true);
    });

    it("upgrades an env-gate-era hook with no other user content (old block was the entire file), content-for-content not appended as a duplicate block", async () => {
      const git = makeMockGitProvider({
        readHookFile: vi
          .fn()
          .mockResolvedValue(GitConstants.ENV_GATE_PRE_PUSH_HOOK_CONTENT),
      });
      const service = new KnowledgeGitService(git);

      const result = await service.installPrePushHook("/workspace");

      expect(result).toEqual({ installed: true });
      expect(git.writeHookFile).toHaveBeenCalledWith(
        "/workspace",
        GitConstants.PRE_PUSH_HOOK_NAME,
        GitConstants.PRE_PUSH_HOOK_CONTENT,
      );
    });
  });
});

describe("KnowledgeGitService.removePostCommitHook() (phase1-decision-integration.md §10a)", () => {
  it("strips the current-marker block and preserves unrelated user content", async () => {
    const existingHook =
      `#!/bin/bash\necho "user content"\n` +
      GitConstants.POST_COMMIT_HOOK_CONTENT;
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(existingHook),
    });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.removePostCommitHook("/workspace");

    expect(result).toEqual({ removed: true });
    expect(git.writeHookFile).toHaveBeenCalledTimes(1);
    const [cwd, hookName, writtenContent] = (
      git.writeHookFile as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(cwd).toBe("/workspace");
    expect(hookName).toBe(GitConstants.POST_COMMIT_HOOK_NAME);
    expect(writtenContent).not.toContain(GitConstants.POST_COMMIT_HOOK_MARKER);
    expect(writtenContent).toContain('echo "user content"');
  });

  it("strips both current and legacy blocks when both are present", async () => {
    const existingHook =
      GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT +
      GitConstants.POST_COMMIT_HOOK_CONTENT;
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(existingHook),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.removePostCommitHook("/workspace");

    expect(result).toEqual({ removed: true });
    const writtenContent = (git.writeHookFile as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(writtenContent).not.toContain(
      GitConstants.LEGACY_POST_COMMIT_HOOK_MARKER,
    );
    expect(writtenContent).not.toContain(GitConstants.POST_COMMIT_HOOK_MARKER);
  });

  it("strips a pre-flush-l3-era (issue #42 §8.3) block and preserves unrelated user content", async () => {
    const existingHook =
      `#!/bin/bash\necho "user content"\n` +
      GitConstants.PRE_FLUSH_L3_POST_COMMIT_HOOK_CONTENT;
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(existingHook),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.removePostCommitHook("/workspace");

    expect(result).toEqual({ removed: true });
    const writtenContent = (git.writeHookFile as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(writtenContent).not.toContain(GitConstants.POST_COMMIT_HOOK_MARKER);
    expect(writtenContent).toContain('echo "user content"');
  });

  it("is a clean no-op when no Docuvia hook is present", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.removePostCommitHook("/workspace");

    expect(result).toEqual({ removed: false });
    expect(git.writeHookFile).not.toHaveBeenCalled();
  });

  it("is a clean no-op when the hook file has no Docuvia marker at all", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi
        .fn()
        .mockResolvedValue('#!/bin/bash\necho "unrelated"\n'),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.removePostCommitHook("/workspace");

    expect(result).toEqual({ removed: false });
    expect(git.writeHookFile).not.toHaveBeenCalled();
  });

  it("does not throw when the write fails — logs a warning and reports removed:false instead", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi
        .fn()
        .mockResolvedValue(GitConstants.POST_COMMIT_HOOK_CONTENT),
      writeHookFile: vi.fn().mockRejectedValue(new Error("EACCES")),
    });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.removePostCommitHook("/workspace");

    expect(result).toEqual({ removed: false });
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });

  it("reuses the knowledge-branch lock", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi
        .fn()
        .mockResolvedValue(GitConstants.POST_COMMIT_HOOK_CONTENT),
    });
    const service = new KnowledgeGitService(git);

    await service.removePostCommitHook("/workspace");

    expect(git.acquireKnowledgeLock).toHaveBeenCalledTimes(1);
    expect(git.releaseKnowledgeLock).toHaveBeenCalledTimes(1);
  });
});

describe("KnowledgeGitService.deleteKnowledgeBranch() (uninstall's teardown of the hidden branch)", () => {
  it("deletes the branch when it exists", async () => {
    const git = makeMockGitProvider({
      branchExists: vi.fn().mockResolvedValue(true),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.deleteKnowledgeBranch("/workspace");

    expect(result).toEqual({ deleted: true });
    expect(git.deleteBranch).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.KNOWLEDGE_ROOT,
    );
  });

  it("is a clean no-op when the branch doesn't exist", async () => {
    const git = makeMockGitProvider({
      branchExists: vi.fn().mockResolvedValue(false),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.deleteKnowledgeBranch("/workspace");

    expect(result).toEqual({ deleted: false });
    expect(git.deleteBranch).not.toHaveBeenCalled();
  });

  it("does not throw when the delete fails — logs a warning and reports deleted:false instead", async () => {
    const git = makeMockGitProvider({
      branchExists: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockRejectedValue(new Error("EACCES")),
    });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.deleteKnowledgeBranch("/workspace");

    expect(result).toEqual({ deleted: false });
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });
});

describe("KnowledgeGitService.removePrePushHook() (phase1-decision-integration.md §10a)", () => {
  it("strips the pre-push block and preserves unrelated user content", async () => {
    const existingHook =
      `#!/bin/bash\necho "user content"\n` + GitConstants.PRE_PUSH_HOOK_CONTENT;
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(existingHook),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.removePrePushHook("/workspace");

    expect(result).toEqual({ removed: true });
    const writtenContent = (git.writeHookFile as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(writtenContent).not.toContain(GitConstants.PRE_PUSH_HOOK_MARKER);
    expect(writtenContent).toContain('echo "user content"');
  });

  it("strips a legacy (pre sync-knowledge) pre-push block and preserves unrelated user content", async () => {
    const existingHook =
      `#!/bin/bash\necho "user content"\n` +
      GitConstants.LEGACY_PRE_PUSH_HOOK_CONTENT;
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(existingHook),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.removePrePushHook("/workspace");

    expect(result).toEqual({ removed: true });
    const writtenContent = (git.writeHookFile as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(writtenContent).not.toContain(GitConstants.PRE_PUSH_HOOK_MARKER);
    expect(writtenContent).toContain('echo "user content"');
  });

  it("strips a sync-knowledge-era (pre env-gate) pre-push block and preserves unrelated user content", async () => {
    const existingHook =
      `#!/bin/bash\necho "user content"\n` +
      GitConstants.SYNC_KNOWLEDGE_PRE_PUSH_HOOK_CONTENT;
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(existingHook),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.removePrePushHook("/workspace");

    expect(result).toEqual({ removed: true });
    const writtenContent = (git.writeHookFile as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(writtenContent).not.toContain(GitConstants.PRE_PUSH_HOOK_MARKER);
    expect(writtenContent).toContain('echo "user content"');
  });

  it("strips an env-gate-era (pre hooks-check, issue #42 §7.5) pre-push block and preserves unrelated user content", async () => {
    const existingHook =
      `#!/bin/bash\necho "user content"\n` +
      GitConstants.ENV_GATE_PRE_PUSH_HOOK_CONTENT;
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(existingHook),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.removePrePushHook("/workspace");

    expect(result).toEqual({ removed: true });
    const writtenContent = (git.writeHookFile as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(writtenContent).not.toContain(GitConstants.PRE_PUSH_HOOK_MARKER);
    expect(writtenContent).toContain('echo "user content"');
  });

  it("is a clean no-op when no Docuvia pre-push hook is present", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.removePrePushHook("/workspace");

    expect(result).toEqual({ removed: false });
    expect(git.writeHookFile).not.toHaveBeenCalled();
  });

  it("does not throw when the write fails — logs a warning and reports removed:false instead", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi
        .fn()
        .mockResolvedValue(GitConstants.PRE_PUSH_HOOK_CONTENT),
      writeHookFile: vi.fn().mockRejectedValue(new Error("EACCES")),
    });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.removePrePushHook("/workspace");

    expect(result).toEqual({ removed: false });
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });
});

describe("KnowledgeGitService.repairDuplicatePostCommitHook() (phase1-decision-integration.md §10d)", () => {
  it("strips every Docuvia block (including a hand-edited legacy block that breaks exact-content matching) and appends exactly one canonical block", async () => {
    const handEditedLegacy =
      GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT.replace(
        "Non-intrusively extracts",
        "Non-intrusively HAND-EDITED extracts",
      );
    const existingHook =
      `echo "before"\n` +
      handEditedLegacy +
      GitConstants.POST_COMMIT_HOOK_CONTENT +
      `echo "after"\n`;
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(existingHook),
    });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.repairDuplicatePostCommitHook("/workspace");

    expect(result).toEqual({ repaired: true });
    const writtenContent = (git.writeHookFile as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(writtenContent).not.toContain(
      GitConstants.LEGACY_POST_COMMIT_HOOK_MARKER,
    );
    // Exactly one canonical block present -- POST_COMMIT_HOOK_MARKER ("docuvia analyze") occurs
    // twice within that one block since issue #42 (once on its own line, once as a substring of
    // the "docuvia analyze --flush-staged-l3" line), so 2 total occurrences (not 1) confirms a
    // single, non-duplicated block, not two.
    expect(
      writtenContent.split(GitConstants.POST_COMMIT_HOOK_MARKER).length - 1,
    ).toBe(2);
    // Unrelated user content survives, in order.
    expect(writtenContent).toContain('echo "before"');
    expect(writtenContent).toContain('echo "after"');
    // No orphaned shebang lines: each stripped block's own leading `#!/bin/bash` must be removed
    // along with its header/body, leaving exactly the one shebang line the freshly-appended
    // canonical block itself carries -- not three (one from each un-merged original block, plus
    // one from the newly-appended block).
    expect((writtenContent.match(/^#!.*$/gm) ?? []).length).toBe(1);
    expect(
      logger.events.some(
        (e) => e.level === "info" && /Repaired duplicate/.test(e.message),
      ),
    ).toBe(true);
  });

  it("is a no-op (no write at all) when the hook is healthy — never mutates a file that isn't duplicated", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi
        .fn()
        .mockResolvedValue(GitConstants.POST_COMMIT_HOOK_CONTENT),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.repairDuplicatePostCommitHook("/workspace");

    expect(result).toEqual({ repaired: false });
    expect(git.writeHookFile).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no hook file at all", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.repairDuplicatePostCommitHook("/workspace");

    expect(result).toEqual({ repaired: false });
    expect(git.writeHookFile).not.toHaveBeenCalled();
  });

  it("does not throw when the write fails — logs a warning and reports repaired:false instead", async () => {
    const existingHook =
      GitConstants.LEGACY_POST_COMMIT_HOOK_CONTENT +
      GitConstants.POST_COMMIT_HOOK_CONTENT;
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(existingHook),
      writeHookFile: vi.fn().mockRejectedValue(new Error("EACCES")),
    });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.repairDuplicatePostCommitHook("/workspace");

    expect(result).toEqual({ repaired: false });
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });
});

describe("KnowledgeGitService.packSnapshotToKnowledgeBranch()", () => {
  it("delegates to IGitProvider.packDirectoryToBranch with the default knowledge branch name and a source-hash-stamped commit message", async () => {
    const git = makeMockGitProvider();
    const service = new KnowledgeGitService(git);

    await service.packSnapshotToKnowledgeBranch(
      "/workspace",
      "/tmp/snapshot-render",
    );

    expect(git.packDirectoryToBranch).toHaveBeenCalledWith(
      "/workspace",
      "/tmp/snapshot-render",
      GitConstants.KNOWLEDGE_ROOT,
      "Snapshot [a1b2c3d]\n\nDocuvia-Source: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      0,
      true,
    );
  });

  it("uses an explicit branchName override when given", async () => {
    const git = makeMockGitProvider();
    const service = new KnowledgeGitService(git);

    await service.packSnapshotToKnowledgeBranch(
      "/workspace",
      "/tmp/snapshot-render",
      "custom-branch",
    );

    expect(git.packDirectoryToBranch).toHaveBeenCalledWith(
      "/workspace",
      "/tmp/snapshot-render",
      "custom-branch",
      "Snapshot [a1b2c3d]\n\nDocuvia-Source: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      0,
      true,
    );
  });

  it("falls back to an unstamped message on an unborn HEAD (no source commits yet)", async () => {
    const git = makeMockGitProvider({
      getHeadSha: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    await service.packSnapshotToKnowledgeBranch(
      "/workspace",
      "/tmp/snapshot-render",
    );

    expect(git.packDirectoryToBranch).toHaveBeenCalledWith(
      "/workspace",
      "/tmp/snapshot-render",
      GitConstants.KNOWLEDGE_ROOT,
      "Snapshot [unknown]",
      undefined,
      true,
    );
  });

  it("propagates a failure from the underlying git provider", async () => {
    const git = makeMockGitProvider({
      packDirectoryToBranch: vi
        .fn()
        .mockRejectedValue(new Error("git fast-import failed")),
    });
    const service = new KnowledgeGitService(git);

    await expect(
      service.packSnapshotToKnowledgeBranch(
        "/workspace",
        "/tmp/snapshot-render",
      ),
    ).rejects.toThrow("git fast-import failed");
  });
});

describe("KnowledgeGitService.syncKnowledgeBranch()", () => {
  it("is a no-op (status: no-remote) when there's no origin remote configured", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "no-remote" });
    expect(git.fetchRef).not.toHaveBeenCalled();
  });

  it("degrades gracefully (status: no-remote) when fetch fails — e.g. offline", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      fetchRef: vi.fn().mockRejectedValue(new Error("could not resolve host")),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "no-remote" });
  });

  it("pushes the local branch (not status: no-remote) when the remote simply has no knowledge branch yet — a brand-new project's first sync-knowledge, not an offline/network failure (regression found via dogfooding Docuvia2 on itself, 2026-07-21)", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      fetchRef: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "git fetch failed: Command failed: git fetch origin docuvia-knowledge\nfatal: couldn't find remote ref docuvia-knowledge\n",
          ),
        ),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({
      status: "pushed-local",
      branchTipSha: "local-sha",
    });
    expect(git.pushRef).toHaveBeenCalledWith(
      "/workspace",
      "origin",
      GitConstants.KNOWLEDGE_ROOT,
      undefined,
    );
  });

  it("is up-to-date when local and remote tips already match", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("sha-1"),
      getRefSha: vi.fn().mockResolvedValue("sha-1"),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "up-to-date", branchTipSha: "sha-1" });
    expect(git.updateBranchRef).not.toHaveBeenCalled();
    expect(git.pushRef).not.toHaveBeenCalled();
  });

  it("adopts the remote wholesale when there's no local copy yet", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue(undefined),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({
      status: "fast-forwarded-local",
      branchTipSha: "remote-sha",
    });
    expect(git.updateBranchRef).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.KNOWLEDGE_ROOT,
      "remote-sha",
    );
  });

  it("pushes the local branch when the remote has no copy yet", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({
      status: "pushed-local",
      branchTipSha: "local-sha",
    });
    expect(git.pushRef).toHaveBeenCalledWith(
      "/workspace",
      "origin",
      GitConstants.KNOWLEDGE_ROOT,
      undefined,
    );
  });

  it("threads the configured gitNetworkTimeoutMs override down into both fetchRef and pushRef (DOCUVIA_PUSH_TIMEOUT_MS — default is no timeout, but a caller can opt back in)", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git, undefined, 5000);

    await service.syncKnowledgeBranch("/workspace");

    expect(git.fetchRef).toHaveBeenCalledWith(
      "/workspace",
      "origin",
      GitConstants.KNOWLEDGE_ROOT,
      5000,
    );
    expect(git.pushRef).toHaveBeenCalledWith(
      "/workspace",
      "origin",
      GitConstants.KNOWLEDGE_ROOT,
      5000,
    );
  });

  it("fast-forwards local to remote when remote is strictly ahead", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi
        .fn()
        .mockImplementation((_cwd, ancestor, descendant) =>
          Promise.resolve(
            ancestor === "local-sha" && descendant === "remote-sha",
          ),
        ),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({
      status: "fast-forwarded-local",
      branchTipSha: "remote-sha",
    });
    expect(git.updateBranchRef).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.KNOWLEDGE_ROOT,
      "remote-sha",
    );
    expect(git.createMergeCommit).not.toHaveBeenCalled();
  });

  it("pushes local to remote when local is strictly ahead", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi
        .fn()
        .mockImplementation((_cwd, ancestor, descendant) =>
          Promise.resolve(
            ancestor === "remote-sha" && descendant === "local-sha",
          ),
        ),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({
      status: "pushed-local",
      branchTipSha: "local-sha",
    });
    expect(git.pushRef).toHaveBeenCalledWith(
      "/workspace",
      "origin",
      GitConstants.KNOWLEDGE_ROOT,
      undefined,
    );
    expect(git.createMergeCommit).not.toHaveBeenCalled();
  });

  it("on true divergence, picks the winner whose stamped source commit is the topological descendant, adopts its tree, and pushes the merge", async () => {
    const sourceOld = "source-old-sha";
    const sourceNew = "source-new-sha";
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi.fn().mockImplementation((_cwd, ancestor, descendant) => {
        // Neither commit is a fast-forward ancestor of the other (true divergence)...
        if (ancestor === "local-sha" || ancestor === "remote-sha")
          return Promise.resolve(false);
        // ...but remote's stamped source is a descendant of local's — remote wins.
        return Promise.resolve(
          ancestor === sourceOld && descendant === sourceNew,
        );
      }),
      getCommitLog: vi.fn().mockImplementation((_cwd, ref) => {
        if (ref === "local-sha") {
          return Promise.resolve([
            {
              sha: "local-sha",
              message: `Snapshot [aaa]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: ${sourceOld}`,
            },
          ]);
        }
        if (ref === "remote-sha") {
          return Promise.resolve([
            {
              sha: "remote-sha",
              message: `Snapshot [bbb]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: ${sourceNew}`,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
      getTreeSha: vi.fn().mockResolvedValue("remote-tree"),
      createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "merged", branchTipSha: "merge-sha" });
    expect(git.getTreeSha).toHaveBeenCalledWith("/workspace", "remote-sha");
    expect(git.createMergeCommit).toHaveBeenCalledWith(
      "/workspace",
      "remote-tree",
      ["local-sha", "remote-sha"],
      expect.stringContaining("remote wins"),
    );
    expect(git.updateBranchRef).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.KNOWLEDGE_ROOT,
      "merge-sha",
    );
    expect(git.pushRef).toHaveBeenCalledWith(
      "/workspace",
      "origin",
      GitConstants.KNOWLEDGE_ROOT,
      undefined,
    );
  });

  it("on true divergence with unstamped/unrelated source commits, falls back to the newer committer timestamp", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi.fn().mockResolvedValue(false),
      getCommitLog: vi.fn().mockResolvedValue([]), // no Docuvia-Source trailer on either side
      getCommitTimestamp: vi
        .fn()
        .mockImplementation((_cwd, sha) =>
          Promise.resolve(sha === "local-sha" ? 100 : 200),
        ),
      getTreeSha: vi.fn().mockResolvedValue("local-tree"),
      createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
    });
    const service = new KnowledgeGitService(git);

    await service.syncKnowledgeBranch("/workspace");

    // remote-sha has the newer timestamp (200 > 100), so it should win.
    expect(git.getTreeSha).toHaveBeenCalledWith("/workspace", "remote-sha");
  });

  it("still returns status:merged when the post-merge push fails (degrades gracefully offline)", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi.fn().mockResolvedValue(false),
      getCommitLog: vi.fn().mockResolvedValue([]),
      getCommitTimestamp: vi.fn().mockResolvedValue(0),
      getTreeSha: vi.fn().mockResolvedValue("some-tree"),
      createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
      pushRef: vi.fn().mockRejectedValue(new Error("connection reset")),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "merged", branchTipSha: "merge-sha" });
  });

  it("holds the knowledge branch lock for the duration of the reconciliation", async () => {
    const order: string[] = [];
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      acquireKnowledgeLock: vi.fn().mockImplementation(async () => {
        order.push("acquire");
      }),
      releaseKnowledgeLock: vi.fn().mockImplementation(async () => {
        order.push("release");
      }),
      getBranchTipSha: vi.fn().mockImplementation(async () => {
        order.push("reconcile");
        return "sha-1";
      }),
      getRefSha: vi.fn().mockResolvedValue("sha-1"),
    });
    const service = new KnowledgeGitService(git);

    await service.syncKnowledgeBranch("/workspace");

    expect(order).toEqual(["acquire", "reconcile", "release"]);
  });
});
