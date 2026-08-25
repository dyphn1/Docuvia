import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";

vi.mock("../../utils/command-log-writer.js", () => ({
  appendCommandLogLine: vi.fn(async () => undefined),
}));
vi.mock("fs/promises");
import * as fs from "fs/promises";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGraphStore,
  type IHydrationService,
  type IImpactService,
  type ITierBCoverageHintProvider,
} from "@workspace/contracts";
import { ImpactWorkflow } from "./impact-workflow.js";
import { IMPACT_MESSAGES } from "./impact-messages.js";

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

function makeMockTierBCoverageHintProvider(
  overrides: Partial<ITierBCoverageHintProvider> = {},
): ITierBCoverageHintProvider {
  return {
    resolve: vi.fn().mockReturnValue(undefined),
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
      // Full-coverage default -- issue #192's epistemic ladder treats unreadable counts as
      // incomplete, which would flag every result lower-bound; tests exercising the partial
      // path override this explicitly.
      getTierBCoverage: vi
        .fn()
        .mockReturnValue({ totalFiles: 10, processedFiles: 10 }),
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

describe("ImpactWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
    docuviaFactory.register(TOKENS.TierBCoverageHintProvider, () =>
      makeMockTierBCoverageHintProvider(),
    );
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
      getBlastRadius: vi
        .fn()
        .mockReturnValue([{ name: "caller", type: "module" }]),
      computeRiskLevel: vi.fn().mockReturnValue("MEDIUM"),
    };
    docuviaFactory.register(TOKENS.ImpactService, () => impactService);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.lock();

    const result = await new ImpactWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute("target");

    expect(result).toEqual({
      blastRadius: [{ name: "caller", type: "module" }],
      riskLevel: "MEDIUM",
    });
    expect(impactService.computeRiskLevel).toHaveBeenCalledWith(store, 1);
    // Called twice: once by the ensureHydrated() staleness check, once by the workflow's own read.
    expect(store.close).toHaveBeenCalledTimes(2);
  });

  it("returns null when the target does not resolve", async () => {
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    const impactService: IImpactService = {
      getBlastRadius: vi.fn().mockReturnValue(undefined),
      computeRiskLevel: vi.fn(),
    };
    docuviaFactory.register(TOKENS.ImpactService, () => impactService);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.lock();

    const result = await new ImpactWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute("nope");

    expect(result).toBeNull();
    expect(store.close).toHaveBeenCalledTimes(2);
  });

  it("attaches tierBCoverage and an UNKNOWN risk verdict when the blast radius is empty and workspace Tier B coverage is incomplete (typescript-cli-benchmark.md §5.3/§5.7 item 2 + issue #192)", async () => {
    const store = makeMockStore({
      graph: {
        ...makeMockStore().graph,
        findNodeByName: vi.fn().mockReturnValue({
          id: 1,
          name: "target",
          type: "module",
          filePath: "src/target.ts",
        }),
      },
      files: {
        ...makeMockStore().files,
        getTierBFileStatus: vi.fn().mockReturnValue({
          lastProcessedAt: "2026-01-01",
          lastProcessedCommitSha: "abc",
        }),
        getTierBCoverage: vi
          .fn()
          .mockReturnValue({ totalFiles: 10, processedFiles: 3 }),
      },
    });
    const openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);

    const impactService: IImpactService = {
      getBlastRadius: vi.fn().mockReturnValue([]),
      computeRiskLevel: vi.fn().mockReturnValue("LOW"),
    };
    docuviaFactory.register(TOKENS.ImpactService, () => impactService);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    const tierBCoverageHint = {
      ownFileLastProcessedAt: "2026-01-01",
      workspaceFilesProcessed: 3,
      workspaceFilesTotal: 10,
    };
    docuviaFactory.register(TOKENS.TierBCoverageHintProvider, () =>
      makeMockTierBCoverageHintProvider({ resolve: () => tierBCoverageHint }),
    );
    docuviaFactory.lock();

    const result = await new ImpactWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute("target");

    expect(result).toEqual({
      blastRadius: [],
      riskLevel: "UNKNOWN",
      epistemic: "lower-bound",
      riskNote: IMPACT_MESSAGES.RISK_NOTE_EMPTY_WITH_PARTIAL_COVERAGE(3, 10),
      tierBCoverage: tierBCoverageHint,
    });
  });

  it("reports UNKNOWN (never a confident LOW) when the blast radius is empty even at full Tier B coverage -- static edges only model calls/extends/implements, so zero is never trusted (issue #192)", async () => {
    const store = makeMockStore({
      graph: {
        ...makeMockStore().graph,
        findNodeByName: vi.fn().mockReturnValue({
          id: 1,
          name: "target",
          type: "module",
          filePath: "src/target.ts",
        }),
      },
      files: {
        ...makeMockStore().files,
        getTierBFileStatus: vi.fn().mockReturnValue({
          lastProcessedAt: "2026-01-01",
          lastProcessedCommitSha: "abc",
        }),
        getTierBCoverage: vi
          .fn()
          .mockReturnValue({ totalFiles: 10, processedFiles: 10 }),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );

    const impactService: IImpactService = {
      getBlastRadius: vi.fn().mockReturnValue([]),
      computeRiskLevel: vi.fn().mockReturnValue("LOW"),
    };
    docuviaFactory.register(TOKENS.ImpactService, () => impactService);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeMockHydrationService(),
    );
    docuviaFactory.lock();

    const result = await new ImpactWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute("target");

    expect(result).toEqual({
      blastRadius: [],
      riskLevel: "UNKNOWN",
      epistemic: "lower-bound",
      riskNote: IMPACT_MESSAGES.RISK_NOTE_EMPTY_STATIC_EDGES_ONLY,
    });
    expect(result && "tierBCoverage" in result).toBe(false);
  });

  describe("coverageNote (issue #136 -- registry-mediated dependents the static edge graph can't see)", () => {
    function makeStoreWithTargetNode(
      blastRadius: unknown[],
      findNodeByNameValue:
        | { id: number; name: string; type: string; filePath: string }
        | undefined,
    ) {
      const store = makeMockStore({
        graph: {
          ...makeMockStore().graph,
          findNodeByName: vi.fn().mockReturnValue(findNodeByNameValue),
        },
      });
      const impactService: IImpactService = {
        getBlastRadius: vi.fn().mockReturnValue(blastRadius),
        computeRiskLevel: vi.fn().mockReturnValue("LOW"),
      };
      return { store, impactService };
    }

    it("attaches the note when the blast radius is empty and the resolved node's own file uses the docuviaFactory/TOKENS registry pattern -- issue #136's exact false-LOW repro, now surfaced as riskNote (issue #192)", async () => {
      const { store, impactService } = makeStoreWithTargetNode([], {
        id: 1,
        name: "someSymbol",
        type: "module",
        filePath: "lib/contracts/src/index.ts",
      });
      vi.mocked(fs.readFile).mockResolvedValue(
        'import { docuviaFactory, TOKENS } from "@workspace/contracts";\ndocuviaFactory.register(TOKENS.SomeToken, () => impl);\n',
      );
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      docuviaFactory.register(TOKENS.ImpactService, () => impactService);
      docuviaFactory.register(TOKENS.HydrationService, () =>
        makeMockHydrationService(),
      );
      docuviaFactory.lock();

      const result = await new ImpactWorkflow(
        "/workspace/demo",
        createMockLogger(),
      ).execute("someSymbol");

      expect(fs.readFile).toHaveBeenCalledWith(
        path.join("/workspace/demo", "lib/contracts/src/index.ts"),
        expect.any(String),
      );
      // The epistemic ladder picked the registry wording as riskNote, so the standalone
      // coverageNote is suppressed (same sentence twice adds nothing).
      expect(result).toEqual({
        blastRadius: [],
        riskLevel: "UNKNOWN",
        epistemic: "lower-bound",
        riskNote: IMPACT_MESSAGES.REGISTRY_MEDIATED_COVERAGE_NOTE,
      });
    });

    it("reports UNKNOWN with the static-edges-only note when the blast radius is empty and the file has no registry pattern -- 'no dependents' is never a confident LOW (issue #192)", async () => {
      const { store, impactService } = makeStoreWithTargetNode([], {
        id: 1,
        name: "plainSymbol",
        type: "module",
        filePath: "src/plain.ts",
      });
      vi.mocked(fs.readFile).mockResolvedValue(
        "export function plainSymbol() { return 1; }\n",
      );
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      docuviaFactory.register(TOKENS.ImpactService, () => impactService);
      docuviaFactory.register(TOKENS.HydrationService, () =>
        makeMockHydrationService(),
      );
      docuviaFactory.lock();

      const result = await new ImpactWorkflow(
        "/workspace/demo",
        createMockLogger(),
      ).execute("plainSymbol");

      expect(result).toEqual({
        blastRadius: [],
        riskLevel: "UNKNOWN",
        epistemic: "lower-bound",
        riskNote: IMPACT_MESSAGES.RISK_NOTE_EMPTY_STATIC_EDGES_ONLY,
      });
      expect(result && "coverageNote" in result).toBe(false);
    });

    it("reports UNKNOWN with the static-edges-only note when the file can't be read (deleted on disk / path mismatch) -- an unreadable file is never an error, just no registry hedge", async () => {
      const { store, impactService } = makeStoreWithTargetNode([], {
        id: 1,
        name: "ghostSymbol",
        type: "module",
        filePath: "src/ghost.ts",
      });
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      docuviaFactory.register(TOKENS.ImpactService, () => impactService);
      docuviaFactory.register(TOKENS.HydrationService, () =>
        makeMockHydrationService(),
      );
      docuviaFactory.lock();

      const result = await new ImpactWorkflow(
        "/workspace/demo",
        createMockLogger(),
      ).execute("ghostSymbol");

      expect(result).toEqual({
        blastRadius: [],
        riskLevel: "UNKNOWN",
        epistemic: "lower-bound",
        riskNote: IMPACT_MESSAGES.RISK_NOTE_EMPTY_STATIC_EDGES_ONLY,
      });
      expect(result && "coverageNote" in result).toBe(false);
    });

    it("omits the note when the blast radius is non-empty even if the file uses the registry -- a real blast radius at full coverage is an exact answer", async () => {
      const { store, impactService } = makeStoreWithTargetNode(
        [{ name: "dependent", type: "module" }],
        {
          id: 1,
          name: "registeringSymbol",
          type: "module",
          filePath: "src/registry.ts",
        },
      );
      vi.mocked(fs.readFile).mockResolvedValue(
        "docuviaFactory.register(TOKENS.X, () => impl);\n",
      );
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      docuviaFactory.register(TOKENS.ImpactService, () => impactService);
      docuviaFactory.register(TOKENS.HydrationService, () =>
        makeMockHydrationService(),
      );
      docuviaFactory.lock();

      const result = await new ImpactWorkflow(
        "/workspace/demo",
        createMockLogger(),
      ).execute("registeringSymbol");

      expect(result).toEqual({
        blastRadius: [{ name: "dependent", type: "module" }],
        riskLevel: "LOW",
      });
      expect(result && "coverageNote" in result).toBe(false);
    });
  });

  describe("low own-file call resolution note (issue #221 P2')", () => {
    function makeStoreWithResolution(
      filePath: string,
      byFile: Record<string, unknown>,
    ) {
      const store = makeMockStore({
        graph: {
          ...makeMockStore().graph,
          findNodeByName: vi
            .fn()
            .mockReturnValue({ id: 1, name: "s", type: "module", filePath }),
        },
        meta: {
          get: vi.fn().mockReturnValue(JSON.stringify({ byFile })),
          set: vi.fn(),
        },
      });
      const impactService: IImpactService = {
        getBlastRadius: vi.fn().mockReturnValue([]),
        computeRiskLevel: vi.fn().mockReturnValue("LOW"),
      };
      return { store, impactService };
    }

    async function executeWith(
      store: IGraphStore,
      impactService: IImpactService,
    ) {
      // Non-registry file contents -- an earlier test's mockResolvedValue would otherwise
      // leak in and trip the higher-priority registry-mediated rung.
      vi.mocked(fs.readFile).mockResolvedValue("export const x = 1;\n");
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi.fn().mockResolvedValue(store),
      );
      docuviaFactory.register(TOKENS.ImpactService, () => impactService);
      docuviaFactory.register(TOKENS.HydrationService, () =>
        makeMockHydrationService(),
      );
      docuviaFactory.lock();
      return new ImpactWorkflow("/workspace/demo", createMockLogger()).execute(
        "s",
      );
    }

    it("attaches the low-resolution why-note when the target's own file resolved few of its call sites", async () => {
      const { store, impactService } = makeStoreWithResolution("src/low.ts", {
        "src/low.ts": {
          total: 10,
          resolved: 1,
          selfDiscarded: 0,
          unresolved: 9,
        },
      });

      const result = await executeWith(store, impactService);

      expect(result).toEqual({
        blastRadius: [],
        riskLevel: "UNKNOWN",
        epistemic: "lower-bound",
        riskNote: IMPACT_MESSAGES.RISK_NOTE_EMPTY_LOW_RESOLUTION(1, 10),
      });
    });

    it("omits the note when the target's file has no stamped resolution stats (absent = generic caveat)", async () => {
      const { store, impactService } = makeStoreWithResolution("src/plain.ts", {
        "other.ts": { total: 10, resolved: 1, selfDiscarded: 0, unresolved: 9 },
      });

      const result = await executeWith(store, impactService);

      expect(result).toMatchObject({
        riskLevel: "UNKNOWN",
        riskNote: IMPACT_MESSAGES.RISK_NOTE_EMPTY_STATIC_EDGES_ONLY,
      });
    });
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
      new ImpactWorkflow("/workspace/demo", createMockLogger()).execute(
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
      "Failed to open database at /x: The module better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 141.",
    );
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockRejectedValue(dbOpenError),
    );
    docuviaFactory.lock();

    await expect(
      new ImpactWorkflow("/workspace/demo", createMockLogger()).execute(
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
