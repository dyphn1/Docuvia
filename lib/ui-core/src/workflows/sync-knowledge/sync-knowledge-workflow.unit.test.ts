import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type IKnowledgeGitService,
} from "@workspace/contracts";
import { SyncKnowledgeWorkflow } from "./sync-knowledge-workflow.js";

describe("SyncKnowledgeWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("delegates to IKnowledgeGitService.syncKnowledgeBranch() and returns its result", async () => {
    const knowledgeGit: IKnowledgeGitService = {
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
      syncKnowledgeBranch: vi
        .fn()
        .mockResolvedValue({ status: "merged", branchTipSha: "merge-sha" }),
    };
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    const result = await new SyncKnowledgeWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(knowledgeGit.syncKnowledgeBranch).toHaveBeenCalledWith(
      "/workspace/demo",
    );
    expect(result).toEqual({ status: "merged", branchTipSha: "merge-sha" });
  });

  it("propagates a failure from the underlying knowledge git service", async () => {
    const knowledgeGit: IKnowledgeGitService = {
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
      syncKnowledgeBranch: vi.fn().mockRejectedValue(new Error("lock timeout")),
    };
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    await expect(
      new SyncKnowledgeWorkflow(
        "/workspace/demo",
        createMockLogger(),
      ).execute(),
    ).rejects.toThrow("lock timeout");
  });
});
