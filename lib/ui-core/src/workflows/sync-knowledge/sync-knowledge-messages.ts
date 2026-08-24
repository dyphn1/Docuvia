/** Progress/result messages for the `sync-knowledge` workflow. */
export const SYNC_KNOWLEDGE_MESSAGES = {
  SYNCING: "Reconciling the knowledge branch with the remote...",
  /** Issue #68's blame-based validity pass, run after reconciliation while HEAD is fresh. */
  VALIDITY_PASS_BASELINE:
    "L3 validity pass: first run -- stamped baseline cursor, judged nothing",
  VALIDITY_PASS_SUMMARY: (activated: number, superseded: number) =>
    `L3 validity pass: ${activated} decision(s) confirmed alive, ${superseded} demoted as dead/superseded`,
  VALIDITY_PASS_FAILED: (message: string) =>
    `L3 validity pass failed (retries on the next sync): ${message}`,
} as const;

/** Structured-log event names appended to `sync-knowledge.log` by the `sync-knowledge` workflow. */
export const SYNC_KNOWLEDGE_EVENTS = {
  START: "sync-knowledge.start",
  SUMMARY: "sync-knowledge.summary",
  VALIDITY_PASS: "sync-knowledge.l3-validity-pass",
} as const;
