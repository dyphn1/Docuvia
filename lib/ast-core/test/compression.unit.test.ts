import { describe, it, expect } from "vitest";
import { compressAstContext, CompressibleNode } from "../src/compression.js";

describe("compressAstContext", () => {
  it("deduplicates near-identical nodes, keeping the highest-confidence copy", () => {
    const nodes: CompressibleNode[] = [
      {
        title: "auth.ts",
        content: "export function login() {}",
        confidence: 0.4,
      },
      {
        title: "auth.ts",
        content: "export function login() {}",
        confidence: 0.9,
      },
    ];

    const result = compressAstContext(nodes);

    expect(result.nodesTotal).toBe(1);
    expect(result.nodesIncluded).toBe(1);
  });

  it("prioritizes higher-confidence nodes when the char budget is exceeded", () => {
    const nodes: CompressibleNode[] = [
      { title: "low-confidence", content: "a".repeat(50), confidence: 0.1 },
      { title: "high-confidence", content: "b".repeat(50), confidence: 0.9 },
    ];

    // Budget fits exactly one truncated entry (~31 chars), not both (~61 chars).
    const result = compressAstContext(nodes, {
      maxTotalChars: 35,
      maxPerNodeChars: 5,
    });

    expect(result.context).toContain("high-confidence");
    expect(result.context).not.toContain("low-confidence");
  });

  it("returns an empty result for an empty node list", () => {
    const result = compressAstContext([]);
    expect(result).toEqual({
      nodesTotal: 0,
      nodesIncluded: 0,
      charsSaved: 0,
      context: "",
    });
  });
});
