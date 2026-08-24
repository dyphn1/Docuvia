import type {
  GraphContext,
  IGraphStore,
  ILogger,
  IQueryService,
  LocalQueryResult,
  LocalQueryResultL3Entry,
  LocalSearchResult,
} from "@workspace/contracts";
import {
  createNoopLogger,
  LinkTypes,
  QueryResultLayers,
} from "@workspace/contracts";
import { resolveTierBCoverageHint } from "../graph/tier-b-coverage.js";

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
 * How many FTS candidates to pull per layer before re-ranking by keyword coverage (roadmap item
 * 25) — wider than the caller's requested `limit` so a correct match that BM25 alone would rank
 * below `limit` (because it only wins on one common term while a wrong doc wins on IDF rarity for
 * another) still has a chance to surface. The caller-facing `limit` is unchanged; this only widens
 * the internal candidate pool searched before the final coverage re-rank + score-sort + slice.
 */
const FTS_CANDIDATE_POOL_MULTIPLIER = 5;
const FTS_CANDIDATE_POOL_MIN = 25;

function resolveFtsCandidateLimit(limit: number): number {
  return Math.max(
    limit * FTS_CANDIDATE_POOL_MULTIPLIER,
    FTS_CANDIDATE_POOL_MIN,
  );
}

/**
 * Stable-sorts FTS rows by keyword coverage (desc), falling back to each row's original BM25 rank
 * order as a tiebreaker (`Array.prototype.sort` is spec-guaranteed stable as of ES2019, and this
 * package targets Node 20 — see `artifacts/cli/tsup.config.ts`). Plain BM25 rank alone lets a
 * document matching one *rare* keyword (e.g. "command", if few files mention it) outrank a document
 * matching a *common* one (e.g. "query", mentioned everywhere) even when the second document is the
 * actual target and the first is unrelated — the failure
 * docs/gitbook/analysis/roadmap-and-open-items.md item 25 tracks ("query command" resolving to
 * init-command-lock.ts instead of query.ts, live-verified against this repo at 51.9% baseline
 * accuracy on concept-phrase queries).
 *
 * `membershipSets[i]` is the set of row ids that matched keyword `i`, sourced from the FTS index
 * itself (one single-keyword search per keyword) rather than a raw JS substring check — substring
 * matching on `name`/`description`/`path_patterns` would silently disagree with what the index
 * actually matched once porter stemming (migration 0007) folds a query keyword and an indexed word
 * to the same token but their raw spellings differ (e.g. keyword "queries" vs. indexed "query").
 * A single-keyword query never has a meaningful coverage difference between matched rows (FTS only
 * returns rows matching at least one OR'd term), so an empty `membershipSets` is a no-op for the
 * case that already worked well (exact-symbol lookups, single-word queries).
 */
function rerankByKeywordCoverage<T extends { id: number }>(
  rows: T[],
  membershipSets: Set<number>[],
): T[] {
  if (membershipSets.length <= 1) return rows;
  return rows
    .map((row) => ({
      row,
      coverage: membershipSets.reduce(
        (count, set) => (set.has(row.id) ? count + 1 : count),
        0,
      ),
    }))
    .sort((a, b) => b.coverage - a.coverage)
    .map(({ row }) => row);
}

/**
 * Local-first (no-LLM) natural-language + structural query surface (Domain Core logic) — mirrors
 * old Docuvia's `QueryService`. Built entirely on `IGraphStore`'s repo interfaces.
 */
export class QueryService implements IQueryService {
  constructor(private readonly logger: ILogger = createNoopLogger()) {}

  extractKeywords(query: string): string[] {
    // A single-character token is dropped only when it's punctuation-split noise (an empty
    // string after trimming) or a genuine stop word ("a"/"i" — the only single-letter entries in
    // STOP_WORDS). A *meaningful* single-character token is kept: this codebase's own Tier
    // A/B/C vocabulary means "tier c queue" must keep "c" as a keyword, or it becomes
    // indistinguishable from "tier b queue" (roadmap-and-open-items.md item 25's self-test
    // harness caught this — dropping single-char tokens unconditionally was the one resolvable
    // case left failing after the FTS/ranking fixes).
    const tokens = query
      .split(/[^\w./-]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !STOP_WORDS.has(t.toLowerCase()));
    return Array.from(new Set(tokens));
  }

  getContext(store: IGraphStore, target: string): GraphContext | null {
    const node = store.graph.findNodeByName(target);
    if (!node) return null;

    const incoming = store.graph
      .getIncomingRelations(node.id)
      .filter((edge) => edge.linkType !== LinkTypes.CONTAINS)
      .map(({ name, linkType }) => ({ name, linkType }));
    const outgoing = store.graph
      .getOutgoingRelations(node.id)
      .filter((edge) => edge.linkType !== LinkTypes.CONTAINS)
      .map(({ name, linkType }) => ({ name, linkType }));

    const tierBCoverage = resolveTierBCoverageHint(
      store,
      node.filePath,
      incoming.length === 0,
      outgoing.length === 0,
    );

    return {
      incoming,
      outgoing,
      ...(tierBCoverage ? { tierBCoverage } : {}),
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
      const candidateLimit = resolveFtsCandidateLimit(limit);
      // Only worth the extra per-keyword FTS round-trips when there's more than one keyword to
      // tell apart — rerankByKeywordCoverage() no-ops on an empty set anyway (see its doc comment).
      const buildL2MembershipSets = (): Set<number>[] =>
        keywords.map(
          (kw) =>
            new Set(
              store.fts.searchL2Nodes([kw], candidateLimit).map((r) => r.id),
            ),
        );
      const buildL3MembershipSets = (): Set<number>[] =>
        keywords.map(
          (kw) =>
            new Set(
              store.fts.searchL3Nodes([kw], candidateLimit).map((r) => r.id),
            ),
        );

      const l2Rows = rerankByKeywordCoverage(
        store.fts.searchL2Nodes(keywords, candidateLimit),
        keywords.length > 1 ? buildL2MembershipSets() : [],
      );
      l2Rows.slice(0, limit).forEach((row, i) =>
        put({
          layer: QueryResultLayers.L2,
          id: row.id,
          title: row.name,
          content: row.description,
          score: 0.9 - i * 0.01,
          matchType: "keyword",
        }),
      );

      const l3Rows = rerankByKeywordCoverage(
        store.fts.searchL3Nodes(keywords, candidateLimit),
        keywords.length > 1 ? buildL3MembershipSets() : [],
      );
      l3Rows.slice(0, limit).forEach((row, i) =>
        put({
          layer: QueryResultLayers.L3,
          id: row.id,
          title: row.title,
          content: row.content,
          score: 0.85 - i * 0.01,
          matchType: "keyword",
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
          matchType: "exact",
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
            matchType: "neighbor",
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
            matchType: l2Result.matchType,
          }
        : null,
      l3: l3Results.map((r) => this.toL3Entry(store, r)),
      context,
    };
  }

  /**
   * Attaches write-path provenance (issue #68's provenance axis) to an L3 search hit by
   * re-reading its `l3_nodes` row. The search path itself only carries `{title, content}` —
   * without this step, `<l3_decision>` output can't tell an agent-authored self-report from
   * a git-imported fact, and stale/superseded decisions are indistinguishable from live ones.
   * Falls back to provenance-free `{title, content}` when the row has vanished mid-query
   * (concurrent prune) so a read never throws.
   */
  private toL3Entry(
    store: IGraphStore,
    result: LocalSearchResult,
  ): LocalQueryResultL3Entry {
    const row = store.l3.getById(result.id);
    if (!row) return { title: result.title, content: result.content };
    return {
      title: result.title,
      content: result.content,
      id: row.id,
      nodeType: row.node_type,
      source: row.source,
      confidence: row.confidence,
      commitHash: row.commit_hash,
      validityStatus: row.validity_status,
      createdAt: row.created_at,
    };
  }
}
