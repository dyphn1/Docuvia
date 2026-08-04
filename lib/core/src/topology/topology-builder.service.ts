import type {
  ITopologyBuilder,
  TopologyBuildInput,
  TopologyExportOptions,
  TopologyGraph,
  TopologyGroup,
  TopologyLink,
  TopologyNode,
  LinkType,
  L2NodeType,
  L3NodeType,
  ValidityStatus,
} from "@workspace/contracts";
import {
  TOPOLOGY_VERSION,
  LinkTypes,
  TopologyNodeKinds,
  TopologyCollapseModes,
  TopologyGroupSources,
} from "@workspace/contracts";
import {
  L2_NODE_ID_PREFIX,
  toL2NodeId,
  toL3NodeId,
} from "../constants/node-ids.js";

const DEFAULT_MAX_NODES = 2000;
/** Cluster label for nodes with no resolvable file path. */
const UNGROUPED_CLUSTER_LABEL = "(ungrouped)";
/** Cluster label for a node whose file path has no parent directory (repo-root file). */
const ROOT_CLUSTER_LABEL = ".";

interface NormalizedL2Row {
  id: number;
  name: string;
  filePath?: string;
  type: L2NodeType;
}

interface NormalizedLinkRow {
  sourceNodeId: number;
  targetNodeId: number;
  linkType: LinkType;
  commitSha?: string;
  diffSummary?: string;
}

interface NormalizedL3Row {
  id: number;
  l2NodeId: number;
  title: string;
  content?: string;
  nodeType: L3NodeType;
  confidence?: number;
  validityStatus: ValidityStatus;
  sourceCommits?: string[];
}

export class TopologyBuilderService implements ITopologyBuilder {
  build(
    input: TopologyBuildInput,
    options: TopologyExportOptions = {},
  ): TopologyGraph {
    const l2Rows = input.l2Rows.map((row): NormalizedL2Row => ({
      id: row.id,
      name: row.name,
      filePath: parseFilePath(row.path_patterns),
      type: row.type,
    }));
    const linkRows = input.linkRows.map((row): NormalizedLinkRow => ({
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      linkType: row.link_type,
      commitSha: row.commit_sha ?? undefined,
      diffSummary: row.diff_summary ?? undefined,
    }));
    const l3Rows = input.l3Rows.map((row): NormalizedL3Row => ({
      id: row.id,
      l2NodeId: row.l2_node_id,
      title: row.title,
      content: row.content ?? undefined,
      nodeType: row.node_type,
      confidence: row.confidence ?? undefined,
      validityStatus: row.validity_status,
      sourceCommits: parseJsonStringArray(row.source_commits),
    }));
    const tagRows = input.tagRows;

    const filePathById = buildFilePathIndex(l2Rows);
    const containingFileId = buildContainingFileIndex(linkRows);
    const tagsByNodeId = buildTagsIndex(tagRows);

    const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    const fullNodeCount = l2Rows.length + l3Rows.length;
    const collapse = shouldCollapse(options, fullNodeCount, maxNodes);

    const built = collapse
      ? buildCollapsed(l2Rows, linkRows, l3Rows, containingFileId, filePathById)
      : buildSymbolLevel(
          l2Rows,
          linkRows,
          l3Rows,
          containingFileId,
          filePathById,
        );
    const nodes = built.nodes;
    const rawLinks = built.links;

    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const links = rawLinks.filter(
      (l) => nodeIdSet.has(l.source) && nodeIdSet.has(l.target),
    );

    const groups = assignGroups(nodes, tagsByNodeId);
    computeDegrees(nodes, links);

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
        foldedLinkCount: built.foldedLinkCount ?? 0,
      },
    };
  }
}

function buildFilePathIndex(
  l2Rows: NormalizedL2Row[],
): Map<string, string | undefined> {
  const filePathById = new Map<string, string | undefined>();
  for (const row of l2Rows) {
    filePathById.set(String(row.id), row.filePath);
  }
  return filePathById;
}

function buildContainingFileIndex(
  linkRows: NormalizedLinkRow[],
): Map<string, string> {
  const containingFileId = new Map<string, string>();
  for (const link of linkRows) {
    if (link.linkType === LinkTypes.CONTAINS) {
      containingFileId.set(
        String(link.targetNodeId),
        String(link.sourceNodeId),
      );
    }
  }
  return containingFileId;
}

function buildTagsIndex(
  tagRows: TopologyBuildInput["tagRows"],
): Map<string, string[]> {
  const tagsByNodeId = new Map<string, string[]>();
  for (const row of tagRows) {
    const key = String(row.l2NodeId);
    const list = tagsByNodeId.get(key);
    if (list) list.push(row.name);
    else tagsByNodeId.set(key, [row.name]);
  }
  return tagsByNodeId;
}

function shouldCollapse(
  options: TopologyExportOptions,
  fullNodeCount: number,
  maxNodes: number,
): boolean {
  return (
    options.collapse === TopologyCollapseModes.FILE ||
    (options.collapse !== TopologyCollapseModes.SYMBOL &&
      fullNodeCount > maxNodes)
  );
}

/** Assigns each node to a directory-cluster group (creating groups on first use) and, for file
 *  nodes, attaches any tags — both mutate `nodes` in place, matching the original inline loop. */
function assignGroups(
  nodes: TopologyNode[],
  tagsByNodeId: Map<string, string[]>,
): TopologyGroup[] {
  const groupIdByLabel = new Map<string, number>();
  const groups: TopologyGroup[] = [];
  for (const node of nodes) {
    const label = clusterLabel(node.filePath);
    let groupId = groupIdByLabel.get(label);
    if (groupId === undefined) {
      groupId = groups.length;
      groupIdByLabel.set(label, groupId);
      groups.push({
        id: groupId,
        label,
        source: TopologyGroupSources.DIRECTORY,
        count: 0,
      });
    }
    node.group = groupId;
    groups[groupId].count++;

    if (node.kind === TopologyNodeKinds.FILE) {
      const tags = tagsByNodeId.get(node.id.slice(L2_NODE_ID_PREFIX.length));
      if (tags && tags.length) node.tags = tags;
    }
  }
  return groups;
}

/** Computes each node's in+out degree over `links` and stamps it onto `node.degree` in place. */
function computeDegrees(nodes: TopologyNode[], links: TopologyLink[]): void {
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  for (const node of nodes) {
    node.degree = degree.get(node.id) ?? 0;
  }
}

function buildSymbolLevel(
  l2Rows: NormalizedL2Row[],
  linkRows: NormalizedLinkRow[],
  l3Rows: NormalizedL3Row[],
  containingFileId: Map<string, string>,
  filePathById: Map<string, string | undefined>,
): { nodes: TopologyNode[]; links: TopologyLink[]; foldedLinkCount: number } {
  const nodes: TopologyNode[] = l2Rows.map((row) => ({
    id: toL2NodeId(row.id),
    label: row.name,
    kind: containingFileId.has(String(row.id))
      ? TopologyNodeKinds.SYMBOL
      : TopologyNodeKinds.FILE,
    group: 0,
    filePath: filePathById.get(String(row.id)),
    degree: 0,
    l2Type: row.type,
  }));

  const links: TopologyLink[] = linkRows.map((link) => ({
    source: toL2NodeId(link.sourceNodeId),
    target: toL2NodeId(link.targetNodeId),
    linkType: link.linkType,
    confidence: 1,
    commitSha: link.commitSha,
    diffSummary: link.diffSummary,
  }));

  appendDecisions(nodes, links, l3Rows, filePathById);
  return { nodes, links, foldedLinkCount: 0 };
}

function buildCollapsed(
  l2Rows: NormalizedL2Row[],
  linkRows: NormalizedLinkRow[],
  l3Rows: NormalizedL3Row[],
  containingFileId: Map<string, string>,
  filePathById: Map<string, string | undefined>,
): { nodes: TopologyNode[]; links: TopologyLink[]; foldedLinkCount: number } {
  const toFileId = (id: number | string) => {
    let current = String(id);
    const visited = new Set<string>([current]);
    for (;;) {
      const parent = containingFileId.get(current);
      if (parent === undefined || visited.has(parent)) return current;
      visited.add(parent);
      current = parent;
    }
  };

  const nodes: TopologyNode[] = l2Rows
    .filter((row) => !containingFileId.has(String(row.id)))
    .map((row) => ({
      id: toL2NodeId(row.id),
      label: row.name,
      kind: TopologyNodeKinds.FILE,
      group: 0,
      filePath: filePathById.get(String(row.id)),
      degree: 0,
      l2Type: row.type,
    }));

  const links: TopologyLink[] = [];
  const seen = new Set<string>();
  let foldedLinkCount = 0;
  for (const link of linkRows) {
    if (link.linkType === LinkTypes.CONTAINS) continue;
    const source = toFileId(link.sourceNodeId);
    const target = toFileId(link.targetNodeId);
    if (source === target) {
      // A relationship that only ever connected two symbols in the same file — folded away by
      // file-granularity collapse. Counted (not just silently dropped) so the CLI can report the
      // graph's real density even when the default view shows few/no cross-file links.
      foldedLinkCount++;
      continue;
    }
    const key = source + "|" + target + "|" + link.linkType;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      source: toL2NodeId(source),
      target: toL2NodeId(target),
      linkType: link.linkType,
      confidence: 1,
      commitSha: link.commitSha,
      diffSummary: link.diffSummary,
    });
  }

  appendDecisions(nodes, links, l3Rows, filePathById);
  return { nodes, links, foldedLinkCount };
}

function appendDecisions(
  nodes: TopologyNode[],
  links: TopologyLink[],
  l3Rows: NormalizedL3Row[],
  filePathById: Map<string, string | undefined>,
): void {
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const row of l3Rows) {
    const parentId = toL2NodeId(row.l2NodeId);
    if (!nodeIds.has(parentId)) continue;
    nodes.push({
      id: toL3NodeId(row.id),
      label: row.title,
      kind: TopologyNodeKinds.DECISION,
      group: 0,
      filePath: filePathById.get(String(row.l2NodeId)),
      parent: parentId,
      degree: 0,
      decisionType: row.nodeType,
      content: row.content,
      confidence: row.confidence,
      validityStatus: row.validityStatus,
      sourceCommits: row.sourceCommits,
    });
    links.push({
      source: toL3NodeId(row.id),
      target: parentId,
      linkType: LinkTypes.DECISION,
      confidence: 1,
    });
  }
}

function clusterLabel(filePath: string | undefined): string {
  if (!filePath) return UNGROUPED_CLUSTER_LABEL;
  const posixPath = filePath.split(String.fromCharCode(92)).join("/");
  const segments = posixPath.split("/").filter(Boolean);
  if (segments.length <= 1) return ROOT_CLUSTER_LABEL;
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

/** Parses `l3_nodes.source_commits`' JSON-array-of-shas storage shape; absent/empty/malformed
 *  input yields `undefined` so the field is omitted from the export rather than emitting `[]`. */
function parseJsonStringArray(
  raw: string | null | undefined,
): string[] | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
  } catch (e) {
    void e;
  }
  return undefined;
}
