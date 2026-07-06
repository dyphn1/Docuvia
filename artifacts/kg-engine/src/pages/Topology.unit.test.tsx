import { describe, it, expect } from "vitest";
import type { TopologyNode, TopologyLink } from "@workspace/api-client-react";
import { computeLayout } from "./Topology";

const node = (id: string, group: number, degree: number): TopologyNode => ({
  id,
  label: id,
  kind: "file",
  group,
  degree,
});

describe("computeLayout", () => {
  it("assigns finite positions to every node and resolves link endpoints", () => {
    const nodes = [node("a", 0, 2), node("b", 0, 1), node("c", 1, 1)];
    const links: TopologyLink[] = [
      { source: "a", target: "b", linkType: "calls", confidence: 1 },
      { source: "a", target: "c", linkType: "imports", confidence: 1 },
    ];

    const layout = computeLayout(nodes, links);

    expect(layout.nodes).toHaveLength(3);
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    expect(layout.links).toHaveLength(2);
    expect(layout.links[0].source.id).toBe("a");
    expect(layout.links[0].target.id).toBe("b");
    expect(layout.maxDegree).toBe(2);
  });

  it("drops links whose endpoints are not in the node set", () => {
    const layout = computeLayout(
      [node("a", 0, 1)],
      [{ source: "a", target: "ghost", linkType: "calls", confidence: 1 }]
    );
    expect(layout.links).toHaveLength(0);
  });

  it("separates different groups further apart than same-group nodes on average", () => {
    const nodes = [node("a1", 0, 1), node("a2", 0, 1), node("b1", 1, 1), node("b2", 1, 1)];
    const layout = computeLayout(nodes, []);
    const pos = new Map(layout.nodes.map((n) => [n.id, n]));
    const dist = (p: string, q: string) => {
      const a = pos.get(p)!;
      const b = pos.get(q)!;
      return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
    };
    const intra = (dist("a1", "a2") + dist("b1", "b2")) / 2;
    const inter = (dist("a1", "b1") + dist("a2", "b2")) / 2;
    expect(inter).toBeGreaterThan(intra);
  });
});
