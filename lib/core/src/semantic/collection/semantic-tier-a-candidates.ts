import { createHash } from "node:crypto";
import {
  SemanticDecisionLimits,
  type SemanticCollectionCallSite,
  type SemanticCollectionGraphEdge,
  type SemanticCollectionGraphNode,
  type SemanticTierACandidateSet,
} from "@workspace/contracts";

/** C-02 frozen feature schema identity; changing the rule below requires a new version. */
export const TIER_A_FEATURE_SCHEMA = "tier-a-name-match/v1";

const ANONYMOUS_SYMBOL = "anonymous";
const KEY_SEPARATOR = "#";

export interface TierAIndex {
  readonly byName: ReadonlyMap<string, readonly SemanticCollectionGraphNode[]>;
  readonly callTargetsByFile: ReadonlyMap<string, ReadonlySet<string>>;
  readonly importsByFile: ReadonlyMap<string, ReadonlySet<string>>;
}

function fileOf(key: string): string {
  const index = key.indexOf(KEY_SEPARATOR);
  return index === -1 ? key : key.slice(0, index);
}

function addTo(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function isCandidateNode(node: SemanticCollectionGraphNode): boolean {
  return node.nodeKey.includes(KEY_SEPARATOR) && node.name !== ANONYMOUS_SYMBOL;
}

export function createTierAIndex(
  nodes: readonly SemanticCollectionGraphNode[],
  edges: readonly SemanticCollectionGraphEdge[],
): TierAIndex {
  const byName = new Map<string, SemanticCollectionGraphNode[]>();
  for (const node of nodes.filter(isCandidateNode)) {
    byName.set(node.name, [...(byName.get(node.name) ?? []), node]);
  }
  const callTargetsByFile = new Map<string, Set<string>>();
  const importsByFile = new Map<string, Set<string>>();
  for (const edge of edges) {
    const target = edge.kind === "calls" ? callTargetsByFile : importsByFile;
    const value =
      edge.kind === "calls" ? edge.targetKey : fileOf(edge.targetKey);
    addTo(target, fileOf(edge.sourceKey), value);
  }
  return { byName, callTargetsByFile, importsByFile };
}

export function candidateId(nodeKey: string): string {
  const digest = createHash("sha256").update(nodeKey, "utf8").digest("hex");
  return `tierA:${digest.slice(0, 16)}`;
}

function rank(
  index: TierAIndex,
  callerFile: string,
  node: SemanticCollectionGraphNode,
): number {
  if (index.callTargetsByFile.get(callerFile)?.has(node.nodeKey)) return 0;
  if (index.importsByFile.get(callerFile)?.has(node.filePath)) return 1;
  return 2;
}

/** C-02: every same-name symbol outside the caller file, ranked by Tier A evidence, capped. */
export function tierACandidates(
  index: TierAIndex,
  callSite: SemanticCollectionCallSite,
  limit: number = SemanticDecisionLimits.MAX_CANDIDATES,
): SemanticTierACandidateSet {
  const ranked = (index.byName.get(callSite.calleeName) ?? [])
    .filter((node) => node.filePath !== callSite.filePath)
    .map((node) => ({ node, rank: rank(index, callSite.filePath, node) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.node.nodeKey < b.node.nodeKey
          ? -1
          : a.node.nodeKey > b.node.nodeKey
            ? 1
            : 0),
    );
  return {
    candidates: ranked.slice(0, limit).map(({ node }) => ({
      id: candidateId(node.nodeKey),
      targetId: node.nodeKey,
    })),
    truncated: ranked.length > limit,
    matchCount: ranked.length,
  };
}
