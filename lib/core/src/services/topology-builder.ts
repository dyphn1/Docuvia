import {
  TOPOLOGY_VERSION,
  TopologyExportOptions,
  TopologyGraph,
  TopologyGroup,
  TopologyLink,
  TopologyNode,
} from "../types/topology.types.js";

const DEFAULT_MAX_NODES = 2000;

/**
 * Storage-agnostic input rows for the topology builder. The SQLite (local-first)
 * and PostgreSQL (API server) services normalize their rows into this shape so
 * the projection logic lives in exactly one place.
 */
export interface TopologyBuildL2Row {
  id: number | string;
  name: string;
  filePath?: string;
}

export interface TopologyBuildLinkRow {
  sourceNodeId: number | string;
  targetNodeId: number | string;
  linkType: string;
}

/** Pass only active/valid decisions — status filtering is a storage concern. */
export interface TopologyBuildL3Row {
  id: number | string;
  l2NodeId: number | string;
  title: string;
}

export interface TopologyBuildTagRow {
  l2NodeId: number | string;
  name: string;
}

export interface TopologyBuildInput {
  workspaceRoot: string;
  l2Rows: TopologyBuildL2Row[];
  linkRows: TopologyBuildLinkRow[];
  l3Rows: TopologyBuildL3Row[];
  tagRows: TopologyBuildTagRow[];
}

/**
 * Pure projection of graph rows into the versioned topology.json contract.
 *
 * Grouping note: v1 groups by directory cluster (first two path segments). L1 tags
 * are attached as node metadata instead of driving groups, because the current
 * ingestion pipeline assigns every workspace tag to every file node, which makes
 * tag-based partitioning degenerate (one group containing everything).
 */
export function buildTopologyGraph(
  input: TopologyBuildInput,
  options: TopologyExportOptions = {}
): TopologyGraph {
  const { l2Rows, linkRows, l3Rows, tagRows } = input;

  const filePathById = new Map<string, string | undefined>();
  for (const row of l2Rows) {
    filePathById.set(String(row.id), row.filePath);
  }

  // Symbols are the targets of `contains` links; their container file is the source.
  const containingFileId = new Map<string, string>();
  for (const link of linkRows) {
    if (link.linkType === "contains") {
      containingFileId.set(String(link.targetNodeId), String(link.sourceNodeId));
    }
  }

  const tagsByNodeId = new Map<string, string[]>();
  for (const row of tagRows) {
    const key = String(row.l2NodeId);
    const list = tagsByNodeId.get(key);
    if (list) list.push(row.name);
    else tagsByNodeId.set(key, [row.name]);
  }

  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const fullNodeCount = l2Rows.length + l3Rows.length;
  const collapse =
    options.collapse === "file" || (options.collapse !== "symbol" && fullNodeCount > maxNodes);

  const { nodes, links: rawLinks } = collapse
    ? buildCollapsed(l2Rows, linkRows, l3Rows, containingFileId, filePathById)
    : buildSymbolLevel(l2Rows, linkRows, l3Rows, containingFileId, filePathById);

  // Drop dangling links (legacy dbs can hold edges to deleted nodes).
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const links = rawLinks.filter((l) => nodeIdSet.has(l.source) && nodeIdSet.has(l.target));

  // Attach tags and assign directory-cluster groups.
  const groupIdByLabel = new Map<string, number>();
  const groups: TopologyGroup[] = [];
  for (const node of nodes) {
    const label = clusterLabel(node.filePath);
    let groupId = groupIdByLabel.get(label);
    if (groupId === undefined) {
      groupId = groups.length;
      groupIdByLabel.set(label, groupId);
      groups.push({ id: groupId, label, source: "directory", count: 0 });
    }
    node.group = groupId;
    groups[groupId].count++;

    if (node.kind === "file") {
      const tags = tagsByNodeId.get(node.id.slice("l2:".length));
      if (tags?.length) node.tags = tags;
    }
  }

  // Degree for renderer node sizing.
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  for (const node of nodes) {
    node.degree = degree.get(node.id) ?? 0;
  }

  return {
    topologyVersion: TOPOLOGY_VERSION,
    generatedAt: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    collapsed: collapse,
    nodes,
    links,
    groups,
    stats: {
      nodeCount: nodes.length,
      linkCount: links.length,
      groupCount: groups.length,
    },
  };
}

function buildSymbolLevel(
  l2Rows: TopologyBuildL2Row[],
  linkRows: TopologyBuildLinkRow[],
  l3Rows: TopologyBuildL3Row[],
  containingFileId: Map<string, string>,
  filePathById: Map<string, string | undefined>
): { nodes: TopologyNode[]; links: TopologyLink[] } {
  const nodes: TopologyNode[] = l2Rows.map((row) => ({
    id: `l2:${row.id}`,
    label: row.name,
    kind: containingFileId.has(String(row.id)) ? "symbol" : "file",
    group: 0,
    filePath: filePathById.get(String(row.id)),
    degree: 0,
  }));

  const links: TopologyLink[] = linkRows.map((link) => ({
    source: `l2:${link.sourceNodeId}`,
    target: `l2:${link.targetNodeId}`,
    linkType: link.linkType,
    confidence: 1,
  }));

  appendDecisions(nodes, links, l3Rows, filePathById);
  return { nodes, links };
}

function buildCollapsed(
  l2Rows: TopologyBuildL2Row[],
  linkRows: TopologyBuildLinkRow[],
  l3Rows: TopologyBuildL3Row[],
  containingFileId: Map<string, string>,
  filePathById: Map<string, string | undefined>
): { nodes: TopologyNode[]; links: TopologyLink[] } {
  const toFileId = (id: number | string) => containingFileId.get(String(id)) ?? String(id);

  const nodes: TopologyNode[] = l2Rows
    .filter((row) => !containingFileId.has(String(row.id)))
    .map((row) => ({
      id: `l2:${row.id}`,
      label: row.name,
      kind: "file" as const,
      group: 0,
      filePath: filePathById.get(String(row.id)),
      degree: 0,
    }));

  const links: TopologyLink[] = [];
  const seen = new Set<string>();
  for (const link of linkRows) {
    if (link.linkType === "contains") continue;
    const source = toFileId(link.sourceNodeId);
    const target = toFileId(link.targetNodeId);
    if (source === target) continue;
    const key = `${source}|${target}|${link.linkType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      source: `l2:${source}`,
      target: `l2:${target}`,
      linkType: link.linkType,
      confidence: 1,
    });
  }

  appendDecisions(nodes, links, l3Rows, filePathById);
  return { nodes, links };
}

function appendDecisions(
  nodes: TopologyNode[],
  links: TopologyLink[],
  l3Rows: TopologyBuildL3Row[],
  filePathById: Map<string, string | undefined>
): void {
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const row of l3Rows) {
    const parentId = `l2:${row.l2NodeId}`;
    // L3 decisions are keyed to file-level l2 nodes; skip orphans whose parent
    // was deleted (or folded away) rather than emitting a dangling edge.
    if (!nodeIds.has(parentId)) continue;
    nodes.push({
      id: `l3:${row.id}`,
      label: row.title,
      kind: "decision",
      group: 0,
      filePath: filePathById.get(String(row.l2NodeId)),
      parent: parentId,
      degree: 0,
    });
    links.push({
      source: `l3:${row.id}`,
      target: parentId,
      linkType: "decision",
      confidence: 1,
    });
  }
}

/** Directory cluster: first two posix path segments (e.g. "lib/core"), "." for root files. */
function clusterLabel(filePath: string | undefined): string {
  if (!filePath) return "(ungrouped)";
  const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length <= 1) return ".";
  return segments.slice(0, Math.min(2, segments.length - 1)).join("/");
}
