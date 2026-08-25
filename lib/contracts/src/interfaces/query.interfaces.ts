import type { IGraphStore, ValidityStatus } from "./graph-store.interfaces.js";

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
  /** Additive, omit-when-confident "not yet Tier B-processed" signal -- see `TierBCoverageHint`'s
   *  own doc comment below. Attached by `QueryService.getContext()` only when it would actually
   *  change how a caller should read an empty `incoming`/`outgoing` list. */
  tierBCoverage?: TierBCoverageHint;
}

/**
 * Additive, omit-when-confident "not yet Tier B-processed" signal (typescript-cli-benchmark.md
 * §5.3/§5.7 item 2) — attached to a query/impact result only when an empty edge list might mean
 * "never looked at" rather than "confirmed zero". Shared by `query`'s `GraphContext` and
 * `impact`'s `ImpactResult`, both in `lib/core`/`lib/ui-core` — computed via
 * `resolveTierBCoverageHint()` (`lib/core`), never present-with-nulls: consumers must treat a
 * missing field as "nothing ambiguous to report," not as an empty object.
 */
export interface TierBCoverageHint {
  /** Governs how much to trust an empty `outgoing` list — this node's own file's last Tier B
   *  pass. `null` = never processed. */
  ownFileLastProcessedAt: string | null;
  /** Governs how much to trust an empty `incoming`/blast-radius list — workspace-wide, has every
   *  currently-tracked file been Tier B processed at least once? */
  workspaceFilesProcessed: number;
  workspaceFilesTotal: number;
}

/**
 * Computes the additive "not yet Tier B-processed" signal (`TierBCoverageHint`) for a
 * query/impact result. DI-registered behind a token (implemented by `lib/core`'s
 * `resolveTierBCoverageHint`) so the Orchestration layer resolves it from `docuviaFactory`
 * instead of importing `@workspace/core` directly — same pattern as `IImpactService`.
 */
export interface ITierBCoverageHintProvider {
  resolve(
    store: IGraphStore,
    ownFilePath: string | undefined,
    incomingEmpty: boolean,
    outgoingEmpty: boolean,
  ): TierBCoverageHint | undefined;
}

export const QueryResultLayers = {
  L2: "l2",
  L3: "l3",
} as const;
export type QueryResultLayer =
  (typeof QueryResultLayers)[keyof typeof QueryResultLayers];

/** How a `search()`/`query()` result was found -- `"exact"` came from an exact `findNodeByName`
 *  match, `"keyword"` from an FTS keyword hit, `"neighbor"` from a resolved node's own edge (not
 *  a direct hit on the query itself). Surfaced to callers so a non-exact match can be treated as
 *  lower-confidence rather than indistinguishable from an exact one. */
export type QueryMatchType = "exact" | "keyword" | "neighbor";

export interface LocalSearchResult {
  layer: QueryResultLayer;
  id: number;
  title: string;
  content: string | null;
  matchType: QueryMatchType;
}

/**
 * One L3 ("why") decision in a `LocalQueryResult`, with its write-path provenance attached
 * (issue #68, provenance axis). Every provenance field is optional so older callers/fixtures
 * that only carry `{title, content}` stay valid; `QueryService.query()` populates them from
 * the underlying `l3_nodes` row whenever it resolves one. Consumers (the prompt formatter,
 * MCP tools) must treat a missing field as "unknown" and omit the corresponding attribute
 * from rendered output, never fabricate a default.
 */
export interface LocalQueryResultL3Entry {
  title: string;
  content: string | null;
  /** `l3_nodes.id` — stable handle for follow-up writes/reads (e.g. future anchor work). */
  id?: number;
  nodeType?: string;
  /** Who authored the decision (`analyze` pipeline / `agent-authored` / `git-import`). */
  source?: string;
  confidence?: number | null;
  /** HEAD sha stamped when the decision was written; null on unborn/headless-HEAD writes. */
  commitHash?: string | null;
  validityStatus?: ValidityStatus;
  createdAt?: string;
}

export interface LocalQueryResult {
  l2: {
    name: string;
    type: string;
    filePath?: string;
    matchType: QueryMatchType;
  } | null;
  l3: LocalQueryResultL3Entry[];
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
