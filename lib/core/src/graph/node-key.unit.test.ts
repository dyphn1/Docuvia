import { describe, it, expect } from "vitest";
import { buildUniqueNodeKey } from "./node-key.js";

describe("buildUniqueNodeKey()", () => {
  it("returns the bare key unchanged when there is no collision -- the common case", () => {
    const used = new Set<string>(["a.ts"]);
    expect(buildUniqueNodeKey(used, "a.ts#foo", 3)).toBe("a.ts#foo");
  });

  it("appends the start line only once the bare key is already used", () => {
    const used = new Set<string>(["a.ts", "a.ts#handle"]);
    expect(buildUniqueNodeKey(used, "a.ts#handle", 12)).toBe("a.ts#handle@L12");
  });

  it("falls back to a counter once even the line-qualified key collides", () => {
    const used = new Set<string>(["a.ts", "a.ts#handle", "a.ts#handle@L5"]);
    expect(buildUniqueNodeKey(used, "a.ts#handle", 5)).toBe("a.ts#handle@L5#2");
  });

  it("keeps incrementing the counter past the first retry", () => {
    const used = new Set<string>([
      "a.ts",
      "a.ts#handle",
      "a.ts#handle@L5",
      "a.ts#handle@L5#2",
      "a.ts#handle@L5#3",
    ]);
    expect(buildUniqueNodeKey(used, "a.ts#handle", 5)).toBe("a.ts#handle@L5#4");
  });

  it("never mutates the used-keys set itself -- callers own the .add() step", () => {
    const used = new Set<string>(["a.ts", "a.ts#handle"]);
    buildUniqueNodeKey(used, "a.ts#handle", 12);
    expect(used.has("a.ts#handle@L12")).toBe(false);
  });
});
