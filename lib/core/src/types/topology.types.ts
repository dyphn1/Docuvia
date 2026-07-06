/**
 * Topology export schema (machine-readable knowledge-graph projection).
 *
 * Single source of truth for the `topology.json` contract shared by the
 * local-first CLI export (SQLite, lib/core) and the API server (PostgreSQL).
 * Bump TOPOLOGY_VERSION on any breaking change to this shape.
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
