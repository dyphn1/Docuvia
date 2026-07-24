import type {
  GraphContext,
  IGraphStore,
  ILogger,
  IQueryService,
  LocalQueryResult,
  LocalSearchResult,
} from "@workspace/contracts";
import {
  createNoopLogger,
  LinkTypes,
  QueryResultLayers,
} from "@workspace/contracts";

const QueryMessages = {
  INVALID_LIMIT_FALLBACK:
    "Ignoring invalid query limit, falling back to default",
  SEARCHED_LOCAL_KNOWLEDGE_GRAPH: "Searched local knowledge graph",
  GET_CONTEXT_FAILED:
    "getContext() failed during query(), falling back to null context",
  linkedTo: (name: string) => `Linked to ${name}`,
} as const;

/**
 * Deterministic stop-word list — ported from old Docuvia's `local-nl-query.service.ts`, where it
 * was only used as the fallback "if the LLM is unreachable" path. The LLM-based intent-extraction
 * hop itself is out of scope for this milestone (tracked separately), so this fallback is used
 * unconditionally here.
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "or",
  "show",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

type ScoredResult = LocalSearchResult & { score: number };

/**
 * Local-first (no-LLM) natural-language + structural query surface (Domain Core logic) — mirrors
 * old Docuvia's `QueryService`. Built entirely on `IGraphStore`'s repo interfaces.
 */
export class QueryService implements IQueryService {
  constructor(private readonly logger: ILogger = createNoopLogger()) {}

  extractKeywords(query: string): string[] {
    const tokens = query
      .split(/[^\w./-]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t.toLowerCase()));
    return Array.from(new Set(tokens));
  }

  getContext(store: IGraphStore, target: string): GraphContext | null {
    const node = store.graph.findNodeByName(target);
    if (!node) return null;

    return {
      incoming: store.graph
        .getIncomingRelations(node.id)
        .filter((edge) => edge.linkType !== LinkTypes.CONTAINS)
        .map(({ name, linkType }) => ({ name, linkType })),
      outgoing: store.graph
        .getOutgoingRelations(node.id)
        .filter((edge) => edge.linkType !== LinkTypes.CONTAINS)
        .map(({ name, linkType }) => ({ name, linkType })),
    };
  }

  search(store: IGraphStore, target: string, limit = 10): LocalSearchResult[] {
    // An invalid `limit` (negative, zero, non-integer, NaN) must not silently produce
    // inconsistent results: the FTS path below binds it straight into SQL `LIMIT ?`, where
    // SQLite treats a negative value as "unlimited", while the neighbor path uses
    // `Array.prototype.slice(0, limit)`, where a negative value truncates from the end instead —
    // two different, silently wrong behaviors from the same bad input. Normalize once here so
    // every caller (CLI, MCP server, tests) gets the same safe behavior regardless of call site.
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      this.logger.warn(QueryMessages.INVALID_LIMIT_FALLBACK, {
        target,
        invalidLimit: limit,
        fallback: 10,
      });
      limit = 10;
    }

    const merged = new Map<string, ScoredResult>();
    const put = (result: ScoredResult): void => {
      const key = `${result.layer}:${result.id}`;
      const existing = merged.get(key);
      if (!existing || result.score > existing.score) merged.set(key, result);
    };

    const keywords = this.extractKeywords(target);
    if (keywords.length > 0) {
      store.fts.searchL2Nodes(keywords, limit).forEach((row, i) =>
        put({
          layer: QueryResultLayers.L2,
          id: row.id,
          title: row.name,
          content: row.description,
          score: 0.9 - i * 0.01,
        }),
      );
      store.fts.searchL3Nodes(keywords, limit).forEach((row, i) =>
        put({
          layer: QueryResultLayers.L3,
          id: row.id,
          title: row.title,
          content: row.content,
          score: 0.85 - i * 0.01,
        }),
      );
    }

    const nodeRef = target.trim();
    if (nodeRef) {
      const resolved = store.graph.findNodeByName(nodeRef);
      if (resolved) {
        put({
          layer: QueryResultLayers.L2,
          id: resolved.id,
          title: resolved.name,
          content: null,
          score: 0.95,
        });

        const neighbors = [
          ...store.graph.getOutgoingEdges(resolved.id),
          ...store.graph.getIncomingEdges(resolved.id),
        ];
        neighbors.slice(0, limit).forEach((neighbor, i) =>
          put({
            layer: QueryResultLayers.L2,
            id: neighbor.id,
            title: neighbor.name,
            content: QueryMessages.linkedTo(resolved.name),
            score: 0.7 - i * 0.01,
          }),
        );
      }
    }

    this.logger.debug(QueryMessages.SEARCHED_LOCAL_KNOWLEDGE_GRAPH, {
      target,
      resultCount: merged.size,
    });

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score: _score, ...rest }) => rest);
  }

  query(store: IGraphStore, target: string, limit = 10): LocalQueryResult {
    const results = this.search(store, target, limit);
    const l2Result = results.find((r) => r.layer === QueryResultLayers.L2);
    const l3Results = results.filter((r) => r.layer === QueryResultLayers.L3);

    // `getContext()` is an additive structural lookup on top of the FTS/name-ref search above —
    // ported from old Docuvia's `QueryService.query()`, which wrapped this same call so a
    // structural-context failure never makes the whole query() throw. Falls back to `context:
    // null` on failure.
    let context: GraphContext | null = null;
    try {
      context = this.getContext(store, target);
    } catch (err) {
      this.logger.debug(QueryMessages.GET_CONTEXT_FAILED, {
        target,
        error: err instanceof Error ? err.message : String(err),
      });
      context = null;
    }

    // Re-resolves the winning L2 result by its own (exact) name to attach `type`/`filePath` —
    // `search()`'s FTS/neighbor rows don't carry either, and an `<l2_module>` block with no file
    // or kind context read as empty even when it correctly named the right symbol.
    const l2Node = l2Result
      ? store.graph.findNodeByName(l2Result.title)
      : undefined;

    return {
      l2: l2Result
        ? {
            name: l2Result.title,
            type: l2Node?.type ?? "",
            filePath: l2Node?.filePath,
          }
        : null,
      l3: l3Results.map((r) => ({ title: r.title, content: r.content })),
      context,
    };
  }
}
