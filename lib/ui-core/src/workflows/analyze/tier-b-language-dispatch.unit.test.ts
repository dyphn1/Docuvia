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
  ])("routes %s to the %s plugin", (file, expected) => {
    expect(dispatchTierBLanguage(file)).toBe(expected);
  });

  it.each(["src/a.py", "src/a.go", "src/a.rs", "src/a.md", "src/a"])(
    "has no plugin for %s -- undefined, stays AST-level",
    (file) => {
      expect(dispatchTierBLanguage(file)).toBeUndefined();
    },
  );
});

describe("partitionQueueByLanguage()", () => {
  it("splits entries into supported/unsupported by extension", () => {
    const entries = [
      { file: "src/a.ts", commitSha: "sha1" },
      { file: "src/b.py", commitSha: "sha2" },
      { file: "src/c.tsx", commitSha: "sha3" },
    ];

    const { supported, unsupported } = partitionQueueByLanguage(entries);

    expect(supported).toEqual([
      { file: "src/a.ts", commitSha: "sha1" },
      { file: "src/c.tsx", commitSha: "sha3" },
    ]);
    expect(unsupported).toEqual([{ file: "src/b.py", commitSha: "sha2" }]);
  });

  it("returns empty arrays for an empty queue", () => {
    expect(partitionQueueByLanguage([])).toEqual({
      supported: [],
      unsupported: [],
    });
  });
});
