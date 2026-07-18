import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import {
  appendTierCQueueEntries,
  readTierCQueue,
  removeTierCQueueEntries,
  TierCCandidateKinds,
} from "./tier-c-queue.js";

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

describe("readTierCQueue()", () => {
  it("returns [] when the meta key is absent", () => {
    const store = makeMockStore();
    expect(readTierCQueue(store)).toEqual([]);
  });

  it("returns [] and does not throw on corrupt JSON", () => {
    const store = makeMockStore({
      [GitConstants.META_KEY_TIER_C_QUEUE]: "not json",
    });
    expect(readTierCQueue(store)).toEqual([]);
  });

  it("returns [] when the stored value is valid JSON but not an array", () => {
    const store = makeMockStore({
      [GitConstants.META_KEY_TIER_C_QUEUE]: JSON.stringify({ target: "a" }),
    });
    expect(readTierCQueue(store)).toEqual([]);
  });

  it("filters out malformed entries (missing target/commitSha or unknown kind)", () => {
    const store = makeMockStore({
      [GitConstants.META_KEY_TIER_C_QUEUE]: JSON.stringify([
        { kind: "commitMessage", target: "sha1", commitSha: "sha1" },
        { kind: "bogusKind", target: "sha2", commitSha: "sha2" },
        { kind: "commitMessage", target: 42, commitSha: "sha3" },
        { kind: "commitMessage" },
      ]),
    });
    expect(readTierCQueue(store)).toEqual([
      { kind: "commitMessage", target: "sha1", commitSha: "sha1" },
    ]);
  });
});

describe("appendTierCQueueEntries()", () => {
  it("is a no-op for an empty entries array", () => {
    const store = makeMockStore();
    appendTierCQueueEntries(store, []);
    expect(store.meta.set).not.toHaveBeenCalled();
  });

  it("writes new entries when the queue is empty", () => {
    const store = makeMockStore();
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha1",
        commitSha: "sha1",
        message: "feat: add x",
      },
    ]);
    expect(readTierCQueue(store)).toEqual([
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha1",
        commitSha: "sha1",
        message: "feat: add x",
      },
    ]);
  });

  it("dedupes by target: a second append for the same target replaces the entry", () => {
    const store = makeMockStore();
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.CONTRACT_SYMBOL,
        target: "a.ts#foo",
        commitSha: "sha1",
        file: "a.ts",
      },
    ]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.CONTRACT_SYMBOL,
        target: "a.ts#foo",
        commitSha: "sha2",
        file: "a.ts",
      },
    ]);
    expect(readTierCQueue(store)).toEqual([
      {
        kind: TierCCandidateKinds.CONTRACT_SYMBOL,
        target: "a.ts#foo",
        commitSha: "sha2",
        file: "a.ts",
      },
    ]);
  });

  it("accumulates distinct targets across multiple appends", () => {
    const store = makeMockStore();
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha1",
        commitSha: "sha1",
      },
    ]);
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.CONTRACT_SYMBOL,
        target: "a.ts#foo",
        commitSha: "sha1",
        file: "a.ts",
      },
    ]);
    expect(readTierCQueue(store)).toHaveLength(2);
  });
});

describe("removeTierCQueueEntries()", () => {
  it("is a no-op for an empty targets array", () => {
    const store = makeMockStore();
    removeTierCQueueEntries(store, []);
    expect(store.meta.set).not.toHaveBeenCalled();
  });

  it("removes only the matching target, leaving the rest queued", () => {
    const store = makeMockStore();
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha1",
        commitSha: "sha1",
      },
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha2",
        commitSha: "sha2",
      },
    ]);
    removeTierCQueueEntries(store, ["sha1"]);
    expect(readTierCQueue(store)).toEqual([
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha2",
        commitSha: "sha2",
      },
    ]);
  });
});
