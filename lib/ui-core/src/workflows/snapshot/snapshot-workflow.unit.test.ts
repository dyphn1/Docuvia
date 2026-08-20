import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/command-log-writer.js", () => ({
  appendCommandLogLine: vi.fn(async () => undefined),
}));
import fs from "fs/promises";
import path from "path";
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
  type L3NodeRow,
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

describe("SnapshotWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
    const git = {
      getHeadSha: vi.fn().mockResolvedValue("mock-head-sha"),
    };
    docuviaFactory.register(TOKENS.GitProvider, () => git as any);
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("bulk-reads the store, renders via ISnapshotRenderer, packs onto the knowledge branch, then closes the store", async () => {
    const store = makeMockStore({
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
        getAllNodes: vi.fn().mockReturnValue([{ id: 1 }]),
        getAllLinks: vi.fn().mockReturnValue([{ id: 1 }]),
        bulkLoadGraph: vi.fn(),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
        withFtsSyncSuspended: (fn: any) => fn(),
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
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
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
      "DB_NOT_FOUND",
      "Local database not found at /x. Please run docuvia init.",
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
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn(),
      syncKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    }));
    docuviaFactory.lock();

    await expect(
      new SnapshotWorkflow("/workspace/demo", createMockLogger()).execute(),
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
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn(),
    }));
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => ({
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
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
      message: expect.stringContaining(
        "compiled against a different Node.js version",
      ),
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
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
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

  it("renders knowledge/_l3/<content_hash>.md cards for exportable L3 rows into tempDir before packing, with source_commits frozen at initial_source_commits", async () => {
    const l2Rows = [
      {
        id: 1,
        project_id: 1,
        name: "src/a.ts",
        type: "module",
        is_system: 0,
        description: null,
        ai_generated: 1,
        needs_review: 0,
        created_at: "",
        last_verified_at: null,
        path_patterns: JSON.stringify(["src/a.ts"]),
        reindex_required: 0,
        is_bootstrap_confirmed: 0,
        content_hash: null,
        updated_at: "",
        node_key: "src/a.ts",
      },
    ];
    const l3Row: L3NodeRow = {
      id: 1,
      l2_node_id: 1,
      title: "Uses async/await throughout",
      content: "All I/O paths use async/await.",
      node_type: "decision",
      source_commits: JSON.stringify(["commit-1", "commit-2"]),
      commit_hash: "commit-2",
      ai_generated: 1,
      confidence: 0.9,
      noise_score: null,
      created_at: "2024-01-01T00:00:00.000Z",
      last_verified_at: null,
      occurrence_count: 2,
      introduced_in_commit: null,
      verified_until_commit: null,
      validity_status: "pending",
      source: "analyze",
      content_hash: "abc123hash",
      extraction_model: "gpt-4o-mini",
      source_files: JSON.stringify(["src/a.ts"]),
      initial_source_commits: JSON.stringify(["commit-1"]),
    };

    const store = makeMockStore({
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
        getAllNodes: vi.fn().mockReturnValue(l2Rows),
        getAllLinks: vi.fn().mockReturnValue([]),
        bulkLoadGraph: vi.fn(),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
        withFtsSyncSuspended: (fn: any) => fn(),
      },
      l3: {
        getById: vi.fn(),
        getAllExportable: vi.fn().mockReturnValue([l3Row]),
        getByL2NodeId: vi.fn(),
        upsertDecision: vi.fn(),
        importCard: vi.fn(),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn().mockResolvedValue({
        nodesWritten: 1,
        edgesWritten: 0,
        markdownFilesWritten: 1,
      }),
    }));

    let l3CardFileNames: string[] = [];
    let l3CardContent = "";
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => ({
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
      packSnapshotToKnowledgeBranch: vi
        .fn()
        .mockImplementation(async (_cwd: string, tempDir: string) => {
          const l3Dir = path.join(tempDir, "knowledge", "_l3");
          l3CardFileNames = await fs.readdir(l3Dir);
          l3CardContent = await fs.readFile(
            path.join(l3Dir, l3CardFileNames[0]),
            "utf8",
          );
        }),
      syncKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    }));
    docuviaFactory.lock();

    await new SnapshotWorkflow("/workspace/demo", createMockLogger()).execute();

    expect(l3CardFileNames).toEqual(["abc123hash.md"]);
    expect(l3CardContent).toContain('"content_hash": "abc123hash"');
    expect(l3CardContent).toContain('"l2_path": "knowledge/src/a.ts.md"');
    // Frozen at initial_source_commits ("commit-1"), not the row's current, grown source_commits
    // ("commit-1", "commit-2") -- L3DIST-002/003.
    expect(l3CardContent).toContain('"source_commits": [\n    "commit-1"\n  ]');
    expect(l3CardContent).toContain("All I/O paths use async/await.");
  });

  it("skips snapshot generation entirely when the latest snapshot, last Tier B commit, and HEAD match, and no batch is pending", async () => {
    const store = makeMockStore({
      meta: {
        get: vi.fn().mockImplementation((key) => {
          if (key === "lastTierBBatchSha") return "matched-head-sha";
          if (key === "tierBBatchPending") return "";
          return undefined;
        }),
        set: vi.fn(),
      },
    });

    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );

    const git = {
      getHeadSha: vi.fn().mockResolvedValue("matched-head-sha"),
    };
    docuviaFactory.register(TOKENS.GitProvider, () => git as any);

    const knowledgeGit: IKnowledgeGitService = {
      ensureKnowledgeBranch: vi.fn(),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn(),
      syncKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi
        .fn()
        .mockResolvedValue("matched-head-sha"),
      hasSourceCommitInHistory: vi.fn().mockResolvedValue(true),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    };
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);

    const renderer: ISnapshotRenderer = {
      render: vi.fn(),
    };
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => renderer);

    docuviaFactory.lock();

    const result = await new SnapshotWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute();

    expect(result).toEqual({
      nodesWritten: 0,
      edgesWritten: 0,
      markdownFilesWritten: 0,
    });
    expect(store.graph.getAllNodes).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(knowledgeGit.packSnapshotToKnowledgeBranch).not.toHaveBeenCalled();
  });
});
