/** Progress/result messages for the `sync-knowledge` workflow. */
export const SYNC_KNOWLEDGE_MESSAGES = {
  SYNCING: "Reconciling the knowledge branch with the remote...",
} as const;

/** Structured-log event names appended to `sync-knowledge.log` by the `sync-knowledge` workflow. */
export const SYNC_KNOWLEDGE_EVENTS = {
  START: "sync-knowledge.start",
  SUMMARY: "sync-knowledge.summary",
} as const;
