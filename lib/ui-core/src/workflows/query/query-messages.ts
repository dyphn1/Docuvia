/** Progress/result messages for the `query` workflow. */
export const QUERY_MESSAGES = {
  QUERYING: "Querying local knowledge graph...",
  DB_NOT_FOUND: 'Local database not found. Please run "docuvia init".',
} as const;

/** Structured-log event names appended to `query.log` by the `query` workflow. */
export const QUERY_EVENTS = {
  START: "query.start",
  ERROR: "query.error",
  SUMMARY: "query.summary",
} as const;
