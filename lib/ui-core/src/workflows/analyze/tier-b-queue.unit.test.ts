import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import { appendTierBQueueEntries, readTierBQueue } from "./tier-b-queue.js";

function makeMockStore(initialMeta: Record<string, string> = {}): IGraphStore {
  const meta = { ...initialMeta };
  return {
    meta: {
      get: vi.fn((key: string) => meta[key]),
      set: vi.fn((key: string, value: string) => {
        meta[key] = value;
      }),
    },
  } as unknown as IGraphStore;
}

describe("readTierBQueue()", () => {
  it("returns [] when the meta key is absent", () => {
    const store = makeMockStore();
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("returns [] and does not throw on corrupt JSON", () => {
    const store = makeMockStore({
      [GitConstants.META_KEY_TIER_B_QUEUE]: "not json",
    });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("returns [] when the stored value is valid JSON but not an array", () => {
    const store = makeMockStore({
      [GitConstants.META_KEY_TIER_B_QUEUE]: JSON.stringify({ file: "a.ts" }),
    });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("filters out malformed entries", () => {
    const store = makeMockStore({
      [GitConstants.META_KEY_TIER_B_QUEUE]: JSON.stringify([
        { file: "a.ts", commitSha: "sha1" },
        { file: 42, commitSha: "sha2" },
        { commitSha: "sha3" },
      ]),
    });
    expect(readTierBQueue(store)).toEqual([
      { file: "a.ts", commitSha: "sha1" },
    ]);
  });
});

describe("appendTierBQueueEntries()", () => {
  it("is a no-op for an empty entries array", () => {
    const store = makeMockStore();
    appendTierBQueueEntries(store, []);
    expect(store.meta.set).not.toHaveBeenCalled();
  });

  it("writes new entries when the queue is empty", () => {
    const store = makeMockStore();
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "sha1" }]);
    expect(readTierBQueue(store)).toEqual([
      { file: "a.ts", commitSha: "sha1" },
    ]);
  });

  it("dedupes by file: a second append for the same file replaces its commitSha rather than duplicating the entry", () => {
    const store = makeMockStore();
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "sha1" }]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "sha2" }]);
    expect(readTierBQueue(store)).toEqual([
      { file: "a.ts", commitSha: "sha2" },
    ]);
  });

  it("accumulates distinct files across multiple appends", () => {
    const store = makeMockStore();
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "sha1" }]);
    appendTierBQueueEntries(store, [{ file: "b.ts", commitSha: "sha1" }]);
    expect(readTierBQueue(store)).toEqual(
      expect.arrayContaining([
        { file: "a.ts", commitSha: "sha1" },
        { file: "b.ts", commitSha: "sha1" },
      ]),
    );
    expect(readTierBQueue(store)).toHaveLength(2);
  });
});
