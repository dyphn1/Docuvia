export interface CompressibleNode {
  title: string;
  content: string;
  nodeType?: string;
  confidence?: number;
}

export interface CompressOptions {
  maxTotalChars?: number;
  maxPerNodeChars?: number;
}

export interface CompressResult {
  nodesTotal: number;
  nodesIncluded: number;
  charsSaved: number;
  context: string;
}

export function compressAstContext(
  nodes: CompressibleNode[],
  options?: CompressOptions
): CompressResult {
  if (!nodes || nodes.length === 0) {
    return { nodesTotal: 0, nodesIncluded: 0, charsSaved: 0, context: "" };
  }

  const maxTotal = options?.maxTotalChars ?? 6000;
  const maxPerNode = options?.maxPerNodeChars ?? 600;

  let result = "";
  let currentTotal = 0;
  let nodesIncluded = 0;
  let originalChars = 0;

  for (const node of nodes) {
    const header = `--- ${node.title} ${node.nodeType ? `[${node.nodeType}]` : ""} ---\n`;
    let content = node.content || "";
    originalChars += content.length;

    if (currentTotal >= maxTotal) continue;

    if (content.length > maxPerNode) {
      content = content.substring(0, maxPerNode) + "\n... (truncated)";
    }

    const entry = header + content + "\n\n";
    if (currentTotal + entry.length <= maxTotal) {
      result += entry;
      currentTotal += entry.length;
      nodesIncluded++;
    }
  }

  return {
    nodesTotal: nodes.length,
    nodesIncluded,
    charsSaved: originalChars - currentTotal, // Approximation
    context: result.trim(),
  };
}
