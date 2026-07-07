import {
  IIntentRouter,
  IIntentClassifier,
  IVectorSearchHandler,
  IGraphTraversalHandler,
  IDirectLookupHandler,
  IHybridSearchHandler,
} from "../../interfaces/intent-router.interfaces.js";
import {
  RouteQueryResult,
  IntentClassification,
  AgenticSearchResult,
  SearchMode,
} from "../../types/intent-router.types.js";
import { db } from "@workspace/db";
import { l1TagsTable, l2NodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger.js";

export class IntentRouterService implements IIntentRouter {
  constructor(
    private classifier: IIntentClassifier,
    private vectorSearchHandler: IVectorSearchHandler,
    private graphTraversalHandler: IGraphTraversalHandler,
    private directLookupHandler: IDirectLookupHandler,
    private hybridSearchHandler: IHybridSearchHandler
  ) {}

  async routeQuery(
    query: string,
    projectId?: number,
    limit = 10,
    includePending = false
  ): Promise<RouteQueryResult> {
    const start = Date.now();
    const trimmed = query.trim();

    // Max's Rule: Use exact matching instead of ReDoS-vulnerable regex.
    // We avoid native Regex. Check if it's a single word (e.g. symbol) without spaces.
    const isSingleWord = !/\s/.test(trimmed) && trimmed.length > 3;

    if (isSingleWord) {
      const rawSearch = trimmed.replace(/[`"]/g, "");
      // Fall back to directSearch which now utilizes standard DB ILIKE (surrogate for pg_trgm)
      const results = await this.directLookupHandler.lookup(
        rawSearch,
        projectId,
        limit,
        includePending
      );

      // If we find exact matches, return instantly without calling the LLM
      if (results.length > 0) {
        return {
          routingStrategy: "direct_lookup",
          entities: { searchQuery: rawSearch },
          results,
          metadata: {
            classificationConfidence: 1.0,
            reasoning: "Exact match short-circuit",
            durationMs: Date.now() - start,
            searchMode: "keyword_graph",
          },
        };
      }
    }

    let classification: IntentClassification | null = null;

    // Fast Arbitration pipeline: Direct Filter
    if (query.includes("#attach") || /src\/|\.ts|\.md/i.test(query)) {
      classification = {
        strategy: "direct_lookup",
        entities: { searchQuery: query },
        confidence: 1.0,
        reasoning: "O(1) fast-path matched #attach or file extension",
      };
    }

    // Fast Arbitration pipeline: Graph Filter
    if (!classification) {
      const tags = await db.select({ name: l1TagsTable.name }).from(l1TagsTable);

      let l2Query = db.select({ name: l2NodesTable.name }).from(l2NodesTable).$dynamic();
      if (projectId) {
        l2Query = l2Query.where(eq(l2NodesTable.projectId, projectId));
      }
      const l2Rows = await l2Query;

      const allArchitecturalTerms = [...tags.map((t) => t.name), ...l2Rows.map((n) => n.name)];

      for (const term of allArchitecturalTerms) {
        if (term && query.toLowerCase().includes(term.toLowerCase())) {
          classification = {
            strategy: "graph_traversal",
            entities: { moduleName: term },
            confidence: 1.0,
            reasoning: "O(1) fast-path matched architectural term",
          };
          break;
        }
      }
    }

    // Fallback to LLM classification
    if (!classification) {
      classification = await this.classifier.classifyIntent(query, projectId);
    }

    logger.info(
      {
        strategy: classification.strategy,
        confidence: classification.confidence,
        entities: classification.entities,
      },
      "[intent-router] query classified"
    );

    let results: AgenticSearchResult[];
    // Graph traversal and direct lookup are inherently keyword/graph operations;
    // vector/hybrid report whether they degraded from semantic mode (ADR-029).
    let searchMode: SearchMode = "keyword_graph";

    switch (classification.strategy) {
      case "graph_traversal": {
        const moduleName = classification.entities.moduleName ?? query;
        results = await this.graphTraversalHandler.traverse(moduleName, projectId, limit);
        break;
      }
      case "direct_lookup": {
        const searchQuery = classification.entities.searchQuery ?? query;
        results = await this.directLookupHandler.lookup(
          searchQuery,
          projectId,
          limit,
          includePending
        );
        break;
      }
      case "hybrid": {
        const outcome = await this.hybridSearchHandler.search(
          query,
          classification,
          projectId,
          limit,
          includePending
        );
        results = outcome.results;
        searchMode = outcome.mode;
        break;
      }
      case "vector_search":
      default: {
        const searchQuery = classification.entities.searchQuery ?? query;
        const outcome = await this.vectorSearchHandler.search(
          searchQuery,
          projectId,
          limit,
          includePending
        );
        results = outcome.results;
        searchMode = outcome.mode;
        break;
      }
    }

    const durationMs = Date.now() - start;

    logger.info(
      { strategy: classification.strategy, resultCount: results.length, durationMs, searchMode },
      "[intent-router] query complete"
    );

    return {
      routingStrategy: classification.strategy,
      entities: classification.entities,
      results,
      metadata: {
        classificationConfidence: classification.confidence,
        reasoning: classification.reasoning,
        durationMs,
        searchMode,
      },
    };
  }
}
