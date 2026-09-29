import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  SemanticCollectionCallSite,
  SemanticCollectionGraphEdge,
  SemanticCollectionGraphNode,
} from "@workspace/contracts";
import {
  candidateId,
  createTierAIndex,
  tierACandidates,
} from "./semantic-tier-a-candidates.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-02--tier-a-candidate-set-feature-schema-tier-a-name-matchv1
const node = (nodeKey: string): SemanticCollectionGraphNode => ({
  nodeKey,
  name: nodeKey.split("#")[1].split(".").pop()!.split("@")[0],
  filePath: nodeKey.split("#")[0],
});
const site = (
  calleeName: string,
  filePath = "src/caller.ts",
): SemanticCollectionCallSite => ({
  filePath,
  line: 3,
  column: 4,
  calleeName,
  calleeKind: "bare",
});
const targets = (set: { candidates: readonly { targetId: string }[] }) =>
  set.candidates.map((c) => c.targetId);

describe("tier A candidate set", () => {
  it("[happy] ranks call-edge targets, then imported files, then other same-name symbols", () => {
    const nodes = [
      "src/z.ts#run",
      "src/imported.ts#run",
      "src/a.ts#run",
      "src/linked.ts#Runner.run",
      "src/caller.ts#run",
      "src/caller.ts#main",
      "src/a.ts#other",
    ].map(node);
    const edges: SemanticCollectionGraphEdge[] = [
      {
        sourceKey: "src/caller.ts#main",
        targetKey: "src/linked.ts#Runner.run",
        kind: "calls",
      },
      {
        sourceKey: "src/caller.ts",
        targetKey: "src/imported.ts",
        kind: "imports",
      },
      { sourceKey: "src/other.ts#x", targetKey: "src/z.ts#run", kind: "calls" },
    ];
    const set = tierACandidates(createTierAIndex(nodes, edges), site("run"));
    expect(targets(set)).toEqual([
      "src/linked.ts#Runner.run",
      "src/imported.ts#run",
      "src/a.ts#run",
      "src/z.ts#run",
    ]);
    expect(set).toMatchObject({ truncated: false, matchCount: 4 });
  });

  it("[happy] candidate IDs are a stable hash of the node key", () => {
    const set = tierACandidates(
      createTierAIndex([node("src/a.ts#run")], []),
      site("run"),
    );
    const digest = createHash("sha256").update("src/a.ts#run").digest("hex");
    expect(set.candidates[0].id).toBe(`tierA:${digest.slice(0, 16)}`);
    expect(candidateId("src/a.ts#run")).toBe(set.candidates[0].id);
  });

  it("[boundary] caps at the limit, keeps rank order and records the full match count", () => {
    const nodes = Array.from({ length: 33 }, (_, i) =>
      node(`src/f${String(i).padStart(2, "0")}.ts#run`),
    );
    const edges: SemanticCollectionGraphEdge[] = [
      { sourceKey: "src/caller.ts", targetKey: "src/f32.ts", kind: "imports" },
    ];
    const index = createTierAIndex(nodes, edges);
    const capped = tierACandidates(index, site("run"), 32);
    expect(capped.candidates).toHaveLength(32);
    expect(capped).toMatchObject({ truncated: true, matchCount: 33 });
    expect(targets(capped)[0]).toBe("src/f32.ts#run");
    const exact = tierACandidates(index, site("run"), 33);
    expect(exact).toMatchObject({ truncated: false, matchCount: 33 });
  });

  it("[negative] never proposes same-file symbols or different names", () => {
    const index = createTierAIndex(
      [node("src/caller.ts#run"), node("src/a.ts#runner")],
      [],
    );
    expect(tierACandidates(index, site("run"))).toEqual({
      candidates: [],
      truncated: false,
      matchCount: 0,
    });
  });

  it("[invalid-input] ignores file nodes and anonymous symbols as candidates", () => {
    const index = createTierAIndex(
      [
        { nodeKey: "src/run.ts", name: "run", filePath: "src/run.ts" },
        node("src/a.ts#anonymous"),
      ],
      [],
    );
    expect(tierACandidates(index, site("run")).candidates).toEqual([]);
    expect(tierACandidates(index, site("anonymous")).candidates).toEqual([]);
  });

  it("[state-diff] input order does not change the ordered result", () => {
    const nodes = ["src/b.ts#run", "src/a.ts#run", "src/c.ts#run"].map(node);
    const a = tierACandidates(createTierAIndex(nodes, []), site("run"));
    const b = tierACandidates(
      createTierAIndex([...nodes].reverse(), []),
      site("run"),
    );
    expect(b).toEqual(a);
    expect(targets(a)).toEqual([
      "src/a.ts#run",
      "src/b.ts#run",
      "src/c.ts#run",
    ]);
  });
});
