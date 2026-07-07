import {
  IHybridSearchHandler,
  IVectorSearchHandler,
  IGraphTraversalHandler,
} from "../../interfaces/intent-router.interfaces.js";
import {
  AgenticSearchResult,
  IntentClassification,
  SearchOutcome,
} from "../../types/intent-router.types.js";

export class HybridSearchService implements IHybridSearchHandler {
  constructor(
    private vectorSearchHandler: IVectorSearchHandler,
    private graphTraversalHandler: IGraphTraversalHandler
  ) {}

  async search(
    query: string,
    classification: IntentClassification,
    projectId?: number,
    limit = 10,
    includePending = false
  ): Promise<SearchOutcome> {
    const searchQuery = classification.entities.searchQuery ?? query;

    // Step 1: vector search (may degrade to keyword mode per ADR-029)
    const vectorOutcome = await this.vectorSearchHandler.search(
      searchQuery,
      projectId,
      limit,
      includePending
    );
    const vectorResults = vectorOutcome.results;

    // Step 2: extract unique L2 node names from top-3 vector results
    const topL2Names = vectorResults
      .filter((r) => r.nodeLayer === "l2")
      .slice(0, 3)
      .map((r) => r.title);

    // Step 3: graph traversal for each unique L2 name
    const graphResultArrays = await Promise.all(
      topL2Names.map((name) => this.graphTraversalHandler.traverse(name, projectId))
    );
    const graphResults = graphResultArrays.flat();

    // Step 4: Merge and provide scoring boost for intersection
    const mergedMap = new Map<string, AgenticSearchResult>();

    for (const r of vectorResults) {
      const key = `${r.nodeLayer}:${r.id}`;
      mergedMap.set(key, { ...r });
    }

    for (const r of graphResults) {
      const key = `${r.nodeLayer}:${r.id}`;
      if (mergedMap.has(key)) {
        const existing = mergedMap.get(key)!;
        // Provide a scoring boost to elements present in both sets
        existing.score += r.score * 0.25;
      } else {
        mergedMap.set(key, { ...r });
      }
    }

    const merged = Array.from(mergedMap.values());

    // Step 5: re-rank and return top limit
    merged.sort((a, b) => b.score - a.score);
    return { results: merged.slice(0, limit), mode: vectorOutcome.mode };
  }
}
