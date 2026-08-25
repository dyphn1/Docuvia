import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/command-log-writer.js", () => ({
  appendCommandLogLine: vi.fn(async () => undefined),
}));
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGitProvider,
  type IGraphStore,
  type IHydrationService,
  type IKnowledgeGitService,
  type ILineBlameProvider,
} from "@workspace/contracts";
import { SyncKnowledgeWorkflow } from "./sync-knowledge-workflow.js";

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(true),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    commitEmptyTree: vi.fn().mockResolvedValue("sha"),
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
    getHeadSha: vi.fn().mockResolvedValue(undefined),
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

function makeMockStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
  return {
    projects: {
      getFirst: vi.fn(),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn(),
    },
    files: {
      getAllHashes: vi.fn(),
      upsertFile: vi.fn(),
      markTierBProcessed: vi.fn(),
      getTierBFileStatus: vi.fn(),
      getTierBCoverage: vi.fn(),
    },
    tags: {
      upsertTag: vi.fn(),
      getIdByName: vi.fn(),
      linkNodeToTag: vi.fn(),
      getAllTagLinks: vi.fn(),
    },
    graph: {
      deleteNodesForPath: vi.fn(),
      getSemanticCoverage: vi.fn(),
      getCanarySample: vi.fn().mockReturnValue([]),
      insertNode: vi.fn(),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn(),
      findNodeIdByNodeKey: vi.fn(),
      count: vi.fn(),
      findNodesForChangedFiles: vi.fn(),
      findNodeByName: vi.fn(),
      getIncomingEdges: vi.fn(),
      getOutgoingEdges: vi.fn(),
      getIncomingRelations: vi.fn(),
      getOutgoingRelations: vi.fn(),
      getAllNodes: vi.fn().mockReturnValue([]),
      getAllLinks: vi.fn().mockReturnValue([]),
      bulkLoadGraph: vi.fn(),
      pruneOrphanedLinks: vi.fn().mockReturnValue(0),
      withFtsSyncSuspended: (fn: any) => fn(),
    },
    l3: {
      getById: vi.fn(),
      getAllExportable: vi.fn().mockReturnValue([]),
      getByL2NodeId: vi.fn(),
      upsertDecision: vi.fn(),
      importCard: vi.fn(),
      updateValidityStatus: vi.fn(),
    },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    meta: { get: vi.fn(), set: vi.fn() },
    callSites: {
      deleteForFile: vi.fn(),
      insertMany: vi.fn(),
      getForFiles: vi.fn().mockReturnValue(new Map()),
      getByTargetFunctions: vi.fn().mockReturnValue(new Map()),
    },
    withWriteLock: async (fn) => fn(),
    withTransaction: (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi.fn(),
    ...overrides,
  };
}

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
      deleteKnowledgeBranch: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
      syncKnowledgeBranch: vi
        .fn()
        .mockResolvedValue({ status: "merged", branchTipSha: "merge-sha" }),
    };
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);

    // §3 wiring (phase2-l3-distribution.md): a resolved branchTipSha triggers the shared
    // L3-import routine, which needs a git provider + a writable store.
    const gitProvider = makeMockGitProvider({
      listFilesAtRef: vi.fn().mockResolvedValue([]),
      // Unborn HEAD: the issue #68 validity pass resolves its inputs, sees no HEAD, and
      // returns without judging -- keeping this test about the import delegation.
      getHeadSha: vi.fn().mockResolvedValue(undefined),
    });
    docuviaFactory.register(TOKENS.GitProvider, () => gitProvider);
    docuviaFactory.register(
      TOKENS.LineBlameProvider,
      () => gitProvider as unknown as ILineBlameProvider,
    );
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi
        .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
        .mockResolvedValue(store),
    );
    const hydrationService: IHydrationService = {
      resolveHydrationCommit: vi.fn(),
      hydrate: vi.fn(),
      isStale: vi.fn(),
      markSynced: vi.fn(),
      importL3Cards: vi.fn().mockResolvedValue({ cardsFound: 0, imported: 0 }),
    };
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    const result = await new SyncKnowledgeWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(knowledgeGit.syncKnowledgeBranch).toHaveBeenCalledWith(
      "/workspace/demo",
    );
    expect(result).toEqual({ status: "merged", branchTipSha: "merge-sha" });
    // The L3-import step ran under the knowledge lock, listed knowledge/_l3/ at the resolved
    // branch tip, found nothing, and still closed the store.
    expect(knowledgeGit.runUnderKnowledgeLock).toHaveBeenCalledWith(
      "/workspace/demo",
      expect.any(Function),
    );
    // The L3-import step delegates to IHydrationService.importL3Cards (resolved via factory),
    // which internally opens the store, acquires the write lock, and delegates to
    // importL3CardsFromKnowledgeBranch.
    expect(hydrationService.importL3Cards).toHaveBeenCalledWith(
      "/workspace/demo",
      "merge-sha",
      store,
    );
    // Two store opens+close cycles: the L3-import's and the issue #68 validity pass's (which
    // no-ops on an unborn HEAD but still opens/closes its own store).
    expect(store.close).toHaveBeenCalledTimes(2);
  });

  it("threads the constructor's gitNetworkTimeoutMs through to TOKENS.KnowledgeGitService's resolve() params", async () => {
    let capturedParams: { gitNetworkTimeoutMs?: number } | undefined;
    docuviaFactory.register(TOKENS.KnowledgeGitService, (_f, params) => {
      capturedParams = params;
      return {
        ensureKnowledgeBranch: vi.fn(),
        installPostCommitHook: vi.fn(),
        installPrePushHook: vi.fn(),
        removePostCommitHook: vi.fn(),
        removePrePushHook: vi.fn(),
        repairDuplicatePostCommitHook: vi.fn(),
        deleteKnowledgeBranch: vi.fn(),
        packSnapshotToKnowledgeBranch: vi.fn(),
        resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
        runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
        syncKnowledgeBranch: vi.fn().mockResolvedValue({ status: "no-remote" }),
      };
    });
    docuviaFactory.lock();

    await new SyncKnowledgeWorkflow(
      "/workspace/demo",
      createMockLogger(),
      5000,
    ).execute();

    expect(capturedParams?.gitNetworkTimeoutMs).toBe(5000);
  });

  it("skips the L3-import step (no GitProvider/GraphStoreOpener resolve) when syncKnowledgeBranch resolves no branchTipSha (no-remote)", async () => {
    const knowledgeGit: IKnowledgeGitService = {
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
      syncKnowledgeBranch: vi.fn().mockResolvedValue({ status: "no-remote" }),
    };
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    const result = await new SyncKnowledgeWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(result).toEqual({ status: "no-remote" });
    expect(knowledgeGit.runUnderKnowledgeLock).not.toHaveBeenCalled();
  });

  it("propagates a failure from the underlying knowledge git service", async () => {
    const knowledgeGit: IKnowledgeGitService = {
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
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
