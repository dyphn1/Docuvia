import { describe, expect, it } from "vitest";
import { load } from "js-yaml";
import { parse } from "smol-toml";

describe("ast-core runtime dependencies", () => {
  it("resolves js-yaml from dependencies", () => {
    expect(load("answer: 42").answer).toBe(42);
  });

  it("resolves smol-toml from dependencies", () => {
    expect(parse("answer = 42").answer).toBe(42);
  });

  it("resolves web-tree-sitter from dependencies", async () => {
    const treeSitter = await import("web-tree-sitter");
    expect(treeSitter.Parser).toBeTypeOf("function");
  });
});
