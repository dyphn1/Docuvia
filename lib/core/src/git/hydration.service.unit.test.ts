import { describe, it, expect, vi } from "vitest";
import type { IGitProvider, IGraphStore } from "@workspace/contracts";
import { HydrationService } from "./hydration.service.js";
import { GitConstants } from "./git-constants.js";

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(true),
    commitEmptyTree: vi.fn().mockResolvedValue("sha"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(true),
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
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getChangedLineRanges: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    getHeadSha: vi.fn().mockResolvedValue(undefined),
    getBranchTipSha: vi.fn().mockResolvedValue("tip-sha"),
    readFileAtRef: vi.fn().mockResolvedValue(undefined),
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
      getAllNodes: vi.fn(),
      getAllLinks: vi.fn(),
      bulkLoadGraph: vi
        .fn()
        .mockReturnValue({ nodesLoaded: 0, edgesLoaded: 0, edgesDropped: 0 }),
    },
    l3: {
      getById: vi.fn(),
      getAllExportable: vi.fn(),
      upsertDecision: vi.fn(),
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
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn(),
        findNodesForChangedFiles: vi.fn(),
        findNodeByName: vi.fn(),
        getIncomingEdges: vi.fn(),
        getOutgoingEdges: vi.fn(),
        getAllNodes: vi.fn(),
        getAllLinks: vi.fn(),
        bulkLoadGraph: vi
          .fn()
          .mockReturnValue({ nodesLoaded: 2, edgesLoaded: 1, edgesDropped: 0 }),
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
