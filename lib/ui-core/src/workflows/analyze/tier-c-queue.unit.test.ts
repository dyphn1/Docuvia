import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import { makeMockStore } from "@workspace/contracts/testing";
import {
  appendTierCQueueEntries,
  parseContractSymbolTarget,
  readTierCQueue,
  recordTierCQueueFailure,
  removeTierCQueueEntries,
  TierCCandidateKinds,
  TierCQueueValidationReasons,
  type TierCQueueEntry,
} from "./tier-c-queue.js";

function makeTierCStore(initialMeta: Record<string, string> = {}): IGraphStore {
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

describe("parseContractSymbolTarget()", () => {
  it("accepts canonical nested paths and returns the file and symbol", () => {
    expect(
      parseContractSymbolTarget({
        kind: TierCCandidateKinds.CONTRACT_SYMBOL,
        target: "src/x/y.ts#Foo",
        commitSha: "sha1",
        file: "src/x/y.ts",
      }),
    ).toEqual({ ok: true, file: "src/x/y.ts", symbolName: "Foo" });
  });

  it.each([
    {
      target: "src/a.ts##secret",
      file: "src/a.ts",
      symbolName: "#secret",
    },
    {
      target: "src/C#/x.cs#Foo",
      file: "src/C#/x.cs",
      symbolName: "Foo",
    },
    {
      target: "src/a.ts#Foo#Bar",
      file: "src/a.ts",
      symbolName: "Foo#Bar",
    },
  ])("accepts target $target", ({ target, file, symbolName }) => {
    expect(
      parseContractSymbolTarget({
        kind: TierCCandidateKinds.CONTRACT_SYMBOL,
        target,
        commitSha: "sha1",
        file,
      }),
    ).toEqual({ ok: true, file, symbolName });
  });

  it.each([
    {
      name: "a missing separator",
      entry: {
        target: "src/a.ts",
        file: "src/a.ts",
      },
    },
    {
      name: "an empty symbol",
      entry: {
        target: "src/a.ts#",
        file: "src/a.ts",
      },
    },
    {
      name: "a missing file",
      entry: {
        target: "src/a.ts#Foo",
      },
    },
    {
      name: "an empty file",
      entry: {
        target: "#Foo",
        file: "",
      },
    },
    {
      name: "an absolute POSIX path",
      entry: {
        target: "/etc/passwd#Foo",
        file: "/etc/passwd",
      },
    },
    {
      name: "an absolute Windows drive path",
      entry: {
        target: "C:\\repo\\src\\a.ts#Foo",
        file: "C:\\repo\\src\\a.ts",
      },
    },
    {
      name: "an absolute Windows UNC path",
      entry: {
        target: "\\\\server\\share\\a.ts#Foo",
        file: "\\\\server\\share\\a.ts",
      },
    },
    {
      name: "a parent traversal",
      entry: {
        target: "../secret.ts#Foo",
        file: "../secret.ts",
      },
    },
    {
      name: "a traversal that normalizes above the repository",
      entry: {
        target: "a/../../secret.ts#Foo",
        file: "a/../../secret.ts",
      },
    },
    {
      name: "a target/file mismatch",
      entry: {
        target: "src/b.ts#Foo",
        file: "src/a.ts",
      },
    },
    {
      name: "a target whose file prefix does not end at the separator",
      entry: {
        target: "src/a.tsx#Foo",
        file: "src/a.ts",
      },
    },
    {
      name: "a newline in the symbol",
      entry: {
        target: "src/a.ts#Foo\nBar",
        file: "src/a.ts",
      },
    },
    {
      name: "a backtick in the symbol",
      entry: {
        target: "src/a.ts#Foo`Bar",
        file: "src/a.ts",
      },
    },
    {
      name: "a backslash separator",
      entry: {
        target: "src\\a.ts#Foo",
        file: "src\\a.ts",
      },
    },
    {
      name: "a non-canonical repeated separator",
      entry: {
        target: "src//a.ts#Foo",
        file: "src//a.ts",
      },
    },
    {
      name: "a non-canonical dot segment",
      entry: {
        target: "src/./a.ts#Foo",
        file: "src/./a.ts",
      },
    },
    {
      name: "a control character in the file path",
      entry: {
        target: "src/\u0000a.ts#Foo",
        file: "src/\u0000a.ts",
      },
    },
    {
      name: "a backtick in the file path",
      entry: {
        target: "src/a`b.ts#Foo",
        file: "src/a`b.ts",
      },
    },
    {
      name: "a DEL control character in the symbol",
      entry: {
        target: "src/a.ts#Foo\u007fBar",
        file: "src/a.ts",
      },
    },
  ])("rejects $name with the invalid-entry reason", ({ entry }) => {
    expect(
      parseContractSymbolTarget({
        kind: TierCCandidateKinds.CONTRACT_SYMBOL,
        commitSha: "sha1",
        ...entry,
      } as TierCQueueEntry),
    ).toEqual({
      ok: false,
      reason: TierCQueueValidationReasons.INVALID_ENTRY,
    });
  });

  it("rejects an entry whose kind is not contractSymbol", () => {
    expect(
      parseContractSymbolTarget({
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "src/a.ts#Foo",
        commitSha: "sha1",
        file: "src/a.ts",
      }),
    ).toEqual({
      ok: false,
      reason: TierCQueueValidationReasons.INVALID_ENTRY,
    });
  });
});

describe("readTierCQueue()", () => {
  it("returns [] when the meta key is absent", () => {
    const store = makeTierCStore();
    expect(readTierCQueue(store)).toEqual([]);
  });

  it("returns [] and does not throw on corrupt JSON", () => {
    const store = makeTierCStore({
      [GitConstants.META_KEY_TIER_C_QUEUE]: "not json",
    });
    expect(readTierCQueue(store)).toEqual([]);
  });

  it("returns [] when the stored value is valid JSON but not an array", () => {
    const store = makeTierCStore({
      [GitConstants.META_KEY_TIER_C_QUEUE]: JSON.stringify({ target: "a" }),
    });
    expect(readTierCQueue(store)).toEqual([]);
  });

  it("filters out malformed entries (missing target/commitSha or unknown kind)", () => {
    const store = makeTierCStore({
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
    const store = makeTierCStore();
    appendTierCQueueEntries(store, []);
    expect(store.meta.set).not.toHaveBeenCalled();
  });

  it("writes new entries when the queue is empty", () => {
    const store = makeTierCStore();
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
    const store = makeTierCStore();
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
    const store = makeTierCStore();
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
    const store = makeTierCStore();
    removeTierCQueueEntries(store, []);
    expect(store.meta.set).not.toHaveBeenCalled();
  });

  it("removes only the matching target, leaving the rest queued", () => {
    const store = makeTierCStore();
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

describe("recordTierCQueueFailure()", () => {
  it("increments failCount without eviction below the cap, leaving the entry queued", () => {
    const store = makeTierCStore();
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha1",
        commitSha: "sha1",
      },
    ]);

    const result = recordTierCQueueFailure(store, "sha1", 3);

    expect(result).toEqual({ evicted: false, failCount: 1 });
    expect(readTierCQueue(store)).toEqual([
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha1",
        commitSha: "sha1",
        failCount: 1,
      },
    ]);
  });

  it("evicts the entry once failCount reaches maxFailures", () => {
    const store = makeTierCStore();
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

    recordTierCQueueFailure(store, "sha1", 3);
    recordTierCQueueFailure(store, "sha1", 3);
    const result = recordTierCQueueFailure(store, "sha1", 3);

    expect(result).toEqual({ evicted: true, failCount: 3 });
    expect(readTierCQueue(store)).toEqual([
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha2",
        commitSha: "sha2",
      },
    ]);
  });

  it("is a no-op on an unknown target", () => {
    const store = makeTierCStore();
    appendTierCQueueEntries(store, [
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha1",
        commitSha: "sha1",
      },
    ]);

    const result = recordTierCQueueFailure(store, "does-not-exist", 3);

    expect(result).toEqual({ evicted: false, failCount: 0 });
    expect(readTierCQueue(store)).toEqual([
      {
        kind: TierCCandidateKinds.COMMIT_MESSAGE,
        target: "sha1",
        commitSha: "sha1",
      },
    ]);
  });
});
