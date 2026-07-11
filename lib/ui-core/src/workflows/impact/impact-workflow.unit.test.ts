import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGraphStore,
  type IImpactService,
} from "@workspace/contracts";
import { ImpactWorkflow } from "./impact-workflow.js";

function makeMockStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
  return {
    projects: { getFirst: vi.fn(), insert: vi.fn(), count: vi.fn() },
    files: { getAllHashes: vi.fn(), upsertFile: vi.fn() },
    tags: { upsertTag: vi.fn(), getIdByName: vi.fn(), linkNodeToTag: vi.fn(), getAllTagLinks: vi.fn() },
    graph: {
      deleteNodesForPath: vi.fn(),
      insertNode: vi.fn(),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn(),
      count: vi.fn(),
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

describe("ImpactWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("resolves the blast radius and risk level for a found target, then closes the store", async () => {
    const store = makeMockStore();
    const openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);

    const impactService: IImpactService = {
      getBlastRadius: vi.fn().mockReturnValue([{ name: "caller", type: "module" }]),
      computeRiskLevel: vi.fn().mockReturnValue("MEDIUM"),
    };
    docuviaFactory.register(TOKENS.ImpactService, () => impactService);
    docuviaFactory.lock();

    const result = await new ImpactWorkflow("/workspace/demo", createMockLogger()).execute("target");

    expect(result).toEqual({ blastRadius: [{ name: "caller", type: "module" }], riskLevel: "MEDIUM" });
    expect(impactService.computeRiskLevel).toHaveBeenCalledWith(1);
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("returns null when the target does not resolve", async () => {
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => vi.fn().mockResolvedValue(store));
    const impactService: IImpactService = {
      getBlastRadius: vi.fn().mockReturnValue(undefined),
      computeRiskLevel: vi.fn(),
    };
    docuviaFactory.register(TOKENS.ImpactService, () => impactService);
    docuviaFactory.lock();

    const result = await new ImpactWorkflow("/workspace/demo", createMockLogger()).execute("nope");

    expect(result).toBeNull();
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('throws a DocuviaError with a "run docuvia init" message when the db is missing', async () => {
    const dbOpenError = new DocuviaError("DB_OPEN_FAILED", "Failed to open database at /x: ENOENT");
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => vi.fn().mockRejectedValue(dbOpenError));
    docuviaFactory.lock();

    await expect(
      new ImpactWorkflow("/workspace/demo", createMockLogger()).execute("target")
    ).rejects.toMatchObject({
      code: "DB_OPEN_FAILED",
      message: expect.stringContaining("docuvia init"),
    });
  });
});
