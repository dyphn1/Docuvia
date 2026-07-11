import { describe, it, expect, vi } from "vitest";
import type { IGitProvider } from "@workspace/contracts";
import { createMockLogger } from "@workspace/contracts";
import { KnowledgeGitService } from "./knowledge-git.service.js";
import { GitConstants } from "./git-constants.js";

function makeMockGitProvider(overrides: Partial<IGitProvider> = {}): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(false),
    commitEmptyTree: vi.fn().mockResolvedValue("deadbeef"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(true),
    readHookFile: vi.fn().mockResolvedValue(undefined),
    appendHookFile: vi.fn().mockResolvedValue(undefined),
    makeHookExecutable: vi.fn().mockResolvedValue(undefined),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    packDirectoryToBranch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("KnowledgeGitService.ensureKnowledgeBranch()", () => {
  it("creates the branch (commitEmptyTree -> updateBranchRef) when it does not already exist", async () => {
    const git = makeMockGitProvider({ branchExists: vi.fn().mockResolvedValue(false) });
    const service = new KnowledgeGitService(git);

    const result = await service.ensureKnowledgeBranch("/workspace");

    expect(result).toEqual({ created: true });
    expect(git.commitEmptyTree).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.KNOWLEDGE_BRANCH_COMMIT_MESSAGE
    );
    expect(git.updateBranchRef).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.KNOWLEDGE_ROOT,
      "deadbeef"
    );
  });

  it("is idempotent: does not create a commit when the branch already exists", async () => {
    const git = makeMockGitProvider({ branchExists: vi.fn().mockResolvedValue(true) });
    const service = new KnowledgeGitService(git);

    const result = await service.ensureKnowledgeBranch("/workspace");

    expect(result).toEqual({ created: false });
    expect(git.commitEmptyTree).not.toHaveBeenCalled();
    expect(git.updateBranchRef).not.toHaveBeenCalled();
  });

  it("propagates a failure from the underlying git provider (fatal to init)", async () => {
    const git = makeMockGitProvider({
      commitEmptyTree: vi.fn().mockRejectedValue(new Error("git commit-tree failed")),
    });
    const service = new KnowledgeGitService(git);

    await expect(service.ensureKnowledgeBranch("/workspace")).rejects.toThrow(
      "git commit-tree failed"
    );
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
      GitConstants.POST_COMMIT_HOOK_CONTENT
    );
    expect(git.makeHookExecutable).toHaveBeenCalled();
  });

  it("does not install (non-fatal) when .git/hooks does not exist", async () => {
    const git = makeMockGitProvider({ hooksDirExists: vi.fn().mockResolvedValue(false) });
    const service = new KnowledgeGitService(git);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(git.appendHookFile).not.toHaveBeenCalled();
  });

  it("is idempotent: does not duplicate the hook when the marker is already present", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi.fn().mockResolvedValue(`#!/bin/bash\n${GitConstants.POST_COMMIT_HOOK_MARKER}\n`),
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
});

describe("KnowledgeGitService.packSnapshotToKnowledgeBranch()", () => {
  it("delegates to IGitProvider.packDirectoryToBranch with the default knowledge branch name", async () => {
    const git = makeMockGitProvider();
    const service = new KnowledgeGitService(git);

    await service.packSnapshotToKnowledgeBranch("/workspace", "/tmp/snapshot-render");

    expect(git.packDirectoryToBranch).toHaveBeenCalledWith(
      "/workspace",
      "/tmp/snapshot-render",
      GitConstants.KNOWLEDGE_ROOT
    );
  });

  it("uses an explicit branchName override when given", async () => {
    const git = makeMockGitProvider();
    const service = new KnowledgeGitService(git);

    await service.packSnapshotToKnowledgeBranch("/workspace", "/tmp/snapshot-render", "custom-branch");

    expect(git.packDirectoryToBranch).toHaveBeenCalledWith(
      "/workspace",
      "/tmp/snapshot-render",
      "custom-branch"
    );
  });

  it("propagates a failure from the underlying git provider", async () => {
    const git = makeMockGitProvider({
      packDirectoryToBranch: vi.fn().mockRejectedValue(new Error("git fast-import failed")),
    });
    const service = new KnowledgeGitService(git);

    await expect(
      service.packSnapshotToKnowledgeBranch("/workspace", "/tmp/snapshot-render")
    ).rejects.toThrow("git fast-import failed");
  });
});
