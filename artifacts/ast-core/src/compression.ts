/**
 * AST Context Compression Pipeline
 *
 * Reduces token volume before sending AST context to LLM.
 * Strategy: deduplicate → confidence-sort → truncate → budget-aware assembly.
 */

export interface CompressibleNode {
  title: string;
  content?: string | null;
  nodeType?: string;
  confidence?: number;
}

export interface CompressionOptions {
  /** Max total characters across all nodes (default: 8000) */
  maxTotalChars?: number;
  /** Max characters per node content (default: 500) */
  maxPerNodeChars?: number;
  /** Minimum confidence threshold (default: 0) */
  minConfidence?: number;
}

/**
 * Deduplicate nodes by a content hash (title + first 200 chars of content).
 * Keeps the highest-confidence copy when duplicates exist.
 */
export function dedupNodes(nodes: CompressibleNode[]): CompressibleNode[] {
  const seen = new Map<string, CompressibleNode>();

  for (const node of nodes) {
    const hash = `${node.title}::${(node.content ?? "").slice(0, 200)}`;
    const existing = seen.get(hash);
    if (!existing || (node.confidence ?? 0) > (existing.confidence ?? 0)) {
      seen.set(hash, node);
    }
  }

  return Array.from(seen.values());
}

/**
 * Sort nodes by confidence descending, then by title for stability.
 */
export function sortByConfidence(nodes: CompressibleNode[]): CompressibleNode[] {
  return [...nodes].sort((a, b) => {
    const confDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (confDiff !== 0) return confDiff;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Truncate node content to maxPerNodeChars, adding ellipsis if truncated.
 */
function truncateContent(content: string | null | undefined, maxChars: number): string {
  if (!content) return "";
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars - 3) + "...";
}

/**
 * Assemble context string from nodes, respecting total character budget.
 * Returns the assembled string and how many nodes were included.
 */
export function assembleContext(
  nodes: CompressibleNode[],
  options: CompressionOptions = {}
): { context: string; nodesIncluded: number; nodesTotal: number } {
  const maxTotal = options.maxTotalChars ?? 8000;
  const maxPerNode = options.maxPerNodeChars ?? 500;
  const minConf = options.minConfidence ?? 0;

  const filtered = nodes.filter((n) => (n.confidence ?? 1) >= minConf);
  const sorted = sortByConfidence(filtered);

  const parts: string[] = [];
  let totalChars = 0;

  for (const node of sorted) {
    const entry = `- [${node.nodeType ?? "node"}] ${node.title}: ${truncateContent(node.content, maxPerNode)}`;
    if (totalChars + entry.length > maxTotal) break;
    parts.push(entry);
    totalChars += entry.length;
  }

  return {
    context: parts.join("\n"),
    nodesIncluded: parts.length,
    nodesTotal: sorted.length,
  };
}

/**
 * Full compression pipeline: dedup → sort → assemble.
 */
export function compressAstContext(
  nodes: CompressibleNode[],
  options: CompressionOptions = {}
): { context: string; nodesIncluded: number; nodesTotal: number; charsSaved: number } {
  const originalLength = nodes.reduce((sum, n) => sum + (n.content?.length ?? 0), 0);

  const deduped = dedupNodes(nodes);
  const { context, nodesIncluded, nodesTotal } = assembleContext(deduped, options);

  return {
    context,
    nodesIncluded,
    nodesTotal,
    charsSaved: originalLength - context.length,
  };
}
