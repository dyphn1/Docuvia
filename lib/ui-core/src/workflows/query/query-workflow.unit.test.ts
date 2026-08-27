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
  type IQueryService,
} from "@workspace/contracts";
import { QueryWorkflow } from "./query-workflow.js";

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

describe("QueryWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("delegates to QueryService.query() and closes the store", async () => {
    const store = makeMockStore();
    const openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);

    const queryResult = {
      l2: { name: "authService", matchType: "exact" as const },
      l3: [],
      context: null,
    };
    const queryService: IQueryService = {
      extractKeywords: vi.fn(),
      getContext: vi.fn(),
      search: vi.fn(),
      query: vi.fn().mockReturnValue(queryResult),
    };
    docuviaFactory.register(TOKENS.QueryService, () => queryService);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.lock();

    const result = await new QueryWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute("authService", 5);

    // Verify the service was called with correct arguments
    expect(queryService.query).toHaveBeenCalledWith(store, "authService", 5);
    // Verify the full result structure matches the QueryResult contract
    expect(result).toEqual(queryResult);
    expect(result.l2).toEqual({ name: "authService", matchType: "exact" });
    expect(result.l3).toEqual([]);
    expect(result.context).toBeNull();
    // Verify no extra/unexpected properties leaked into the result
    expect(Object.keys(result)).toEqual(["l2", "l3", "context"]);
    // Called twice: once by the ensureHydrated() staleness check, once by the workflow's own read.
    expect(store.close).toHaveBeenCalledTimes(2);
  });

  it("passes through a full QueryResult with l3 entries and context without dropping fields", async () => {
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );

    const fullQueryResult = {
      l2: {
        name: "authService",
        type: "module",
        filePath: "src/auth.ts",
        matchType: "exact" as const,
      },
      l3: [
        { title: "auth decision", content: "handles JWT", confidence: 0.9 },
        { title: "rate limiter", content: "throttle", confidence: 0.7 },
      ],
      context: {
        incoming: [{ name: "router", type: "module" }],
        outgoing: [{ name: "logger", type: "module" }],
      },
    };
    const queryService: IQueryService = {
      extractKeywords: vi.fn(),
      getContext: vi.fn(),
      search: vi.fn(),
      query: vi.fn().mockReturnValue(fullQueryResult),
    };
    docuviaFactory.register(TOKENS.QueryService, () => queryService);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.lock();

    const result = await new QueryWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute("authService", 10);

    // Verify the full structure is passed through without field loss
    expect(result.l2).toEqual({
      name: "authService",
      type: "module",
      filePath: "src/auth.ts",
      matchType: "exact",
    });
    expect(result.l3).toHaveLength(2);
    expect(result.l3[0]).toEqual({
      title: "auth decision",
      content: "handles JWT",
      confidence: 0.9,
    });
    expect(result.l3[1]).toEqual({
      title: "rate limiter",
      content: "throttle",
      confidence: 0.7,
    });
    expect(result.context).toEqual({
      incoming: [{ name: "router", type: "module" }],
      outgoing: [{ name: "logger", type: "module" }],
    });
    expect(Object.keys(result)).toEqual(["l2", "l3", "context"]);
  });

  it("returns an exact-shape null-l2 result when the target doesn't resolve", async () => {
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );

    const emptyResult = { l2: null, l3: [], context: null };
    const queryService: IQueryService = {
      extractKeywords: vi.fn(),
      getContext: vi.fn(),
      search: vi.fn(),
      query: vi.fn().mockReturnValue(emptyResult),
    };
    docuviaFactory.register(TOKENS.QueryService, () => queryService);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.lock();

    const result = await new QueryWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute("nonexistent", 5);

    expect(result).toEqual({ l2: null, l3: [], context: null });
    expect(result.l2).toBeNull();
    expect(result.l3).toEqual([]);
    expect(result.context).toBeNull();
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
      new QueryWorkflow("/workspace/demo", createMockLogger()).execute(
        "target",
      ),
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
      new QueryWorkflow("/workspace/demo", createMockLogger()).execute(
        "target",
      ),
    ).rejects.toMatchObject({
      code: "DB_OPEN_FAILED",
      message: expect.stringContaining(
        "compiled against a different Node.js version",
      ),
    });
  });
});
