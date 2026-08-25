import { describe, it, expect, vi } from "vitest";
import type { IGitProvider, IGraphStore } from "@workspace/contracts";
import { HydrationService } from "./hydration.service.js";
import { GitConstants } from "@workspace/contracts";

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(true),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    commitEmptyTree: vi.fn().mockResolvedValue("sha"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(true),
    resolveHooksDir: vi.fn().mockResolvedValue("/workspace/.git/hooks"),
    readHookFile: vi.fn().mockResolvedValue(undefined),
    appendHookFile: vi.fn().mockResolvedValue(undefined),
    writeHookFile: vi.fn().mockResolvedValue(undefined),
    makeHookExecutable: vi.fn().mockResolvedValue(undefined),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    listWorktrees: vi.fn().mockResolvedValue([]),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getChangedLineRanges: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    getHeadSha: vi.fn().mockResolvedValue(undefined),
    getBranchTipSha: vi.fn().mockResolvedValue("tip-sha"),
    readFileAtRef: vi.fn().mockResolvedValue(undefined),
    listFilesAtRef: vi.fn().mockResolvedValue([]),
    getCommitLog: vi.fn().mockResolvedValue([]),
    getCommitAncestry: vi.fn().mockResolvedValue([]),
    packDirectoryToBranch: vi.fn().mockResolvedValue(undefined),
    fetchRef: vi.fn().mockResolvedValue(undefined),
    pushRef: vi.fn().mockResolvedValue(undefined),
    getRefSha: vi.fn().mockResolvedValue(undefined),
    isAncestor: vi.fn().mockResolvedValue(false),
    getTreeSha: vi.fn().mockResolvedValue("tree-sha"),
    getCommitTimestamp: vi.fn().mockResolvedValue(0),
    createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
    acquireKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    releaseKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockGraphStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
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
      count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
      findNodesForChangedFiles: vi.fn(),
      findNodeByName: vi.fn(),
      getIncomingEdges: vi.fn(),
      getOutgoingEdges: vi.fn(),
      getIncomingRelations: vi.fn(),
      getOutgoingRelations: vi.fn(),
      getAllNodes: vi.fn(),
      getAllLinks: vi.fn(),
      bulkLoadGraph: vi
        .fn()
        .mockReturnValue({ nodesLoaded: 0, edgesLoaded: 0, edgesDropped: 0 }),
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

describe("HydrationService.resolveHydrationCommit()", () => {
  it("returns undefined when the knowledge branch doesn't exist yet", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue(undefined),
    });
    const service = new HydrationService(git);

    expect(await service.resolveHydrationCommit("/workspace")).toBeUndefined();
    expect(git.getCommitLog).not.toHaveBeenCalled();
  });

  it("falls back to the branch tip when no commit carries a Docuvia-Source trailer", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("tip-sha"),
      getCommitLog: vi
        .fn()
        .mockResolvedValue([
          { sha: "tip-sha", message: "chore: legacy commit" },
        ]),
    });
    const service = new HydrationService(git);

    expect(await service.resolveHydrationCommit("/workspace")).toBe("tip-sha");
    expect(git.getCommitAncestry).not.toHaveBeenCalled();
  });

  it("resolves the knowledge commit whose stamped source sha is the nearest ancestor of source HEAD", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-3"),
      getCommitLog: vi.fn().mockResolvedValue([
        {
          sha: "know-3",
          message: `Snapshot [ccc]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: source-c`,
        },
        {
          sha: "know-2",
          message: `Snapshot [bbb]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: source-b`,
        },
        {
          sha: "know-1",
          message: `Snapshot [aaa]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: source-a`,
        },
      ]),
      // Source HEAD has since moved past source-c to source-d; source-b is the nearest analyzed ancestor.
      getCommitAncestry: vi
        .fn()
        .mockResolvedValue(["source-d", "source-b", "source-a"]),
    });
    const service = new HydrationService(git);

    expect(await service.resolveHydrationCommit("/workspace")).toBe("know-2");
  });

  it("prefers the newest knowledge commit for a source sha that was analyzed more than once (rollback re-analysis)", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-2"),
      getCommitLog: vi.fn().mockResolvedValue([
        // Newest first — this entry for source-a must win over the older one below.
        {
          sha: "know-2",
          message: `Snapshot [aaa]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: source-a`,
        },
        {
          sha: "know-1",
          message: `Snapshot [aaa]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: source-a`,
        },
      ]),
      getCommitAncestry: vi.fn().mockResolvedValue(["source-a"]),
    });
    const service = new HydrationService(git);

    expect(await service.resolveHydrationCommit("/workspace")).toBe("know-2");
  });
});

describe("HydrationService.hydrate()", () => {
  it("is a no-op when there's nothing to hydrate from yet", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue(undefined),
    });
    const store = makeMockGraphStore();
    const service = new HydrationService(git);

    const result = await service.hydrate("/workspace", store);

    expect(result).toEqual({
      hydrated: false,
      nodesLoaded: 0,
      edgesLoaded: 0,
      edgesDropped: 0,
    });
    expect(store.graph.bulkLoadGraph).not.toHaveBeenCalled();
    expect(store.meta.set).not.toHaveBeenCalled();
  });

  it("reads graph/*.jsonl off the resolved knowledge commit, bulk-loads it, and records the tip sha in meta", async () => {
    const nodesJsonl =
      '{"id":"src/a.ts","type":"file","name":"src/a.ts","filePath":"src/a.ts"}\n' +
      '{"id":"src/a.ts#fn","type":"symbol","name":"fn","filePath":"src/a.ts"}\n';
    const edgesJsonl =
      '{"source":"src/a.ts","target":"src/a.ts#fn","type":"contains"}\n';

    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
      readFileAtRef: vi
        .fn()
        .mockImplementation((_cwd: string, _ref: string, filePath: string) =>
          Promise.resolve(
            filePath === "graph/nodes.jsonl" ? nodesJsonl : edgesJsonl,
          ),
        ),
    });
    const store = makeMockGraphStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        getSemanticCoverage: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getIncomingRelations: vi.fn(),
        getOutgoingRelations: vi.fn(),
        getAllNodes: vi.fn(),
        getAllLinks: vi.fn(),
        bulkLoadGraph: vi
          .fn()
          .mockReturnValue({ nodesLoaded: 2, edgesLoaded: 1, edgesDropped: 0 }),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
        withFtsSyncSuspended: (fn: any) => fn(),
      },
    });
    const service = new HydrationService(git);

    const result = await service.hydrate("/workspace", store);

    expect(store.graph.bulkLoadGraph).toHaveBeenCalledWith({
      projectId: GitConstants.DEFAULT_LOCAL_PROJECT_ID,
      nodes: [
        { nodeKey: "src/a.ts", name: "src/a.ts", filePath: "src/a.ts" },
        { nodeKey: "src/a.ts#fn", name: "fn", filePath: "src/a.ts" },
      ],
      edges: [{ source: "src/a.ts", target: "src/a.ts#fn", type: "contains" }],
    });
    expect(store.meta.set).toHaveBeenCalledWith(
      GitConstants.META_KEY_KNOWLEDGE_TIP_SHA,
      "know-1",
    );
    expect(result).toEqual({
      hydrated: true,
      knowledgeSha: "know-1",
      nodesLoaded: 2,
      edgesLoaded: 1,
      edgesDropped: 0,
    });
  });

  it("also imports L3 cards from knowledge/_l3 at the resolved knowledge commit (L3DIST-007), inside the same write-locked bulk-load", async () => {
    const nodesJsonl =
      '{"id":"src/a.ts","type":"file","name":"src/a.ts","filePath":"src/a.ts"}\n';
    const edgesJsonl = "";
    const cardRaw =
      "---\n" +
      JSON.stringify(
        {
          content_hash: "card-hash",
          node_type: "decision",
          title: "A teammate's decision",
          l2_path: "knowledge/src/a.ts.md",
          source_commits: ["commit-1"],
          extraction_model: null,
          source_files: ["src/a.ts"],
          created_at: "2024-01-01T00:00:00.000Z",
        },
        null,
        2,
      ) +
      "\n---\n\nDecision content.\n";

    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
      readFileAtRef: vi
        .fn()
        .mockImplementation((_cwd: string, _ref: string, filePath: string) => {
          if (filePath === "graph/nodes.jsonl")
            return Promise.resolve(nodesJsonl);
          if (filePath === "graph/edges.jsonl")
            return Promise.resolve(edgesJsonl);
          if (filePath === "knowledge/_l3/card-hash.md")
            return Promise.resolve(cardRaw);
          return Promise.resolve(undefined);
        }),
      listFilesAtRef: vi.fn().mockResolvedValue(["knowledge/_l3/card-hash.md"]),
    });
    const findNodeIdByNodeKey = vi.fn().mockReturnValue(99);
    const importCard = vi.fn().mockReturnValue({ id: 1, imported: true });
    const store = makeMockGraphStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        getSemanticCoverage: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey,
        count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getIncomingRelations: vi.fn(),
        getOutgoingRelations: vi.fn(),
        getAllNodes: vi.fn(),
        getAllLinks: vi.fn(),
        bulkLoadGraph: vi
          .fn()
          .mockReturnValue({ nodesLoaded: 1, edgesLoaded: 0, edgesDropped: 0 }),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
        withFtsSyncSuspended: (fn: any) => fn(),
      },
      l3: {
        getById: vi.fn(),
        getAllExportable: vi.fn(),
        getByL2NodeId: vi.fn(),
        upsertDecision: vi.fn(),
        importCard,
        updateValidityStatus: vi.fn(),
      },
    });
    const service = new HydrationService(git);

    await service.hydrate("/workspace", store);

    expect(git.listFilesAtRef).toHaveBeenCalledWith(
      "/workspace",
      "know-1",
      "knowledge/_l3",
    );
    expect(findNodeIdByNodeKey).toHaveBeenCalledWith("src/a.ts");
    expect(importCard).toHaveBeenCalledWith(
      expect.objectContaining({
        l2NodeId: 99,
        contentHash: "card-hash",
        title: "A teammate's decision",
      }),
    );
  });

  it("treats a missing graph/*.jsonl (nothing analyzed yet) as an empty graph rather than throwing", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
      readFileAtRef: vi.fn().mockResolvedValue(undefined),
    });
    const store = makeMockGraphStore();
    const service = new HydrationService(git);

    await service.hydrate("/workspace", store);

    expect(store.graph.bulkLoadGraph).toHaveBeenCalledWith({
      projectId: GitConstants.DEFAULT_LOCAL_PROJECT_ID,
      nodes: [],
      edges: [],
    });
  });
});

describe("HydrationService.hydrate() — destructive-rebuild guard (2026-08 vscode data-loss finding)", () => {
  it("refuses and does not call bulkLoadGraph when a knowledge-branch pack from this workspace is pending (the exact sequence left behind by a thrown pack error), even when git resolves to an empty-tree commit", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
      readFileAtRef: vi.fn().mockResolvedValue(undefined),
    });
    const store = makeMockGraphStore({
      meta: {
        get: vi.fn((key: string) =>
          key === GitConstants.META_KEY_KNOWLEDGE_PACK_PENDING
            ? "true"
            : undefined,
        ),
        set: vi.fn(),
      },
    });
    const service = new HydrationService(git);

    const result = await service.hydrate("/workspace", store);

    expect(result).toEqual({
      hydrated: false,
      refused: true,
      refusalReason: "pending-local-write",
      nodesLoaded: 0,
      edgesLoaded: 0,
      edgesDropped: 0,
    });
    expect(store.graph.bulkLoadGraph).not.toHaveBeenCalled();
  });

  it("refuses and does not call bulkLoadGraph when the incoming graph is a catastrophic reduction from local.db's current node count", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
      readFileAtRef: vi.fn().mockResolvedValue(undefined),
    });
    const store = makeMockGraphStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        getSemanticCoverage: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn().mockReturnValue({ l2Nodes: 292770, l3Nodes: 0 }),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getIncomingRelations: vi.fn(),
        getOutgoingRelations: vi.fn(),
        getAllNodes: vi.fn(),
        getAllLinks: vi.fn(),
        bulkLoadGraph: vi
          .fn()
          .mockReturnValue({ nodesLoaded: 0, edgesLoaded: 0, edgesDropped: 0 }),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
        withFtsSyncSuspended: (fn: any) => fn(),
      },
    });
    const service = new HydrationService(git);

    const result = await service.hydrate("/workspace", store);

    expect(result).toEqual({
      hydrated: false,
      refused: true,
      refusalReason: "catastrophic-shrink",
      nodesLoaded: 0,
      edgesLoaded: 0,
      edgesDropped: 0,
    });
    expect(store.graph.bulkLoadGraph).not.toHaveBeenCalled();
  });

  it("does not refuse a moderate, legitimate reduction (above the shrink-guard ratio) — bulkLoadGraph is called normally", async () => {
    const nodesJsonl = Array.from(
      { length: 60 },
      (_, i) =>
        `{"id":"src/file${i}.ts","type":"file","name":"src/file${i}.ts","filePath":"src/file${i}.ts"}`,
    ).join("\n");

    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
      readFileAtRef: vi
        .fn()
        .mockImplementation((_cwd: string, _ref: string, filePath: string) =>
          Promise.resolve(filePath === "graph/nodes.jsonl" ? nodesJsonl : ""),
        ),
    });
    const store = makeMockGraphStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        getSemanticCoverage: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn().mockReturnValue({ l2Nodes: 100, l3Nodes: 0 }),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getIncomingRelations: vi.fn(),
        getOutgoingRelations: vi.fn(),
        getAllNodes: vi.fn(),
        getAllLinks: vi.fn(),
        bulkLoadGraph: vi.fn().mockReturnValue({
          nodesLoaded: 60,
          edgesLoaded: 0,
          edgesDropped: 0,
        }),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
        withFtsSyncSuspended: (fn: any) => fn(),
      },
    });
    const service = new HydrationService(git);

    const result = await service.hydrate("/workspace", store);

    expect(result.refused).toBeUndefined();
    expect(store.graph.bulkLoadGraph).toHaveBeenCalled();
  });

  it("does not refuse when the current count is below MIN_NODES_FOR_SHRINK_GUARD even if incoming is 0 (small/test-scale graphs stay exempt)", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
      readFileAtRef: vi.fn().mockResolvedValue(undefined),
    });
    const store = makeMockGraphStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        getSemanticCoverage: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn().mockReturnValue({ l2Nodes: 10, l3Nodes: 0 }),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getIncomingRelations: vi.fn(),
        getOutgoingRelations: vi.fn(),
        getAllNodes: vi.fn(),
        getAllLinks: vi.fn(),
        bulkLoadGraph: vi
          .fn()
          .mockReturnValue({ nodesLoaded: 0, edgesLoaded: 0, edgesDropped: 0 }),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
        withFtsSyncSuspended: (fn: any) => fn(),
      },
    });
    const service = new HydrationService(git);

    const result = await service.hydrate("/workspace", store);

    expect(result.refused).toBeUndefined();
    expect(store.graph.bulkLoadGraph).toHaveBeenCalled();
  });

  it("options: { force: true } bypasses both the pending flag and the shrink guard — bulkLoadGraph is called and the real data loads", async () => {
    const nodesJsonl =
      '{"id":"src/a.ts","type":"file","name":"src/a.ts","filePath":"src/a.ts"}\n';

    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
      readFileAtRef: vi
        .fn()
        .mockImplementation((_cwd: string, _ref: string, filePath: string) =>
          Promise.resolve(filePath === "graph/nodes.jsonl" ? nodesJsonl : ""),
        ),
    });
    const store = makeMockGraphStore({
      meta: {
        get: vi.fn((key: string) =>
          key === GitConstants.META_KEY_KNOWLEDGE_PACK_PENDING
            ? "true"
            : undefined,
        ),
        set: vi.fn(),
      },
      graph: {
        deleteNodesForPath: vi.fn(),
        getSemanticCoverage: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn().mockReturnValue({ l2Nodes: 292770, l3Nodes: 0 }),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getIncomingRelations: vi.fn(),
        getOutgoingRelations: vi.fn(),
        getAllNodes: vi.fn(),
        getAllLinks: vi.fn(),
        bulkLoadGraph: vi
          .fn()
          .mockReturnValue({ nodesLoaded: 1, edgesLoaded: 0, edgesDropped: 0 }),
        pruneOrphanedLinks: vi.fn().mockReturnValue(0),
        withFtsSyncSuspended: (fn: any) => fn(),
      },
    });
    const service = new HydrationService(git);

    const result = await service.hydrate("/workspace", store, undefined, {
      force: true,
    });

    expect(result.refused).toBeUndefined();
    expect(store.graph.bulkLoadGraph).toHaveBeenCalledWith({
      projectId: GitConstants.DEFAULT_LOCAL_PROJECT_ID,
      nodes: [{ nodeKey: "src/a.ts", name: "src/a.ts", filePath: "src/a.ts" }],
      edges: [],
    });
  });
});

describe("HydrationService.isStale()", () => {
  it("is false when nothing exists to hydrate from yet (an empty local.db isn't 'stale')", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue(undefined),
    });
    const store = makeMockGraphStore();
    const service = new HydrationService(git);

    expect(await service.isStale("/workspace", store)).toBe(false);
  });

  it("is true when the store's recorded hydration sha doesn't match what resolves right now", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-2"),
      getCommitLog: vi.fn().mockResolvedValue([]),
    });
    const store = makeMockGraphStore({
      meta: { get: vi.fn().mockReturnValue("know-1"), set: vi.fn() },
    });
    const service = new HydrationService(git);

    expect(await service.isStale("/workspace", store)).toBe(true);
  });

  it("is false once the store's recorded hydration sha matches what resolves now", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
    });
    const store = makeMockGraphStore({
      meta: { get: vi.fn().mockReturnValue("know-1"), set: vi.fn() },
    });
    const service = new HydrationService(git);

    expect(await service.isStale("/workspace", store)).toBe(false);
  });
});

describe("HydrationService.markSynced()", () => {
  it("records the resolved knowledge-tip sha in store.meta without touching store.graph", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
    });
    const store = makeMockGraphStore();
    const service = new HydrationService(git);

    await service.markSynced("/workspace", store);

    expect(store.meta.set).toHaveBeenCalledWith(
      GitConstants.META_KEY_KNOWLEDGE_TIP_SHA,
      "know-1",
    );
    expect(store.graph.bulkLoadGraph).not.toHaveBeenCalled();
  });

  it("is a no-op when the knowledge branch doesn't exist yet", async () => {
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue(undefined),
    });
    const store = makeMockGraphStore();
    const service = new HydrationService(git);

    await service.markSynced("/workspace", store);

    expect(store.meta.set).not.toHaveBeenCalled();
  });

  it("regression: a freshly-populated store (never hydrated) no longer looks stale after markSynced()", async () => {
    // This is the exact sequence that used to wipe a fresh `init`'s graph: ensureKnowledgeBranch
    // creates the branch's initial (empty) commit as step 1, `init` never recorded any tip in
    // `store.meta` (only `hydrate()` used to), so the very next `isStale()` call (from any
    // read-path command's `ensureHydrated()`) saw `undefined !== "know-1"` and force-hydrated,
    // overwriting the graph `init` had just built with that empty commit.
    const git = makeMockGitProvider({
      getBranchTipSha: vi.fn().mockResolvedValue("know-1"),
      getCommitLog: vi.fn().mockResolvedValue([]),
    });
    const store = makeMockGraphStore(); // meta.get() returns undefined — never hydrated
    const service = new HydrationService(git);

    expect(await service.isStale("/workspace", store)).toBe(true);

    await service.markSynced("/workspace", store);
    store.meta.get = vi.fn().mockReturnValue("know-1"); // reflect the write markSynced just made

    expect(await service.isStale("/workspace", store)).toBe(false);
  });
});
