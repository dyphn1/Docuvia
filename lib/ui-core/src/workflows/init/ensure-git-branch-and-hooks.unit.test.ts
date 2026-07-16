import { describe, it, expect, vi } from "vitest";
import type { IKnowledgeGitService } from "@workspace/contracts";
import { createMockLogger } from "@workspace/contracts";
import { ensureGitBranchAndHooks } from "./ensure-git-branch-and-hooks.js";

function makeMockKnowledgeGit(
  overrides: Partial<IKnowledgeGitService> = {},
): IKnowledgeGitService {
  return {
    ensureKnowledgeBranch: vi.fn().mockResolvedValue({ created: true }),
    installPostCommitHook: vi.fn().mockResolvedValue({ installed: true }),
    packSnapshotToKnowledgeBranch: vi.fn().mockResolvedValue(undefined),
    syncKnowledgeBranch: vi.fn().mockResolvedValue({ status: "no-remote" }),
    resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
    runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    ...overrides,
  };
}

describe("ensureGitBranchAndHooks", () => {
  it("calls ensureKnowledgeBranch before installPostCommitHook", async () => {
    const callOrder: string[] = [];
    const knowledgeGit = makeMockKnowledgeGit({
      ensureKnowledgeBranch: vi.fn().mockImplementation(async () => {
        callOrder.push("ensureKnowledgeBranch");
        return { created: true };
      }),
      installPostCommitHook: vi.fn().mockImplementation(async () => {
        callOrder.push("installPostCommitHook");
        return { installed: true };
      }),
    });

    const result = await ensureGitBranchAndHooks(
      knowledgeGit,
      "/workspace",
      createMockLogger(),
    );

    expect(callOrder).toEqual([
      "ensureKnowledgeBranch",
      "installPostCommitHook",
    ]);
    expect(result).toEqual({ branchCreated: true, hookInstalled: true });
  });

  it("propagates ensureKnowledgeBranch failures (fatal to init)", async () => {
    const knowledgeGit = makeMockKnowledgeGit({
      ensureKnowledgeBranch: vi
        .fn()
        .mockRejectedValue(new Error("Failed to create branch: boom")),
    });

    await expect(
      ensureGitBranchAndHooks(knowledgeGit, "/workspace", createMockLogger()),
    ).rejects.toThrow("Failed to create branch: boom");
  });

  it("does not throw when installPostCommitHook reports installed:false (non-fatal, handled inside KnowledgeGitService)", async () => {
    const knowledgeGit = makeMockKnowledgeGit({
      installPostCommitHook: vi.fn().mockResolvedValue({ installed: false }),
    });

    const result = await ensureGitBranchAndHooks(
      knowledgeGit,
      "/workspace",
      createMockLogger(),
    );
    expect(result.hookInstalled).toBe(false);
  });

  it("logs progress before installing the hook", async () => {
    const knowledgeGit = makeMockKnowledgeGit();
    const logger = createMockLogger();

    await ensureGitBranchAndHooks(knowledgeGit, "/workspace", logger);

    expect(
      logger.events.some((e) => e.message === "Installing post-commit hook..."),
    ).toBe(true);
  });
});
