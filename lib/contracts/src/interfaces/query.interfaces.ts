import type { IGraphStore } from "./graph-store.interfaces.js";

/**
 * Local-first (no-LLM) natural-language + structural query surface (Domain Core logic) —
 * mirrors old Docuvia's `QueryService`, minus the LLM-based intent-extraction hop (deferred,
 * tracked separately): keyword extraction always uses the deterministic stop-word-stripping
 * fallback old Docuvia only used when its LLM was unreachable.
 */
export interface GraphEdgeRef {
  name: string;
  type: string;
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
  l2: { name: string } | null;
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
