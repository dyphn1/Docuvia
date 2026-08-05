import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGraphStore,
  type IKnowledgeGitService,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import { finalizePendingTierBBatch } from "./finalize-pending-tier-b-batch.js";

function makeStore(meta: Record<string, string> = {}): {
  store: IGraphStore;
  metaMap: Map<string, string>;
} {
  const metaMap = new Map(Object.entries(meta));
  const store = {
    meta: {
      get: (key: string) => metaMap.get(key),
      set: (key: string, value: string) => {
        metaMap.set(key, value);
      },
    },
    withWriteLock: async (fn: () => unknown) => fn(),
    withTransaction: (fn: () => unknown) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStore;
  return { store, metaMap };
}

function makeKnowledgeGit(): IKnowledgeGitService {
  return {
    runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
  } as unknown as IKnowledgeGitService;
}

describe("finalizePendingTierBBatch() (§8f/§8g)", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  it("is a no-op when nothing is pending", async () => {
    const { store, metaMap } = makeStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi
        .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
        .mockResolvedValue(store),
    );
    const knowledgeGit = makeKnowledgeGit();
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);

    await finalizePendingTierBBatch("/workspace", createMockLogger());

    expect(knowledgeGit.runUnderKnowledgeLock).not.toHaveBeenCalled();
    expect(metaMap.has(GitConstants.META_KEY_TIER_B_QUEUE)).toBe(false);
  });

  it("commits the staged queue drain and commit-cap seed, resets the changed-bytes accumulator, then clears the pending marker", async () => {
    const pending = JSON.stringify({
      headSha: "abc123",
      remainingQueue: [{ file: "still-failing.ts", commitSha: "abc123" }],
    });
    const { store, metaMap } = makeStore({
      [GitConstants.META_KEY_TIER_B_BATCH_PENDING]: pending,
      [GitConstants.META_KEY_TIER_B_CHANGED_BYTES]: "999999",
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi
        .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
        .mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeKnowledgeGit(),
    );

    await finalizePendingTierBBatch("/workspace", createMockLogger());

    expect(metaMap.get(GitConstants.META_KEY_LAST_TIER_B_BATCH_SHA)).toBe(
      "abc123",
    );
    expect(
      JSON.parse(metaMap.get(GitConstants.META_KEY_TIER_B_QUEUE)!),
    ).toEqual([{ file: "still-failing.ts", commitSha: "abc123" }]);
    expect(metaMap.get(GitConstants.META_KEY_TIER_B_CHANGED_BYTES)).toBe("0");
    expect(metaMap.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)).toBe("");
  });

  it("treats a malformed pending record as nothing-pending rather than throwing", async () => {
    const { store, metaMap } = makeStore({
      [GitConstants.META_KEY_TIER_B_BATCH_PENDING]: "{not valid json",
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi
        .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
        .mockResolvedValue(store),
    );
    const knowledgeGit = makeKnowledgeGit();
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);

    await expect(
      finalizePendingTierBBatch("/workspace", createMockLogger()),
    ).resolves.toBeUndefined();
    expect(knowledgeGit.runUnderKnowledgeLock).not.toHaveBeenCalled();
    expect(metaMap.has(GitConstants.META_KEY_TIER_B_QUEUE)).toBe(false);
  });

  it("always closes the store, even after committing", async () => {
    const pending = JSON.stringify({ headSha: "abc123", remainingQueue: [] });
    const { store } = makeStore({
      [GitConstants.META_KEY_TIER_B_BATCH_PENDING]: pending,
    });
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi
        .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
        .mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeKnowledgeGit(),
    );

    await finalizePendingTierBBatch("/workspace", createMockLogger());

    expect(store.close).toHaveBeenCalledTimes(1);
  });
});
