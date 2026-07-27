import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGraphStore,
  type IHydrationService,
} from "@workspace/contracts";
import { ensureHydrated } from "./ensure-hydrated.js";

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
      getIncomingRelations: vi.fn(),
      getOutgoingRelations: vi.fn(),
      getAllNodes: vi.fn(),
      getAllLinks: vi.fn(),
      bulkLoadGraph: vi.fn(),
      pruneOrphanedLinks: vi.fn().mockReturnValue(0),
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
    withWriteLock: async (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi.fn(),
    ...overrides,
  };
}

describe("ensureHydrated()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("hydrates when IHydrationService.isStale() says the store is stale", async () => {
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi
        .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
        .mockResolvedValue(store),
    );
    const hydrationService: IHydrationService = {
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn().mockResolvedValue(true),
      markSynced: vi.fn(),
      hydrate: vi.fn().mockResolvedValue({
        hydrated: true,
        nodesLoaded: 1,
        edgesLoaded: 0,
        edgesDropped: 0,
      }),
    };
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    await ensureHydrated("/workspace/demo", createMockLogger());

    expect(hydrationService.hydrate).toHaveBeenCalledWith(
      "/workspace/demo",
      store,
    );
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("does not hydrate when IHydrationService.isStale() says the store is up to date", async () => {
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    const hydrationService: IHydrationService = {
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn().mockResolvedValue(false),
      markSynced: vi.fn(),
      hydrate: vi.fn(),
    };
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    await ensureHydrated("/workspace/demo", createMockLogger());

    expect(hydrationService.hydrate).not.toHaveBeenCalled();
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("silently returns (does not throw) when the store can't be opened, leaving the caller's own openStore() to surface the error", async () => {
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockRejectedValue(new Error("ENOENT")),
    );
    const hydrationService: IHydrationService = {
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn(),
      markSynced: vi.fn(),
      hydrate: vi.fn(),
    };
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    await expect(
      ensureHydrated("/workspace/demo", createMockLogger()),
    ).resolves.toBeUndefined();
    expect(hydrationService.isStale).not.toHaveBeenCalled();
  });
});
