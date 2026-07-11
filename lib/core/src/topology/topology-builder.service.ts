import type {
  ITopologyBuilder,
  TopologyBuildInput,
  TopologyExportOptions,
  TopologyGraph,
  TopologyGroup,
  TopologyLink,
  TopologyNode,
} from "@workspace/contracts";
import { TOPOLOGY_VERSION } from "@workspace/contracts";

const DEFAULT_MAX_NODES = 2000;

interface NormalizedL2Row {
  id: number;
  name: string;
  filePath?: string;
}

interface NormalizedLinkRow {
  sourceNodeId: number;
  targetNodeId: number;
  linkType: string;
}

interface NormalizedL3Row {
  id: number;
  l2NodeId: number;
  title: string;
}

export class TopologyBuilderService implements ITopologyBuilder {
  build(input: TopologyBuildInput, options: TopologyExportOptions = {}): TopologyGraph {
    const l2Rows = input.l2Rows.map(
      (row): NormalizedL2Row => ({ id: row.id, name: row.name, filePath: parseFilePath(row.path_patterns) })
    );
    const linkRows = input.linkRows.map(
      (row): NormalizedLinkRow => ({
        sourceNodeId: row.source_node_id,
        targetNodeId: row.target_node_id,
        linkType: row.link_type,
      })
    );
    const l3Rows = input.l3Rows.map(
      (row): NormalizedL3Row => ({ id: row.id, l2NodeId: row.l2_node_id, title: row.title })
    );
    const tagRows = input.tagRows;

    const filePathById = new Map<string, string | undefined>();
    for (const row of l2Rows) {
      filePathById.set(String(row.id), row.filePath);
    }

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

    const built = collapse
      ? buildCollapsed(l2Rows, linkRows, l3Rows, containingFileId, filePathById)
      : buildSymbolLevel(l2Rows, linkRows, l3Rows, containingFileId, filePathById);
    const nodes = built.nodes;
    const rawLinks = built.links;

    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const links = rawLinks.filter((l) => nodeIdSet.has(l.source) && nodeIdSet.has(l.target));

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
        if (tags && tags.length) node.tags = tags;
      }
    }

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
}

function buildSymbolLevel(
  l2Rows: NormalizedL2Row[],
  linkRows: NormalizedLinkRow[],
  l3Rows: NormalizedL3Row[],
  containingFileId: Map<string, string>,
  filePathById: Map<string, string | undefined>
): { nodes: TopologyNode[]; links: TopologyLink[] } {
  const nodes: TopologyNode[] = l2Rows.map((row) => ({
    id: "l2:" + row.id,
    label: row.name,
    kind: containingFileId.has(String(row.id)) ? "symbol" : "file",
    group: 0,
    filePath: filePathById.get(String(row.id)),
    degree: 0,
  }));

  const links: TopologyLink[] = linkRows.map((link) => ({
    source: "l2:" + link.sourceNodeId,
    target: "l2:" + link.targetNodeId,
    linkType: link.linkType,
    confidence: 1,
  }));

  appendDecisions(nodes, links, l3Rows, filePathById);
  return { nodes, links };
}

function buildCollapsed(
  l2Rows: NormalizedL2Row[],
  linkRows: NormalizedLinkRow[],
  l3Rows: NormalizedL3Row[],
  containingFileId: Map<string, string>,
  filePathById: Map<string, string | undefined>
): { nodes: TopologyNode[]; links: TopologyLink[] } {
  const toFileId = (id: number | string) => containingFileId.get(String(id)) ?? String(id);

  const nodes: TopologyNode[] = l2Rows
    .filter((row) => !containingFileId.has(String(row.id)))
    .map((row) => ({
      id: "l2:" + row.id,
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
    const key = source + "|" + target + "|" + link.linkType;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: "l2:" + source, target: "l2:" + target, linkType: link.linkType, confidence: 1 });
  }

  appendDecisions(nodes, links, l3Rows, filePathById);
  return { nodes, links };
}

function appendDecisions(
  nodes: TopologyNode[],
  links: TopologyLink[],
  l3Rows: NormalizedL3Row[],
  filePathById: Map<string, string | undefined>
): void {
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const row of l3Rows) {
    const parentId = "l2:" + row.l2NodeId;
    if (!nodeIds.has(parentId)) continue;
    nodes.push({
      id: "l3:" + row.id,
      label: row.title,
      kind: "decision",
      group: 0,
      filePath: filePathById.get(String(row.l2NodeId)),
      parent: parentId,
      degree: 0,
    });
    links.push({ source: "l3:" + row.id, target: parentId, linkType: "decision", confidence: 1 });
  }
}

function clusterLabel(filePath: string | undefined): string {
  if (!filePath) return "(ungrouped)";
  const posixPath = filePath.split(String.fromCharCode(92)).join("/");
  const segments = posixPath.split("/").filter(Boolean);
  if (segments.length <= 1) return ".";
  return segments.slice(0, Math.min(2, segments.length - 1)).join("/");
}

function parseFilePath(raw: string | null): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0]);
  } catch (e) {
    void e;
  }
  return raw;
}
