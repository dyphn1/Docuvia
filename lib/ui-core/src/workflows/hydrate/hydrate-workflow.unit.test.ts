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
  type IGraphStore,
  type IHydrationService,
} from "@workspace/contracts";
import { HydrateWorkflow } from "./hydrate-workflow.js";

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
    },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    meta: { get: vi.fn(), set: vi.fn() },
    callSites: {
      deleteForFile: vi.fn(),
      insertMany: vi.fn(),
      getForFiles: vi.fn().mockReturnValue(new Map()),
    },
    withWriteLock: async (fn) => fn(),
    withTransaction: (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi.fn(),
    ...overrides,
  };
}

describe("HydrateWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("opens the store read-write (not readonly), hydrates via IHydrationService, and closes the store", async () => {
    const store = makeMockStore();
    const openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);

    const hydrationResult = {
      hydrated: true,
      knowledgeSha: "abc1234",
      nodesLoaded: 2,
      edgesLoaded: 1,
      edgesDropped: 0,
    };
    const hydrationService: IHydrationService = {
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn(),
      markSynced: vi.fn(),
      hydrate: vi.fn().mockResolvedValue(hydrationResult),
    };
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    const result = await new HydrateWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(openStoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({ readonly: false }),
    );
    expect(hydrationService.hydrate).toHaveBeenCalledWith(
      "/workspace/demo",
      store,
      undefined,
      undefined,
    );
    expect(result).toEqual(hydrationResult);
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("returns hydrated:false without throwing when there's nothing to hydrate from yet", async () => {
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    const hydrationService: IHydrationService = {
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn(),
      markSynced: vi.fn(),
      hydrate: vi.fn().mockResolvedValue({
        hydrated: false,
        nodesLoaded: 0,
        edgesLoaded: 0,
        edgesDropped: 0,
      }),
    };
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    const result = await new HydrateWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(result.hydrated).toBe(false);
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("closes the store even when hydrate() throws", async () => {
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    const hydrationService: IHydrationService = {
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn(),
      markSynced: vi.fn(),
      hydrate: vi.fn().mockRejectedValue(new Error("git command failed")),
    };
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    await expect(
      new HydrateWorkflow("/workspace/demo", createMockLogger()).execute(),
    ).rejects.toThrow("git command failed");
    expect(store.close).toHaveBeenCalledTimes(1);
  });
});
