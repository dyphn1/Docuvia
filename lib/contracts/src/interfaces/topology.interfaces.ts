import type {
  L2NodeRow,
  L3NodeRow,
  NodeLinkRow,
} from "./graph-store.interfaces.js";

/**
 * Topology export schema (machine-readable knowledge-graph projection), ported near-verbatim
 * from old Docuvia's `lib/core/src/types/topology.types.ts` — a pure, storage-agnostic data
 * shape (zero logic), so it belongs here rather than in `lib/schema` or `lib/core`. Bump
 * `TOPOLOGY_VERSION` on any breaking change to this shape.
 */
export const TOPOLOGY_VERSION = 1;

export type TopologyNodeKind = "file" | "symbol" | "decision";

export type TopologyCollapseMode = "auto" | "file" | "symbol";

export interface TopologyNode {
  /** Stable id: "l2:<l2_nodes.id>" or "l3:<l3_nodes.id>" */
  id: string;
  label: string;
  kind: TopologyNodeKind;
  /** Group id referencing TopologyGroup.id */
  group: number;
  /** Workspace-relative source file (absent for ungrouped/unknown nodes) */
  filePath?: string;
  /** For decision nodes: the l2 node id ("l2:<id>") the decision documents */
  parent?: string;
  /** Link count touching this node — renderers use it for node sizing */
  degree: number;
  /** L1 tag names attached to this node (file nodes only) */
  tags?: string[];
}

export interface TopologyLink {
  source: string;
  target: string;
  /** contains | calls | implements | extends | imports | depends_on | decision */
  linkType: string;
  /** 0-1; reserved for LSP-enriched / inferred edges. Static AST edges are 1. */
  confidence: number;
}

export interface TopologyGroup {
  id: number;
  label: string;
  /** How the group was derived. Directory clustering is the v1 default. */
  source: "l1_tag" | "directory";
  /** Number of member nodes */
  count: number;
}

export interface TopologyStats {
  nodeCount: number;
  linkCount: number;
  groupCount: number;
}

export interface TopologyGraph {
  topologyVersion: number;
  generatedAt: string;
  workspaceRoot: string;
  /** True when symbol nodes were folded into their file nodes (node-cap or explicit mode) */
  collapsed: boolean;
  nodes: TopologyNode[];
  links: TopologyLink[];
  groups: TopologyGroup[];
  stats: TopologyStats;
}

export interface TopologyExportOptions {
  /**
   * "symbol": full symbol-level graph. "file": fold symbols into their files.
   * "auto" (default): symbol-level unless node count exceeds maxNodes.
   */
  collapse?: TopologyCollapseMode;
  /** Node cap for "auto" collapse (default 2000) */
  maxNodes?: number;
}

/**
 * Raw storage-shaped input for the topology builder (Domain Core logic in `lib/core`) — the
 * builder itself does the `path_patterns` JSON-parsing/grouping/collapsing projection, so this
 * layer just hands it the already-mapped repo row types directly (no separate "storage-agnostic
 * row" indirection needed now that there is only one storage backend).
 */
export interface TopologyBuildInput {
  workspaceRoot: string;
  l2Rows: L2NodeRow[];
  linkRows: NodeLinkRow[];
  /** Pass only exportable decisions — status filtering is `IL3NodesRepo.getAllExportable()`'s job. */
  l3Rows: L3NodeRow[];
  tagRows: Array<{ l2NodeId: number; name: string }>;
}

export interface ITopologyBuilder {
  build(
    input: TopologyBuildInput,
    options?: TopologyExportOptions,
  ): TopologyGraph;
}
