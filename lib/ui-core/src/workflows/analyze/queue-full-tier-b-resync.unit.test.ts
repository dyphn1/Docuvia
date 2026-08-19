import { describe, it, expect, vi } from "vitest";
import type { IGitProvider, IGraphStore } from "@workspace/contracts";
import { queueFullTierBResync } from "./queue-full-tier-b-resync.js";
import { appendTierBQueueEntries, readTierBQueue } from "./tier-b-queue.js";

function makeMockStore(
  hashes: Array<{ filePath: string; contentHash: string | null }> = [],
): IGraphStore {
  const meta = new Map<string, string>();
  return {
    projects: {
      getFirst: vi.fn(),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn(),
    },
    files: {
      getAllHashes: vi.fn().mockReturnValue(hashes),
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
      deleteNodesForPath: vi.fn().mockReturnValue([]),
      getSemanticCoverage: vi.fn(),
      insertNode: vi.fn().mockReturnValue(1),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn(),
      findNodeIdByNodeKey: vi.fn(),
      count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
      findNodesForChangedFiles: vi.fn().mockReturnValue([]),
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
    meta: {
      get: vi.fn((key: string) => meta.get(key)),
      set: vi.fn((key: string, value: string) => {
        meta.set(key, value);
      }),
    },
    callSites: {
      deleteForFile: vi.fn(),
      insertMany: vi.fn(),
      getForFiles: vi.fn().mockReturnValue(new Map()),
    },
    withWriteLock: async (fn) => fn(),
    withTransaction: (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi
      .fn()
      .mockReturnValue({ prunedFiles: 0, prunedNodes: 0 }),
  };
}

function makeMockGitProvider(headSha: string | undefined): IGitProvider {
  return {
    getHeadSha: vi.fn().mockResolvedValue(headSha),
  } as unknown as IGitProvider;
}

describe("queueFullTierBResync()", () => {
  it("is a no-op on an unborn/headless HEAD (no commit to stamp against yet), mirroring stampFullIngestionForTierB's precedent", async () => {
    const store = makeMockStore([
      { filePath: "src/a.ts", contentHash: "hash-a" },
    ]);
    const git = makeMockGitProvider(undefined);

    const result = await queueFullTierBResync({
      workspaceRoot: "/workspace",
      store,
      git,
    });

    expect(result).toEqual({ filesQueued: 0 });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("merges every store.files.getAllHashes() entry into tierBQueue, keyed by headSha", async () => {
    const store = makeMockStore([
      { filePath: "src/a.ts", contentHash: "hash-a" },
      { filePath: "src/b.ts", contentHash: "hash-b" },
    ]);
    const git = makeMockGitProvider("cafebabecafebabecafebabecafebabecafebabe");

    const result = await queueFullTierBResync({
      workspaceRoot: "/workspace",
      store,
      git,
    });

    expect(result).toEqual({ filesQueued: 2 });
    expect(readTierBQueue(store)).toEqual([
      {
        file: "src/a.ts",
        commitSha: "cafebabecafebabecafebabecafebabecafebabe",
      },
      {
        file: "src/b.ts",
        commitSha: "cafebabecafebabecafebabecafebabecafebabe",
      },
    ]);
  });

  it("dedups against an already-queued file, refreshing its commitSha rather than duplicating it (appendTierBQueueEntries's existing dedup contract)", async () => {
    const store = makeMockStore([
      { filePath: "src/a.ts", contentHash: "hash-a" },
      { filePath: "src/b.ts", contentHash: "hash-b" },
    ]);
    appendTierBQueueEntries(store, [
      { file: "src/a.ts", commitSha: "old-sha" },
    ]);
    const git = makeMockGitProvider("new-sha");

    const result = await queueFullTierBResync({
      workspaceRoot: "/workspace",
      store,
      git,
    });

    expect(result).toEqual({ filesQueued: 2 });
    const queue = readTierBQueue(store);
    expect(queue).toHaveLength(2);
    expect(queue).toContainEqual({ file: "src/a.ts", commitSha: "new-sha" });
    expect(queue).toContainEqual({ file: "src/b.ts", commitSha: "new-sha" });
  });
});
