export type RoutingStrategy = "vector_search" | "graph_traversal" | "direct_lookup" | "hybrid";

/**
 * Which retrieval mode actually produced the results (ADR-029):
 * - "semantic_vector": pgvector cosine similarity on the API server.
 * - "keyword_graph": graceful degradation to keyword/FTS matching plus graph traversal.
 */
export type SearchMode = "semantic_vector" | "keyword_graph";

/**
 * Structured query extracted from natural language by the LLM intent extractor
 * (ADR-029). Executed against SQLite FTS5 (keywords) and the AST graph (nodeRefs)
 * in local mode instead of vector search.
 */
export interface LocalQueryIntent {
  keywords: string[];
  nodeRefs: string[];
}

export interface IntentClassification {
  strategy: RoutingStrategy;
  entities: {
    moduleName?: string | null;
    commitHash?: string | null;
    searchQuery?: string | null;
  };
  confidence: number;
  reasoning: string;
}

export interface AgenticSearchResult {
  source: "vector" | "graph" | "direct";
  nodeLayer: "l1" | "l2" | "l3" | "commit";
  id: number | string;
  title: string;
  content: string | null;
  projectId: number | null;
  projectName: string | null;
  score: number;
  createdAt: string;
}

/** Result list plus the retrieval mode that produced it (semantic vs. degraded keyword/graph). */
export interface SearchOutcome {
  results: AgenticSearchResult[];
  mode: SearchMode;
}

export interface RouteQueryResult {
  routingStrategy: RoutingStrategy;
  entities: IntentClassification["entities"];
  results: AgenticSearchResult[];
  metadata: {
    classificationConfidence: number;
    reasoning: string;
    durationMs: number;
    searchMode?: SearchMode;
  };
}
