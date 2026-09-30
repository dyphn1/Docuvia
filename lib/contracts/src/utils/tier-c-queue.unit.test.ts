import { describe, expect, it } from "vitest";
import { TierCCandidateKinds } from "../constants/tier-c-queue.js";
import type { TierCQueueEntry } from "../interfaces/tier-c-queue.interfaces.js";
import { decodeTierCQueue } from "./tier-c-queue.js";

const commitMessageEntry = {
  kind: TierCCandidateKinds.COMMIT_MESSAGE,
  target: "sha1",
  commitSha: "sha1",
  message: "feat: add queue decoder",
} as const;

const contractSymbolEntry = {
  kind: TierCCandidateKinds.CONTRACT_SYMBOL,
  target: "src/example.ts#Example",
  commitSha: "sha1",
  file: "src/example.ts",
} as const;

describe("decodeTierCQueue()", () => {
  it("[happy] decodes valid entries from both discriminated variants", () => {
    expect(
      decodeTierCQueue(
        JSON.stringify([commitMessageEntry, contractSymbolEntry]),
      ),
    ).toEqual({
      entries: [commitMessageEntry, contractSymbolEntry],
      invalidCount: 0,
      corrupt: false,
    });
  });

  it.each([
    ["missing message", { ...commitMessageEntry, message: undefined }],
    ["missing file", { ...contractSymbolEntry, file: undefined }],
  ])("[invalid-input] rejects a %s", (_name, entry) => {
    expect(decodeTierCQueue(JSON.stringify([entry]))).toEqual({
      entries: [],
      invalidCount: 1,
      corrupt: false,
    });
  });

  it.each([
    ["target", { ...commitMessageEntry, target: 42 }],
    ["commitSha", { ...commitMessageEntry, commitSha: false }],
    ["message", { ...commitMessageEntry, message: 42 }],
    ["file", { ...contractSymbolEntry, file: 42 }],
    ["failCount", { ...commitMessageEntry, failCount: "1" }],
  ])("[invalid-input] rejects a wrong-typed %s field", (_field, entry) => {
    expect(decodeTierCQueue(JSON.stringify([entry])).invalidCount).toBe(1);
  });

  it("[invalid-input] rejects unknown candidate kinds", () => {
    expect(
      decodeTierCQueue(
        JSON.stringify([{ ...commitMessageEntry, kind: "unknown" }]),
      ),
    ).toEqual({ entries: [], invalidCount: 1, corrupt: false });
  });

  it.each([-1, 1.5])(
    "[invalid-input] rejects invalid failCount %s",
    (failCount) => {
      expect(
        decodeTierCQueue(JSON.stringify([{ ...commitMessageEntry, failCount }]))
          .invalidCount,
      ).toBe(1);
    },
  );

  it("[invalid-input] rejects non-object rows while preserving valid rows", () => {
    expect(
      decodeTierCQueue(
        JSON.stringify([null, 42, "entry", [], contractSymbolEntry]),
      ),
    ).toEqual({
      entries: [contractSymbolEntry],
      invalidCount: 4,
      corrupt: false,
    });
  });

  it.each(["not json", JSON.stringify({ target: "sha1" })])(
    "[error-handling] returns a non-fatal corrupt outcome for %s",
    (raw) => {
      expect(decodeTierCQueue(raw)).toEqual({
        entries: [],
        invalidCount: 0,
        corrupt: true,
      });
    },
  );

  it("[happy] treats an absent meta value as an empty, non-corrupt queue", () => {
    expect(decodeTierCQueue(undefined)).toEqual({
      entries: [],
      invalidCount: 0,
      corrupt: false,
    });
  });

  it("[happy] preserves failCount values through JSON persistence", () => {
    const entries: TierCQueueEntry[] = [
      { ...commitMessageEntry, failCount: 3 },
      { ...contractSymbolEntry, failCount: 2 },
    ];

    expect(decodeTierCQueue(JSON.stringify(entries)).entries).toEqual(entries);
  });

  it("[invalid-input] requires kind-specific fields when entries are constructed in TypeScript", () => {
    const validCommitMessage: TierCQueueEntry = commitMessageEntry;
    const validContractSymbol: TierCQueueEntry = contractSymbolEntry;
    // @ts-expect-error commitMessage entries require message
    const missingMessage: TierCQueueEntry = {
      kind: TierCCandidateKinds.COMMIT_MESSAGE,
      target: "sha1",
      commitSha: "sha1",
    };
    // @ts-expect-error contractSymbol entries require file
    const missingFile: TierCQueueEntry = {
      kind: TierCCandidateKinds.CONTRACT_SYMBOL,
      target: "src/example.ts#Example",
      commitSha: "sha1",
    };

    expect([
      validCommitMessage,
      validContractSymbol,
      missingMessage,
      missingFile,
    ]).toHaveLength(4);
  });
});
