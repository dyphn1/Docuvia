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
}
