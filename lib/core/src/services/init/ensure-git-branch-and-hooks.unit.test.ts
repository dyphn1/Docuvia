import { describe, it, expect, vi } from "vitest";
import { ensureGitBranchAndHooks } from "./ensure-git-branch-and-hooks.js";
import { IWorkspaceGitService } from "../../interfaces/workspace-git.interfaces.js";

function makeMockGit(overrides: Partial<IWorkspaceGitService> = {}): IWorkspaceGitService {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    ensureKnowledgeBranch: vi.fn().mockResolvedValue({ created: true }),
    installPostCommitHook: vi.fn().mockResolvedValue({ installed: true }),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("ensureGitBranchAndHooks", () => {
  it("calls ensureKnowledgeBranch before installPostCommitHook", async () => {
    const callOrder: string[] = [];
    const git = makeMockGit({
      ensureKnowledgeBranch: vi.fn().mockImplementation(async () => {
        callOrder.push("ensureKnowledgeBranch");
        return { created: true };
      }),
      installPostCommitHook: vi.fn().mockImplementation(async () => {
        callOrder.push("installPostCommitHook");
        return { installed: true };
      }),
    });

    const result = await ensureGitBranchAndHooks(git, "/workspace");

    expect(callOrder).toEqual(["ensureKnowledgeBranch", "installPostCommitHook"]);
    expect(result).toEqual({ branchCreated: true, hookInstalled: true });
  });

  it("propagates ensureKnowledgeBranch failures (fatal to init)", async () => {
    const git = makeMockGit({
      ensureKnowledgeBranch: vi.fn().mockRejectedValue(new Error("Failed to create branch: boom")),
    });

    await expect(ensureGitBranchAndHooks(git, "/workspace")).rejects.toThrow(
      "Failed to create branch: boom"
    );
  });

  it("does not throw when installPostCommitHook reports installed:false (non-fatal, handled inside WorkspaceGitService)", async () => {
    const git = makeMockGit({
      installPostCommitHook: vi.fn().mockResolvedValue({ installed: false }),
    });

    const result = await ensureGitBranchAndHooks(git, "/workspace");
    expect(result.hookInstalled).toBe(false);
  });

  it("invokes onProgress before installing the hook", async () => {
    const messages: string[] = [];
    const git = makeMockGit();

    await ensureGitBranchAndHooks(git, "/workspace", (msg) => messages.push(msg));

    expect(messages).toContain("Installing post-commit hook...");
  });
});
