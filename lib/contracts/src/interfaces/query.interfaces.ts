import type { IGraphStore } from "./graph-store.interfaces.js";

/**
 * Local-first (no-LLM) natural-language + structural query surface (Domain Core logic) —
 * mirrors old Docuvia's `QueryService`, minus the LLM-based intent-extraction hop (deferred,
 * tracked separately): keyword extraction always uses the deterministic stop-word-stripping
 * fallback old Docuvia only used when its LLM was unreachable.
 */
export interface GraphEdgeRef {
  name: string;
  /** The relationship itself (`calls`/`implements`/`extends`/...) — previously this field held the
   *  *neighbor node's* own kind instead, which is always `"module"` today (every symbol/file row
   *  shares one `L2NodeType`, see `persist-ast-graph.ts`) and so never actually told a caller
   *  anything. `getContext()` also excludes `contains` edges from both `incoming`/`outgoing`: a
   *  symbol's own containing file isn't a "caller"/"callee", and leaving it in crowded out (or
   *  masqueraded as) genuine relationships for foundational symbols with few resolved
   *  calls/implements/extends edges. */
  linkType: string;
}

export interface GraphContext {
  incoming: GraphEdgeRef[];
  outgoing: GraphEdgeRef[];
}

export const QueryResultLayers = {
  L2: "l2",
  L3: "l3",
} as const;
export type QueryResultLayer =
  (typeof QueryResultLayers)[keyof typeof QueryResultLayers];

export interface LocalSearchResult {
  layer: QueryResultLayer;
  id: number;
  title: string;
  content: string | null;
}

export interface LocalQueryResult {
  l2: { name: string; type: string; filePath?: string } | null;
  l3: Array<{ title: string; content: string | null }>;
  context: GraphContext | null;
}

export interface IQueryService {
  /** Deterministic stop-word-stripping tokenizer (old Docuvia's LLM-unreachable fallback, used unconditionally here). */
  extractKeywords(query: string): string[];
  /** Structural context (incoming/outgoing edges) for a resolved node, or null if `target` doesn't resolve. */
  getContext(store: IGraphStore, target: string): GraphContext | null;
  /** FTS keyword search + node-ref exact/LIKE lookup + 1-hop neighbor traversal, deduped and ranked. */
  search(
    store: IGraphStore,
    target: string,
    limit?: number,
  ): LocalSearchResult[];
  /** End-to-end query: `search()` bucketed into {l2, l3} plus `getContext()`. */
  query(store: IGraphStore, target: string, limit?: number): LocalQueryResult;
}
