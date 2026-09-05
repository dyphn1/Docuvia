export interface StatusResult {
  projects: number;
  l2Nodes: number;
  l3Nodes: number;
  tierBFilesProcessed: number;
  tierBFilesTotal: number;
  /** Issue #58: pending Tier C (LLM-inferred L3) candidates in `tierCQueue` -- surfaced so a
   *  permanently-empty queue (the whole "Tier C never backfills" defect) is visible rather than
   *  silent. */
  tierCQueued: number;
  /** Issue #193: HEAD-vs-last-ingested freshness for agent/hook quick checks (`status` is the
   *  cheap counterpart to doctor's `post_commit_ingestion` diagnostic). `unknown` whenever the
   *  comparison cannot be made (no git provider, unborn HEAD, missing meta) -- fail-open, never
   *  a status crash. */
  graphFreshness: GraphFreshness;
}

/** Freshness of the local graph relative to source HEAD (issue #193). */
export type GraphFreshness = "fresh" | "stale" | "unknown";
