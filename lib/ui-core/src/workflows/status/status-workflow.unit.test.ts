import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGraphStore,
} from "@workspace/contracts";
import { StatusWorkflow } from "./status-workflow.js";

/** Pure orchestration unit test — see docs/gitbook/architecture/testing-and-quality-architecture.md's "Factory Lock". */
function makeMockStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
  return {
    projects: { getFirst: vi.fn(), insert: vi.fn(), count: vi.fn().mockReturnValue(1) },
    files: { getAllHashes: vi.fn(), upsertFile: vi.fn() },
    tags: { upsertTag: vi.fn(), getIdByName: vi.fn(), linkNodeToTag: vi.fn(), getAllTagLinks: vi.fn() },
    graph: {
      deleteNodesForPath: vi.fn(),
      insertNode: vi.fn(),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn(),
      count: vi.fn().mockReturnValue({ l2Nodes: 4, l3Nodes: 9 }),
      findNodesForChangedFiles: vi.fn(),
      findNodeByName: vi.fn(),
      getIncomingEdges: vi.fn(),
      getOutgoingEdges: vi.fn(),
      getAllNodes: vi.fn(),
      getAllLinks: vi.fn(),
    },
    l3: { getById: vi.fn(), getAllExportable: vi.fn() },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    withWriteLock: async (fn) => fn(),
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
    docuviaFactory.lock();

    const result = await new StatusWorkflow("/workspace/demo", createMockLogger()).execute();

    expect(openStoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({ readonly: true })
    );
    expect(result).toEqual({ projects: 1, l2Nodes: 4, l3Nodes: 9 });
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('throws a DocuviaError with a "run docuvia init" message when the db is missing', async () => {
    const dbOpenError = new DocuviaError("DB_OPEN_FAILED", "Failed to open database at /x: ENOENT");
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => vi.fn().mockRejectedValue(dbOpenError));
    docuviaFactory.lock();

    await expect(
      new StatusWorkflow("/workspace/demo", createMockLogger()).execute()
    ).rejects.toMatchObject({
      code: "DB_OPEN_FAILED",
      message: expect.stringContaining("docuvia init"),
    });
  });

  it("closes the store even when a count() call throws", async () => {
    const store = makeMockStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        count: vi.fn().mockImplementation(() => {
          throw new Error("boom");
        }),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getAllNodes: vi.fn(),
        getAllLinks: vi.fn(),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => vi.fn().mockResolvedValue(store));
    docuviaFactory.lock();

    await expect(
      new StatusWorkflow("/workspace/demo", createMockLogger()).execute()
    ).rejects.toThrow("boom");
    expect(store.close).toHaveBeenCalledTimes(1);
  });
});
