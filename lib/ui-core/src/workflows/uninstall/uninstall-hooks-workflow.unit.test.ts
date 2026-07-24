import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type IKnowledgeGitService,
} from "@workspace/contracts";
import { UninstallHooksWorkflow } from "./uninstall-hooks-workflow.js";

function makeMockKnowledgeGitService(
  overrides: Partial<IKnowledgeGitService> = {},
): IKnowledgeGitService {
  return {
    ensureKnowledgeBranch: vi.fn(),
    installPostCommitHook: vi.fn(),
    installPrePushHook: vi.fn(),
    removePostCommitHook: vi.fn().mockResolvedValue({ removed: true }),
    removePrePushHook: vi.fn().mockResolvedValue({ removed: true }),
    repairDuplicatePostCommitHook: vi.fn(),
    deleteKnowledgeBranch: vi.fn().mockResolvedValue({ deleted: true }),
    packSnapshotToKnowledgeBranch: vi.fn(),
    syncKnowledgeBranch: vi.fn(),
    resolveNewestSourceTrailerSha: vi.fn(),
    runUnderKnowledgeLock: vi.fn(async (_cwd, fn) => fn()),
    ...overrides,
  };
}

describe("UninstallHooksWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("removes both hooks and reports what was removed", async () => {
    const knowledgeGit = makeMockKnowledgeGitService();
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    const result = await new UninstallHooksWorkflow(
      "/workspace",
      createMockLogger(),
    ).execute();

    expect(result).toEqual({
      postCommitRemoved: true,
      prePushRemoved: true,
      knowledgeBranchDeleted: true,
    });
    expect(knowledgeGit.removePostCommitHook).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(knowledgeGit.removePrePushHook).toHaveBeenCalledWith("/workspace");
    expect(knowledgeGit.deleteKnowledgeBranch).toHaveBeenCalledWith(
      "/workspace",
    );
  });

  it("skips deleting the knowledge branch when keepDb is true", async () => {
    const knowledgeGit = makeMockKnowledgeGitService();
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    const result = await new UninstallHooksWorkflow(
      "/workspace",
      createMockLogger(),
    ).execute(true);

    expect(result).toEqual({
      postCommitRemoved: true,
      prePushRemoved: true,
      knowledgeBranchDeleted: false,
    });
    expect(knowledgeGit.deleteKnowledgeBranch).not.toHaveBeenCalled();
  });

  it("catches a knowledge-branch-deletion failure and still reports the hook results", async () => {
    const knowledgeGit = makeMockKnowledgeGitService({
      deleteKnowledgeBranch: vi.fn().mockRejectedValue(new Error("EACCES")),
    });
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();
    const logger = createMockLogger();

    const result = await new UninstallHooksWorkflow(
      "/workspace",
      logger,
    ).execute();

    expect(result).toEqual({
      postCommitRemoved: true,
      prePushRemoved: true,
      knowledgeBranchDeleted: false,
    });
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });

  it("is a clean no-op result when neither hook was present", async () => {
    const knowledgeGit = makeMockKnowledgeGitService({
      removePostCommitHook: vi.fn().mockResolvedValue({ removed: false }),
      removePrePushHook: vi.fn().mockResolvedValue({ removed: false }),
    });
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    const result = await new UninstallHooksWorkflow(
      "/workspace",
      createMockLogger(),
    ).execute();

    expect(result).toEqual({
      postCommitRemoved: false,
      prePushRemoved: false,
      knowledgeBranchDeleted: true,
    });
  });

  it("catches a single hook's failure, logs it, and still attempts the other hook", async () => {
    const knowledgeGit = makeMockKnowledgeGitService({
      removePostCommitHook: vi.fn().mockRejectedValue(new Error("EACCES")),
    });
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();
    const logger = createMockLogger();

    const result = await new UninstallHooksWorkflow(
      "/workspace",
      logger,
    ).execute();

    expect(result).toEqual({
      postCommitRemoved: false,
      prePushRemoved: true,
      knowledgeBranchDeleted: true,
    });
    expect(knowledgeGit.removePrePushHook).toHaveBeenCalled();
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });
});
