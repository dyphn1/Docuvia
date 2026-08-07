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
  type ITopologyBuilder,
} from "@workspace/contracts";
import { ExportTopologyWorkflow } from "./export-topology-workflow.js";

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
      getAllTagLinks: vi.fn().mockReturnValue([]),
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

describe("ExportTopologyWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("gathers rows from the store and delegates to ITopologyBuilder.build(), then closes the store", async () => {
    const store = makeMockStore();
    const openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);

    const graph = {
      topologyVersion: 1,
      generatedAt: "now",
      workspaceRoot: "/workspace/demo",
      collapsed: false,
      nodes: [],
      links: [],
      groups: [],
      stats: { nodeCount: 0, linkCount: 0, groupCount: 0, foldedLinkCount: 0 },
    };
    const topologyBuilder: ITopologyBuilder = {
      build: vi.fn().mockReturnValue(graph),
    };
    docuviaFactory.register(TOKENS.TopologyBuilder, () => topologyBuilder);
    docuviaFactory.lock();

    const result = await new ExportTopologyWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute({
      collapse: "file",
    });

    expect(topologyBuilder.build).toHaveBeenCalledWith(
      {
        workspaceRoot: "/workspace/demo",
        l2Rows: [],
        linkRows: [],
        l3Rows: [],
        tagRows: [],
      },
      { collapse: "file" },
    );
    expect(result).toBe(graph);
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('throws a DocuviaError with a "run docuvia init" message when the db is missing', async () => {
    const dbOpenError = new DocuviaError(
      "DB_OPEN_FAILED",
      "Failed to open database at /x: ENOENT",
    );
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockRejectedValue(dbOpenError),
    );
    docuviaFactory.lock();

    await expect(
      new ExportTopologyWorkflow(
        "/workspace/demo",
        createMockLogger(),
      ).execute(),
    ).rejects.toMatchObject({
      code: "DB_OPEN_FAILED",
      message: expect.stringContaining("docuvia init"),
    });
  });
});
