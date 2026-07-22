import { describe, it, expect } from "vitest";
import {
  dispatchTierBLanguage,
  partitionQueueByLanguage,
} from "./tier-b-language-dispatch.js";

describe("dispatchTierBLanguage() (§8e, D4)", () => {
  it.each([
    ["src/a.ts", "typescript"],
    ["src/a.tsx", "typescript"],
    ["src/a.mts", "typescript"],
    ["src/a.cts", "typescript"],
    ["src/a.js", "typescript"],
    ["src/a.jsx", "typescript"],
    ["src/a.mjs", "typescript"],
    ["src/a.cjs", "typescript"],
    ["src/a.py", "python"],
  ])("routes %s to the %s plugin", (file, expected) => {
    expect(dispatchTierBLanguage(file)).toBe(expected);
  });

  it.each(["src/a.swift", "src/a.kt", "src/a.md", "src/a"])(
    "has no plugin for %s -- undefined, stays AST-level",
    (file) => {
      expect(dispatchTierBLanguage(file)).toBeUndefined();
    },
  );
});

describe("partitionQueueByLanguage()", () => {
  it("buckets entries by language id, and separates out unsupported extensions", () => {
    const entries = [
      { file: "src/a.ts", commitSha: "sha1" },
      { file: "src/b.py", commitSha: "sha2" },
      { file: "src/c.tsx", commitSha: "sha3" },
      { file: "src/d.swift", commitSha: "sha4" },
    ];

    const { buckets, unsupported } = partitionQueueByLanguage(entries);

    expect(buckets).toEqual({
      typescript: [
        { file: "src/a.ts", commitSha: "sha1" },
        { file: "src/c.tsx", commitSha: "sha3" },
      ],
      python: [{ file: "src/b.py", commitSha: "sha2" }],
    });
    expect(unsupported).toEqual([{ file: "src/d.swift", commitSha: "sha4" }]);
  });

  it("returns empty buckets/unsupported for an empty queue", () => {
    expect(partitionQueueByLanguage([])).toEqual({
      buckets: {},
      unsupported: [],
    });
  });
});
