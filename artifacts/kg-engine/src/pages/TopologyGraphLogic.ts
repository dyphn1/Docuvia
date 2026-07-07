import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { TopologyNode, TopologyLink } from "@workspace/api-client-react";

export const PALETTE = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
  "#5B8DEF",
  "#8CD17D",
];
export const DECISION_COLOR = "#E8B931";

export type SimNode = TopologyNode & SimulationNodeDatum;
export type SimLink = SimulationLinkDatum<SimNode> & Pick<TopologyLink, "linkType" | "confidence">;

export interface LayoutResult {
  nodes: SimNode[];
  links: Array<SimLink & { source: SimNode; target: SimNode }>;
  maxDegree: number;
}

/** Static layout: run the simulation to completion once per dataset (d3-force docs pattern). */
export function computeLayout(nodes: TopologyNode[], links: TopologyLink[]): LayoutResult {
  const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  const simLinks: SimLink[] = links
    .filter((l) => byId.has(l.source) && byId.has(l.target))
    .map((l) => ({
      source: l.source,
      target: l.target,
      linkType: l.linkType,
      confidence: l.confidence,
    }));

  // Seed group centers on a ring so directory clusters separate cleanly.
  const groupIds = [...new Set(simNodes.map((n) => n.group))];
  const ringR = 150 * Math.sqrt(Math.max(groupIds.length, 1));
  const centers = new Map<number, { x: number; y: number }>();
  groupIds.forEach((gid, i) => {
    const a = (2 * Math.PI * i) / groupIds.length;
    centers.set(gid, { x: ringR * Math.cos(a), y: ringR * Math.sin(a) });
  });

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) => (l.linkType === "contains" || l.linkType === "decision" ? 60 : 140))
        .strength(0.4)
    )
    .force("charge", forceManyBody().strength(-150).distanceMax(450))
    .force("x", forceX<SimNode>((d) => centers.get(d.group)?.x ?? 0).strength(0.08))
    .force("y", forceY<SimNode>((d) => centers.get(d.group)?.y ?? 0).strength(0.08))
    .force("center", forceCenter(0, 0))
    .stop();

  const ticks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
  for (let i = 0; i < ticks; i++) sim.tick();

  let maxDegree = 1;
  simNodes.forEach((n) => {
    if (n.degree > maxDegree) maxDegree = n.degree;
  });

  return {
    nodes: simNodes,
    links: simLinks as LayoutResult["links"],
    maxDegree,
  };
}

export function convexHull(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof sorted = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: typeof sorted = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function nodeRadius(n: SimNode, maxDegree: number): number {
  return n.kind === "decision" ? 6 : 6 + 14 * Math.sqrt(n.degree / maxDegree);
}
