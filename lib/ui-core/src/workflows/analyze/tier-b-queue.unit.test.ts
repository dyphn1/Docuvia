import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import { makeMockStore } from "@workspace/contracts/testing";
import { appendTierBQueueEntries, readTierBQueue } from "./tier-b-queue.js";

function makeBQueueStore(
  initialMeta: Record<string, string> = {},
): IGraphStore {
  const meta = { ...initialMeta };
  return makeMockStore({
    meta: {
      get: vi.fn((key: string) => meta[key]),
      set: vi.fn((key: string, value: string) => {
        meta[key] = value;
      }),
    },
  });
}

describe("readTierBQueue()", () => {
  it("returns [] when the meta key is absent", () => {
    const store = makeBQueueStore();
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("returns [] and does not throw on corrupt JSON", () => {
    const store = makeBQueueStore({
      [GitConstants.META_KEY_TIER_B_QUEUE]: "not json",
    });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("returns [] when the stored value is valid JSON but not an array", () => {
    const store = makeBQueueStore({
      [GitConstants.META_KEY_TIER_B_QUEUE]: JSON.stringify({ file: "a.ts" }),
    });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("filters out malformed entries", () => {
    const store = makeBQueueStore({
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

  it("returns [] when the meta value is an empty string", () => {
    const store = makeBQueueStore({
      [GitConstants.META_KEY_TIER_B_QUEUE]: "",
    });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("returns [] when the meta value is the JSON string 'null'", () => {
    const store = makeBQueueStore({
      [GitConstants.META_KEY_TIER_B_QUEUE]: "null",
    });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("returns [] when the meta value is a JSON string 'false'", () => {
    const store = makeBQueueStore({
      [GitConstants.META_KEY_TIER_B_QUEUE]: "false",
    });
    expect(readTierBQueue(store)).toEqual([]);
  });

  it("preserves entries with empty-string file or commitSha (schema allows it)", () => {
    const store = makeBQueueStore({
      [GitConstants.META_KEY_TIER_B_QUEUE]: JSON.stringify([
        { file: "", commitSha: "sha1" },
        { file: "a.ts", commitSha: "" },
      ]),
    });
    expect(readTierBQueue(store)).toHaveLength(2);
  });
});

describe("appendTierBQueueEntries()", () => {
  it("is a no-op for an empty entries array", () => {
    const store = makeBQueueStore();
    appendTierBQueueEntries(store, []);
    expect(store.meta.set).not.toHaveBeenCalled();
  });

  it("writes new entries when the queue is empty", () => {
    const store = makeBQueueStore();
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "sha1" }]);
    expect(readTierBQueue(store)).toEqual([
      { file: "a.ts", commitSha: "sha1" },
    ]);
  });

  it("dedupes by file: a second append for the same file replaces its commitSha rather than duplicating the entry", () => {
    const store = makeBQueueStore();
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "sha1" }]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "sha2" }]);
    expect(readTierBQueue(store)).toEqual([
      { file: "a.ts", commitSha: "sha2" },
    ]);
  });

  it("accumulates distinct files across multiple appends", () => {
    const store = makeBQueueStore();
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

  it("handles appending the same entry three times — only the last commitSha survives", () => {
    const store = makeBQueueStore();
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "v1" }]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "v2" }]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "v3" }]);
    expect(readTierBQueue(store)).toEqual([{ file: "a.ts", commitSha: "v3" }]);
  });

  it("handles a batch append with mixed new and duplicate entries", () => {
    const store = makeBQueueStore();
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: "sha-old" },
      { file: "b.ts", commitSha: "sha-b" },
    ]);
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: "sha-new" },
      { file: "c.ts", commitSha: "sha-c" },
    ]);
    const queue = readTierBQueue(store);
    expect(queue).toHaveLength(3);
    expect(queue).toContainEqual({ file: "a.ts", commitSha: "sha-new" });
    expect(queue).toContainEqual({ file: "b.ts", commitSha: "sha-b" });
    expect(queue).toContainEqual({ file: "c.ts", commitSha: "sha-c" });
  });
});
