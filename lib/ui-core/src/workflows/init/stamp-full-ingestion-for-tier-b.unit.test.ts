import { describe, it, expect, vi } from "vitest";
import { GitConstants } from "@workspace/core";
import type { IGitProvider, IGraphStore } from "@workspace/contracts";
import { stampFullIngestionForTierB } from "./stamp-full-ingestion-for-tier-b.js";
import { readTierBQueue } from "../analyze/tier-b-queue.js";

function makeMockStore(): IGraphStore {
  const meta = new Map<string, string>();
  return {
    projects: {
      getFirst: vi.fn(),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn(),
    },
    files: { getAllHashes: vi.fn().mockReturnValue([]), upsertFile: vi.fn() },
    tags: {
      upsertTag: vi.fn(),
      getIdByName: vi.fn(),
      linkNodeToTag: vi.fn(),
      getAllTagLinks: vi.fn(),
    },
    graph: {
      deleteNodesForPath: vi.fn().mockReturnValue([]),
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
    withWriteLock: async (fn) => fn(),
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

describe("stampFullIngestionForTierB()", () => {
  const parsedResults = [
    {
      file: "src/a.ts",
      hash: "hash-a",
      data: { imports: [], exports: [], functions: [], classes: [], calls: [] },
      language: "typescript",
    },
  ];

  it("writes the last-ingested-source-sha meta key to headSha", async () => {
    const store = makeMockStore();
    const git = makeMockGitProvider("cafebabecafebabecafebabecafebabecafebabe");

    await stampFullIngestionForTierB({
      store,
      git,
      workspaceRoot: "/workspace",
      parsedResults,
    });

    expect(store.meta.set).toHaveBeenCalledWith(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      "cafebabecafebabecafebabecafebabecafebabe",
    );
  });

  it("queues every parsed file for Tier B, keyed by headSha", async () => {
    const store = makeMockStore();
    const git = makeMockGitProvider("cafebabecafebabecafebabecafebabecafebabe");

    await stampFullIngestionForTierB({
      store,
      git,
      workspaceRoot: "/workspace",
      parsedResults,
    });

    expect(readTierBQueue(store)).toEqual([
      {
        file: "src/a.ts",
        commitSha: "cafebabecafebabecafebabecafebabecafebabe",
      },
    ]);
  });

  it("is a no-op on an unborn/headless HEAD (no commit to stamp against yet)", async () => {
    const store = makeMockStore();
    const git = makeMockGitProvider(undefined);

    await stampFullIngestionForTierB({
      store,
      git,
      workspaceRoot: "/workspace",
      parsedResults,
    });

    expect(store.meta.set).not.toHaveBeenCalled();
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("does not queue anything when nothing was parsed, even with a valid headSha", async () => {
    const store = makeMockStore();
    const git = makeMockGitProvider("cafebabecafebabecafebabecafebabecafebabe");

    await stampFullIngestionForTierB({
      store,
      git,
      workspaceRoot: "/workspace",
      parsedResults: [],
    });

    expect(store.meta.set).toHaveBeenCalledWith(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      "cafebabecafebabecafebabecafebabecafebabe",
    );
    expect(readTierBQueue(store)).toEqual([]);
  });
});
