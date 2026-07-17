import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGraphStore,
  type IKnowledgeGitService,
  type ISnapshotRenderer,
} from "@workspace/contracts";
import { SnapshotWorkflow } from "./snapshot-workflow.js";

function makeMockStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
  return {
    projects: {
      getFirst: vi.fn(),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn(),
    },
    files: { getAllHashes: vi.fn(), upsertFile: vi.fn() },
    tags: {
      upsertTag: vi.fn(),
      getIdByName: vi.fn(),
      linkNodeToTag: vi.fn(),
      getAllTagLinks: vi.fn(),
    },
    graph: {
      deleteNodesForPath: vi.fn(),
      insertNode: vi.fn(),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn(),
      findNodeIdByNodeKey: vi.fn(),
      count: vi.fn(),
      findNodesForChangedFiles: vi.fn(),
      findNodeByName: vi.fn(),
      getIncomingEdges: vi.fn(),
      getOutgoingEdges: vi.fn(),
      getAllNodes: vi.fn().mockReturnValue([]),
      getAllLinks: vi.fn().mockReturnValue([]),
      bulkLoadGraph: vi.fn(),
      pruneOrphanedLinks: vi.fn().mockReturnValue(0),
    },
    l3: {
      getById: vi.fn(),
      getAllExportable: vi.fn(),
      upsertDecision: vi.fn(),
    },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    meta: { get: vi.fn(), set: vi.fn() },
    withWriteLock: async (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi.fn(),
    ...overrides,
  };
}

describe("SnapshotWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("bulk-reads the store, renders via ISnapshotRenderer, packs onto the knowledge branch, then closes the store", async () => {
    const store = makeMockStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn(),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getAllNodes: vi.fn().mockReturnValue([{ id: 1 }]),
        getAllLinks: vi.fn().mockReturnValue([{ id: 1 }]),
        bulkLoadGraph: vi.fn(),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
      },
    });
    const openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);

    const renderResult = {
      nodesWritten: 1,
      edgesWritten: 1,
      markdownFilesWritten: 1,
    };
    const renderer: ISnapshotRenderer = {
      render: vi.fn().mockResolvedValue(renderResult),
    };
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => renderer);

    const knowledgeGit: IKnowledgeGitService = {
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn().mockResolvedValue(undefined),
      syncKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    };
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    const result = await new SnapshotWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(store.graph.getAllNodes).toHaveBeenCalled();
    expect(store.graph.getAllLinks).toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({ l2Rows: [{ id: 1 }], linkRows: [{ id: 1 }] }),
    );
    expect(knowledgeGit.packSnapshotToKnowledgeBranch).toHaveBeenCalledWith(
      "/workspace/demo",
      expect.any(String),
    );
    expect(result).toEqual(renderResult);
    // 2, not 1: the main render/pack store open, plus finalizePendingTierBBatch's own separate
    // open (§8g's post-pack finalize check, a no-op here since no Tier B batch is pending) --
    // both closed via their own `finally`. This mock happens to resolve the same `store` object
    // for both opens; a real GraphStoreOpener returns a fresh connection each call.
    expect(store.close).toHaveBeenCalledTimes(2);
  });

  it('throws a DocuviaError with a "run docuvia init" message when the db is missing', async () => {
    const dbOpenError = new DocuviaError(
      "DB_OPEN_FAILED",
      "Failed to open database at /x: ENOENT",
    );
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockRejectedValue(dbOpenError),
    );
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn(),
    }));
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => ({
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn(),
      syncKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    }));
    docuviaFactory.lock();

    await expect(
      new SnapshotWorkflow("/workspace/demo", createMockLogger()).execute(),
    ).rejects.toMatchObject({
      code: "DB_OPEN_FAILED",
      message: expect.stringContaining("docuvia init"),
    });
  });

  it("closes the store even when packSnapshotToKnowledgeBranch throws", async () => {
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn().mockResolvedValue({
        nodesWritten: 0,
        edgesWritten: 0,
        markdownFilesWritten: 0,
      }),
    }));
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => ({
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      packSnapshotToKnowledgeBranch: vi
        .fn()
        .mockRejectedValue(new Error("git fast-import failed")),
      syncKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    }));
    docuviaFactory.lock();

    await expect(
      new SnapshotWorkflow("/workspace/demo", createMockLogger()).execute(),
    ).rejects.toThrow("git fast-import failed");
    expect(store.close).toHaveBeenCalledTimes(1);
  });
});
