import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/command-log-writer.js", () => ({
  appendCommandLogLine: vi.fn(async () => undefined),
}));
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGraphStore,
  type IHydrationService,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import { StatusWorkflow } from "./status-workflow.js";

function makeMockHydrationService(
  overrides: Partial<IHydrationService> = {},
): IHydrationService {
  return {
    resolveHydrationCommit: vi.fn(),
    isStale: vi.fn().mockResolvedValue(false),
    markSynced: vi.fn(),
    hydrate: vi.fn(),
    importL3Cards: vi.fn().mockResolvedValue({ cardsFound: 0, imported: 0 }),

    ...overrides,
  };
}

/** Pure orchestration unit test — see docs/gitbook/architecture/testing-and-quality-architecture.md's "Factory Lock". */
function makeMockStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
  return {
    projects: {
      getFirst: vi.fn(),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn().mockReturnValue(1),
    },
    files: {
      getAllHashes: vi.fn(),
      upsertFile: vi.fn(),
      markTierBProcessed: vi.fn(),
      getTierBFileStatus: vi.fn(),
      getTierBCoverage: vi
        .fn()
        .mockReturnValue({ totalFiles: 10, processedFiles: 8 }),
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
      count: vi.fn().mockReturnValue({ l2Nodes: 4, l3Nodes: 9 }),
      findNodesForChangedFiles: vi.fn(),
      findNodeByName: vi.fn(),
      getIncomingEdges: vi.fn(),
      getOutgoingEdges: vi.fn(),
      getIncomingRelations: vi.fn(),
      getOutgoingRelations: vi.fn(),
      getAllNodes: vi.fn(),
      getAllLinks: vi.fn(),
      bulkLoadGraph: vi.fn(),
      pruneOrphanedLinks: vi.fn().mockReturnValue(0),
      withFtsSyncSuspended: (fn: any) => fn(),
    },
    l3: {
      getById: vi.fn(),
      getAllExportable: vi.fn(),
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

describe("StatusWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("opens the store readonly, reports counts, and closes it", async () => {
    const store = makeMockStore();
    const openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.lock();

    const result = await new StatusWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(openStoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({ readonly: true }),
    );
    expect(result).toEqual({
      projects: 1,
      l2Nodes: 4,
      l3Nodes: 9,
      tierBFilesProcessed: 8,
      tierBFilesTotal: 10,
      tierCQueued: 0,
      // No GitProvider registered in this test -- freshness degrades to unknown.
      graphFreshness: "unknown",
    });
    // Called twice: once by the ensureHydrated() staleness check, once by the workflow's own read.
    expect(store.close).toHaveBeenCalledTimes(2);
  });

  it("reports the pending Tier C queue size so a permanently-empty queue is visible (issue #58)", async () => {
    const store = makeMockStore({
      meta: {
        get: vi.fn((key: string) =>
          key === GitConstants.META_KEY_TIER_C_QUEUE
            ? JSON.stringify([
                { kind: "commitMessage", target: "abc", commitSha: "abc" },
                {
                  kind: "contractSymbol",
                  target: "src/a.ts#foo",
                  commitSha: "abc",
                  file: "src/a.ts",
                },
              ])
            : undefined,
        ),
        set: vi.fn(),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.lock();

    const result = await new StatusWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(result.tierCQueued).toBe(2);
  });

  it("reports graphFreshness fresh when last-ingested matches HEAD (issue #193)", async () => {
    const store = makeMockStore({
      meta: {
        get: vi.fn((key: string) =>
          key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
            ? "abc123"
            : undefined,
        ),
        set: vi.fn(),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.register(
      TOKENS.GitProvider,
      () =>
        ({
          getHeadSha: vi.fn().mockResolvedValue("abc123"),
        }) as any,
    );
    docuviaFactory.lock();

    const result = await new StatusWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(result.graphFreshness).toBe("fresh");
  });

  it("reports graphFreshness stale when last-ingested lags HEAD (issue #193)", async () => {
    const store = makeMockStore({
      meta: {
        get: vi.fn((key: string) =>
          key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
            ? "old-sha"
            : undefined,
        ),
        set: vi.fn(),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.register(
      TOKENS.GitProvider,
      () =>
        ({
          getHeadSha: vi.fn().mockResolvedValue("new-sha"),
        }) as any,
    );
    docuviaFactory.lock();

    const result = await new StatusWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(result.graphFreshness).toBe("stale");
  });

  it("degrades graphFreshness to unknown when HEAD is unborn, meta is missing, or git throws (issue #193)", async () => {
    const nullHeadStore = makeMockStore({
      meta: {
        get: vi.fn((key: string) =>
          key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
            ? "abc123"
            : undefined,
        ),
        set: vi.fn(),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(nullHeadStore),
    );
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.register(
      TOKENS.GitProvider,
      () =>
        ({
          getHeadSha: vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce("abc123")
            .mockRejectedValueOnce(new Error("git failed")),
        }) as any,
    );
    docuviaFactory.lock();

    const workflow = new StatusWorkflow("/workspace/demo", createMockLogger());
    // Unborn HEAD -> unknown.
    expect((await workflow.execute()).graphFreshness).toBe("unknown");
    // Missing meta (second call returns undefined for every key) -> unknown.
    (nullHeadStore.meta.get as ReturnType<typeof vi.fn>).mockImplementation(
      () => undefined,
    );
    expect((await workflow.execute()).graphFreshness).toBe("unknown");
    // Git throwing -> unknown, never a status crash.
    (nullHeadStore.meta.get as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) =>
        key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
          ? "abc123"
          : undefined,
    );
    expect((await workflow.execute()).graphFreshness).toBe("unknown");
  });

  it('throws a DocuviaError with a "run docuvia init" message when the db is missing', async () => {
    const dbOpenError = new DocuviaError(
      "DB_NOT_FOUND",
      "Local database not found at /x. Please run docuvia init.",
    );
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockRejectedValue(dbOpenError),
    );
    docuviaFactory.lock();

    await expect(
      new StatusWorkflow("/workspace/demo", createMockLogger()).execute(),
    ).rejects.toMatchObject({
      code: "DB_NOT_FOUND",
      message: expect.stringContaining("docuvia init"),
    });
  });

  it("propagates a DB_OPEN_FAILED (present but unopenable db) with its real cause unmasked", async () => {
    const dbOpenError = new DocuviaError(
      "DB_OPEN_FAILED",
      "Failed to open database at /x: The module better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 141. This version of Node.js requires NODE_MODULE_VERSION 137.",
    );
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockRejectedValue(dbOpenError),
    );
    docuviaFactory.lock();

    await expect(
      new StatusWorkflow("/workspace/demo", createMockLogger()).execute(),
    ).rejects.toMatchObject({
      code: "DB_OPEN_FAILED",
      message: expect.stringContaining(
        "compiled against a different Node.js version",
      ),
    });
  });

  it("closes the store even when a count() call throws", async () => {
    const store = makeMockStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        getSemanticCoverage: vi.fn(),
        getCanarySample: vi.fn().mockReturnValue([]),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn().mockImplementation(() => {
          throw new Error("boom");
        }),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getIncomingRelations: vi.fn(),
        getOutgoingRelations: vi.fn(),
        getAllNodes: vi.fn(),
        getAllLinks: vi.fn(),
        bulkLoadGraph: vi.fn(),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
        withFtsSyncSuspended: (fn: any) => fn(),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.lock();

    await expect(
      new StatusWorkflow("/workspace/demo", createMockLogger()).execute(),
    ).rejects.toThrow("boom");
    expect(store.close).toHaveBeenCalledTimes(2);
  });
});
