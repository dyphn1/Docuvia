export type RoutingStrategy = "vector_search" | "graph_traversal" | "direct_lookup" | "hybrid";

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

export interface RouteQueryResult {
  routingStrategy: RoutingStrategy;
  entities: IntentClassification["entities"];
  results: AgenticSearchResult[];
  metadata: {
    classificationConfidence: number;
    reasoning: string;
    durationMs: number;
  };
}
