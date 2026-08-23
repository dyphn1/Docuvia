import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import {
  makeMockStore,
  makeMockGitProvider,
} from "@workspace/contracts/testing";
import { queueFullTierBResync } from "./queue-full-tier-b-resync.js";
import { readTierBQueue } from "./tier-b-queue.js";

function makeResyncStore(): IGraphStore {
  const meta = new Map<string, string>();
  return makeMockStore({
    meta: {
      get: vi.fn((key: string) => meta.get(key)),
      set: vi.fn((key: string, value: string) => {
        meta.set(key, value);
      }),
    },
  });
}

describe("queueFullTierBResync()", () => {
  it("is a no-op on an unborn/headless HEAD (no commit to stamp against yet), mirroring stampFullIngestionForTierB's precedent", async () => {
    const store = makeResyncStore();
    const git = makeMockGitProvider({
      getHeadSha: vi.fn().mockResolvedValue(undefined),
    });

    const result = await queueFullTierBResync({
      workspaceRoot: "/workspace",
      store,
      git,
    });

    expect(result).toEqual({ filesQueued: 0 });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("merges every store.files.getAllHashes() entry into tierBQueue, keyed by headSha", async () => {
    const store = makeResyncStore();
    (store.files.getAllHashes as any).mockReturnValue([
      { filePath: "src/a.ts", contentHash: "hash-a" },
      { filePath: "src/b.ts", contentHash: "hash-b" },
    ]);
    const git = makeMockGitProvider({
      getHeadSha: vi
        .fn()
        .mockResolvedValue("cafebabecafebabecafebabecafebabecafebabe"),
    });

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
    const store = makeResyncStore();
    (store.files.getAllHashes as any).mockReturnValue([
      { filePath: "src/a.ts", contentHash: "hash-a" },
      { filePath: "src/b.ts", contentHash: "hash-b" },
    ]);
    const git = makeMockGitProvider();

    const result = await queueFullTierBResync({
      workspaceRoot: "/workspace",
      store,
      git,
    });

    expect(result).toEqual({ filesQueued: 2 });
    const queue = readTierBQueue(store);
    expect(queue).toHaveLength(2);
    expect(queue).toContainEqual({
      file: "src/a.ts",
      commitSha: expect.any(String),
    });
    expect(queue).toContainEqual({
      file: "src/b.ts",
      commitSha: expect.any(String),
    });
  });

  it("returns filesQueued: 0 when the file store has no tracked files", async () => {
    const store = makeResyncStore();
    const git = makeMockGitProvider();

    const result = await queueFullTierBResync({
      workspaceRoot: "/workspace",
      store,
      git,
    });

    expect(result).toEqual({ filesQueued: 0 });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("queues all files when every file is new (no pre-existing queue entries)", async () => {
    const store = makeResyncStore();
    (store.files.getAllHashes as any).mockReturnValue([
      { filePath: "src/a.ts", contentHash: "hash-a" },
      { filePath: "src/b.ts", contentHash: "hash-b" },
      { filePath: "src/c.ts", contentHash: "hash-c" },
    ]);
    const git = makeMockGitProvider({
      getHeadSha: vi.fn().mockResolvedValue("abc123"),
    });

    const result = await queueFullTierBResync({
      workspaceRoot: "/workspace",
      store,
      git,
    });

    expect(result).toEqual({ filesQueued: 3 });
    expect(readTierBQueue(store)).toHaveLength(3);
  });
});
