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
import {
  GROUP_RING_RADIUS_UNIT,
  CONTAINMENT_LINK_DISTANCE,
  DEFAULT_LINK_DISTANCE,
  LINK_STRENGTH,
  CHARGE_STRENGTH,
  CHARGE_DISTANCE_MAX,
  GROUP_CENTERING_STRENGTH,
  DECISION_NODE_RADIUS,
  NODE_RADIUS_BASE,
  NODE_RADIUS_DEGREE_SCALE,
  LINK_TYPE_CONTAINS,
  LINK_TYPE_DECISION,
  NODE_KIND_DECISION,
} from "@/constants/topology";

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
  const ringR = GROUP_RING_RADIUS_UNIT * Math.sqrt(Math.max(groupIds.length, 1));
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
        .distance((l) =>
          l.linkType === LINK_TYPE_CONTAINS || l.linkType === LINK_TYPE_DECISION
            ? CONTAINMENT_LINK_DISTANCE
            : DEFAULT_LINK_DISTANCE
        )
        .strength(LINK_STRENGTH)
    )
    .force("charge", forceManyBody().strength(CHARGE_STRENGTH).distanceMax(CHARGE_DISTANCE_MAX))
    .force(
      "x",
      forceX<SimNode>((d) => centers.get(d.group)?.x ?? 0).strength(GROUP_CENTERING_STRENGTH)
    )
    .force(
      "y",
      forceY<SimNode>((d) => centers.get(d.group)?.y ?? 0).strength(GROUP_CENTERING_STRENGTH)
    )
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
  return n.kind === NODE_KIND_DECISION
    ? DECISION_NODE_RADIUS
    : NODE_RADIUS_BASE + NODE_RADIUS_DEGREE_SCALE * Math.sqrt(n.degree / maxDegree);
}
