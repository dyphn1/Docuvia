import { describe, it, expect } from "vitest";
import { buildUniqueNodeKey, buildQualifiedBaseKey } from "./node-key.js";

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

describe("buildQualifiedBaseKey() (GRPH-006)", () => {
  it("qualifies the base key with the container name when one is given", () => {
    expect(buildQualifiedBaseKey("a.ts", "handle", "ClassA")).toBe(
      "a.ts#ClassA.handle",
    );
  });

  it("falls back to today's flat shape when there is no container (top-level function)", () => {
    expect(buildQualifiedBaseKey("a.ts", "handle", undefined)).toBe(
      "a.ts#handle",
    );
    expect(buildQualifiedBaseKey("a.ts", "handle")).toBe("a.ts#handle");
  });

  it("gives two identically-named methods on different classes structurally different base keys -- no collision to disambiguate", () => {
    const keyA = buildQualifiedBaseKey("a.ts", "handle", "ClassA");
    const keyB = buildQualifiedBaseKey("a.ts", "handle", "ClassB");
    expect(keyA).not.toBe(keyB);
  });

  it("still collides -- and still needs buildUniqueNodeKey's line/counter disambiguation -- for two identically-named methods on the SAME class (overloads)", () => {
    const baseKey = buildQualifiedBaseKey("a.ts", "handle", "ClassA");
    const used = new Set<string>(["a.ts", baseKey]);
    expect(buildUniqueNodeKey(used, baseKey, 12)).toBe(
      "a.ts#ClassA.handle@L12",
    );
  });
});
