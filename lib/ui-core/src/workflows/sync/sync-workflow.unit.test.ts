import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  resetFactoryForTests,
  createMockLogger,
  type IGitProvider,
  type IGraphStore,
  type IRemoteSyncClient,
  type L2NodeRow,
  type L3NodeRow,
} from "@workspace/contracts";
import { SyncWorkflow } from "./sync-workflow.js";

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(false),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    commitEmptyTree: vi.fn().mockResolvedValue("sha"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(false),
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
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getChangedLineRanges: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    getHeadSha: vi.fn().mockResolvedValue(undefined),
    getBranchTipSha: vi.fn().mockResolvedValue(undefined),
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

function makeL2(overrides: Partial<L2NodeRow> = {}): L2NodeRow {
  return {
    id: 1,
    project_id: 1,
    name: "src/a.ts",
    type: "module",
    is_system: 0,
    description: null,
    ai_generated: 1,
    needs_review: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    last_verified_at: null,
    path_patterns: JSON.stringify(["src/a.ts"]),
    reindex_required: 0,
    is_bootstrap_confirmed: 0,
    content_hash: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    node_key: null,
    ...overrides,
  };
}

function makeL3(overrides: Partial<L3NodeRow> = {}): L3NodeRow {
  return {
    id: 1,
    l2_node_id: 1,
    title: "a decision",
    content: "content",
    node_type: "decision",
    source_commits: "[]",
    commit_hash: null,
    ai_generated: 1,
    confidence: 0.9,
    noise_score: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_verified_at: null,
    occurrence_count: 1,
    introduced_in_commit: null,
    verified_until_commit: null,
    validity_status: "pending",
    source: "commit",
    content_hash: "hash-1",
    extraction_model: null,
    source_files: null,
    initial_source_commits: null,
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
      insertNode: vi.fn(),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn(),
      findNodeIdByNodeKey: vi.fn(),
      count: vi.fn(),
      findNodesForChangedFiles: vi.fn().mockReturnValue([]),
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

function makeMockRemoteSyncClient(
  overrides: Partial<IRemoteSyncClient> = {},
): IRemoteSyncClient {
  return {
    initialize: vi.fn(),
    fetchRemoteL2Nodes: vi.fn().mockResolvedValue([]),
    pushSyncEvents: vi.fn().mockResolvedValue({ success: true, processed: 0 }),
    ...overrides,
  };
}

describe("SyncWorkflow.execute()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-sync-workflow-test-"),
    );
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns early with no store or remote calls when there are no changed files", async () => {
    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    const openStoreSpy = vi.fn();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);
    docuviaFactory.lock();

    const result = await new SyncWorkflow(
      tmpDir,
      createMockLogger(),
      "https://api",
      "pat",
    ).execute({
      projectId: "1",
    });

    expect(result).toEqual({
      synced: 0,
      skipped: 0,
      message: "Nothing to sync: no changed files detected.",
    });
    expect(openStoreSpy).not.toHaveBeenCalled();
  });

  it("throws a DocuviaError with a run-docuvia-init message when the db is missing", async () => {
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        listModifiedFiles: vi.fn().mockResolvedValue(["src/a.ts"]),
      }),
    );
    const dbOpenError = new DocuviaError(
      "DB_NOT_FOUND",
      "Local database not found at /x. Please run docuvia init.",
    );
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockRejectedValue(dbOpenError),
    );
    docuviaFactory.lock();

    await expect(
      new SyncWorkflow(
        tmpDir,
        createMockLogger(),
        "https://api",
        "pat",
      ).execute({ projectId: "1" }),
    ).rejects.toMatchObject({
      code: "DB_NOT_FOUND",
      message: expect.stringContaining("docuvia init"),
    });
  });

  it("propagates a DB_OPEN_FAILED (present but unopenable db) with its real cause unmasked", async () => {
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        listModifiedFiles: vi.fn().mockResolvedValue(["src/a.ts"]),
      }),
    );
    const dbOpenError = new DocuviaError(
      "DB_OPEN_FAILED",
      "Failed to open database at /x: The module better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 141.",
    );
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockRejectedValue(dbOpenError),
    );
    docuviaFactory.lock();

    await expect(
      new SyncWorkflow(
        tmpDir,
        createMockLogger(),
        "https://api",
        "pat",
      ).execute({ projectId: "1" }),
    ).rejects.toMatchObject({
      code: "DB_OPEN_FAILED",
      message: expect.stringContaining(
        "compiled against a different Node.js version",
      ),
    });
  });

  it("uses getFilesChangedByCommit given a commitSha, matches candidates against remote L2 nodes, and pushes new events", async () => {
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
      }),
    );

    const store = makeMockStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn(),
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
        findNodesForChangedFiles: vi.fn().mockReturnValue([
          {
            l2Node: makeL2({ id: 10, name: "src/a.ts" }),
            l3Nodes: [makeL3({ l2_node_id: 10 })],
          },
        ]),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );

    const remoteSyncClient = makeMockRemoteSyncClient({
      fetchRemoteL2Nodes: vi
        .fn()
        .mockResolvedValue([{ id: 999, name: "src/a.ts" }]),
      pushSyncEvents: vi
        .fn()
        .mockResolvedValue({ success: true, processed: 1 }),
    });
    docuviaFactory.register(
      TOKENS.RemoteSyncClient,
      () => () => remoteSyncClient,
    );
    docuviaFactory.lock();

    const result = await new SyncWorkflow(
      tmpDir,
      createMockLogger(),
      "https://api",
      "pat",
    ).execute({
      projectId: "1",
      commitSha: "abc123",
    });

    expect(remoteSyncClient.initialize).toHaveBeenCalledWith({
      apiUrl: "https://api",
      pat: "pat",
    });
    expect(remoteSyncClient.pushSyncEvents).toHaveBeenCalledWith("1", [
      {
        type: "CREATE_L3",
        payload: {
          l2NodeId: 999,
          title: "a decision",
          content: "content",
          nodeType: "decision",
          confidence: 0.9,
          sourceCommits: [],
          contentHash: "hash-1",
        },
      },
    ]);
    expect(result).toEqual({
      synced: 1,
      skipped: 0,
      message: "Synced 1 decision(s), 0 module(s) skipped.",
    });
    expect(store.close).toHaveBeenCalledTimes(1);

    const stateFile = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, ".docuvia", "logs", "sync-state.json"),
        "utf8",
      ),
    );
    expect(stateFile["1"].syncedContentHashes).toEqual(["hash-1"]);
  });

  it("skips L2 nodes with no matching remote node and counts them in skipped", async () => {
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        listModifiedFiles: vi.fn().mockResolvedValue(["src/a.ts"]),
      }),
    );
    const store = makeMockStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn(),
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
        findNodesForChangedFiles: vi.fn().mockReturnValue([
          {
            l2Node: makeL2({ id: 10, name: "src/a.ts" }),
            l3Nodes: [makeL3()],
          },
        ]),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    const remoteSyncClient = makeMockRemoteSyncClient({
      fetchRemoteL2Nodes: vi.fn().mockResolvedValue([]),
    });
    docuviaFactory.register(
      TOKENS.RemoteSyncClient,
      () => () => remoteSyncClient,
    );
    docuviaFactory.lock();

    const result = await new SyncWorkflow(
      tmpDir,
      createMockLogger(),
      "https://api",
      "pat",
    ).execute({
      projectId: "1",
    });

    expect(result).toEqual({
      synced: 0,
      skipped: 1,
      message: "Nothing new to sync (1 module(s) skipped, no remote match).",
    });
    expect(remoteSyncClient.pushSyncEvents).not.toHaveBeenCalled();
  });

  it("dedups against a previously-synced content hash cache in sync-state.json", async () => {
    fs.mkdirSync(path.join(tmpDir, ".docuvia", "logs"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".docuvia", "logs", "sync-state.json"),
      JSON.stringify({ "1": { syncedContentHashes: ["hash-1"] } }),
    );

    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        listModifiedFiles: vi.fn().mockResolvedValue(["src/a.ts"]),
      }),
    );
    const store = makeMockStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeIdByNodeKey: vi.fn(),
        count: vi.fn(),
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
        findNodesForChangedFiles: vi.fn().mockReturnValue([
          {
            l2Node: makeL2({ id: 10, name: "src/a.ts" }),
            l3Nodes: [makeL3({ content_hash: "hash-1" })],
          },
        ]),
      },
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    const remoteSyncClient = makeMockRemoteSyncClient({
      fetchRemoteL2Nodes: vi
        .fn()
        .mockResolvedValue([{ id: 999, name: "src/a.ts" }]),
    });
    docuviaFactory.register(
      TOKENS.RemoteSyncClient,
      () => () => remoteSyncClient,
    );
    docuviaFactory.lock();

    const result = await new SyncWorkflow(
      tmpDir,
      createMockLogger(),
      "https://api",
      "pat",
    ).execute({
      projectId: "1",
    });

    expect(result.synced).toBe(0);
    expect(remoteSyncClient.pushSyncEvents).not.toHaveBeenCalled();
  });
});
