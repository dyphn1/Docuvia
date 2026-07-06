import { compressAstContext as compressWithDedup } from "@workspace/ast-core";

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

/**
 * Delegates to @workspace/ast-core's dedup + confidence-sort + budget-aware assembly
 * pipeline (see ADR-010) instead of a plain in-order truncation, so near-duplicate
 * AST/document nodes don't eat the token budget ahead of higher-confidence ones.
 */
export function compressAstContext(
  nodes: CompressibleNode[],
  options?: CompressOptions
): CompressResult {
  if (!nodes || nodes.length === 0) {
    return { nodesTotal: 0, nodesIncluded: 0, charsSaved: 0, context: "" };
  }

  const result = compressWithDedup(nodes, {
    maxTotalChars: options?.maxTotalChars ?? 6000,
    maxPerNodeChars: options?.maxPerNodeChars ?? 600,
  });

  return {
    nodesTotal: result.nodesTotal,
    nodesIncluded: result.nodesIncluded,
    charsSaved: result.charsSaved,
    context: result.context,
  };
}
