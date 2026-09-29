import { describe, expect, it } from "vitest";
import { ErrorCodes } from "@workspace/contracts";
import {
  assignSplits,
  findFamilyRelations,
  fragmentKey,
  overlapCoefficient,
} from "./semantic-dedup-splits.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-06--deduplication-and-splits
const lines = ["a", "  const x = run( 1 );", "b", "c", "d", "e"];

describe("fragment dedup key", () => {
  it("[happy] identical windows modulo whitespace share a key", () => {
    const moved = ["", "", "", "a", "const   x = run(1 );", "b", "c"];
    expect(fragmentKey(moved, 4, "run")).toBe(
      fragmentKey(["", ...lines], 2, "run"),
    );
    expect(fragmentKey(moved, 4, "run")).not.toBe(fragmentKey(lines, 1, "run"));
  });

  it("[state-diff] a changed window line or callee changes the key", () => {
    const edited = [...lines];
    edited[3] = "changed";
    expect(fragmentKey(edited, 1, "run")).not.toBe(
      fragmentKey(lines, 1, "run"),
    );
    expect(fragmentKey(lines, 1, "go")).not.toBe(fragmentKey(lines, 1, "run"));
  });

  it("[boundary] windows are clipped at file edges", () => {
    expect(fragmentKey(["only()"], 0, "only")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("family relations", () => {
  it("[happy] overlap coefficient uses the smaller set", () => {
    expect(
      overlapCoefficient(new Set(["a", "b"]), new Set(["a", "c", "d", "e"])),
    ).toBe(0.5);
    expect(overlapCoefficient(new Set(), new Set(["a"]))).toBe(0);
  });

  it("[boundary] 20% overlap or a shared root commit relates snapshots", () => {
    const five = new Set(["1", "2", "3", "4", "5"]);
    const relations = findFamilyRelations([
      { snapshotId: "x", family: "fx", fileHashes: five, rootCommits: ["r1"] },
      {
        snapshotId: "y",
        family: "fy",
        fileHashes: new Set(["1", "9", "8", "7", "6"]),
        rootCommits: ["r2"],
      },
      {
        snapshotId: "z",
        family: "fz",
        fileHashes: new Set(["q"]),
        rootCommits: ["r1"],
      },
      {
        snapshotId: "w",
        family: "fw",
        fileHashes: new Set(["p", "o", "n", "m", "l", "k"]),
        rootCommits: ["r3"],
      },
    ]);
    expect(relations).toEqual([
      { a: "x", b: "y", overlap: 0.2, sharedRoot: false, crossFamily: true },
      { a: "x", b: "z", overlap: 0, sharedRoot: true, crossFamily: true },
    ]);
  });
});

describe("split assignment", () => {
  const item = (
    sampleId: string,
    family: string,
    duplicateGroup: string,
    temporal = false,
  ) => ({ sampleId, family, duplicateGroup, temporal });
  const families = { t1: "train", c1: "calibration", s1: "test" } as const;

  it("[happy] assigns by declared family split and marks temporal snapshots", () => {
    const result = assignSplits(
      [
        item("a", "t1", "g1"),
        item("b", "s1", "g2"),
        item("c", "s1", "g3", true),
      ],
      families,
    );
    expect(result.assigned).toEqual({ a: "train", b: "test", c: "temporal" });
    expect(result.dropped).toEqual([]);
  });

  it("[negative] a duplicate group keeps only its highest-priority split", () => {
    const result = assignSplits(
      [
        item("a", "t1", "g"),
        item("b", "c1", "g"),
        item("c", "s1", "g"),
        item("d", "t1", "h"),
        item("e", "c1", "h"),
      ],
      families,
    );
    expect(result.assigned).toEqual({ c: "test", e: "calibration" });
    expect(result.dropped).toEqual([
      { sampleId: "a", reason: "dedup-cross-split" },
      { sampleId: "b", reason: "dedup-cross-split" },
      { sampleId: "d", reason: "dedup-cross-split" },
    ]);
  });

  it("[state-diff] temporal samples unchanged from the earlier snapshot are dropped", () => {
    const result = assignSplits(
      [
        item("old", "s1", "g"),
        item("same", "s1", "g", true),
        item("new", "s1", "n", true),
      ],
      families,
    );
    expect(result.assigned).toEqual({ old: "test", new: "temporal" });
    expect(result.dropped).toEqual([
      { sampleId: "same", reason: "temporal-unchanged" },
    ]);
  });

  it("[state-diff] unsampled fragments of the earlier snapshot also block temporal novelty", () => {
    const result = assignSplits(
      [
        item("t1", "s1", "seen-unsampled", true),
        item("t2", "s1", "fresh", true),
      ],
      families,
      new Map([["s1", new Set(["seen-unsampled"])]]),
    );
    expect(result.assigned).toEqual({ t2: "temporal" });
    expect(result.dropped).toEqual([
      { sampleId: "t1", reason: "temporal-unchanged" },
    ]);
  });

  it("[invalid-input] an undeclared family or temporal outside test fails", () => {
    const code = { code: ErrorCodes.SEMANTIC_CORPUS_INVALID };
    expect(() => assignSplits([item("a", "nope", "g")], families)).toThrow(
      expect.objectContaining(code),
    );
    expect(() => assignSplits([item("a", "t1", "g", true)], families)).toThrow(
      expect.objectContaining(code),
    );
  });

  it("[error-handling] reports the invalid temporal-family rule with context", () => {
    expect(() => assignSplits([item("a", "t1", "g", true)], families)).toThrow(
      expect.objectContaining({
        code: ErrorCodes.SEMANTIC_CORPUS_INVALID,
        message: "Temporal snapshot of t1 must belong to a test family",
      }),
    );
  });
});
