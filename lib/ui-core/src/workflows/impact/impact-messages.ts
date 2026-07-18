/** Progress/result messages for the `impact` workflow. */
export const IMPACT_MESSAGES = {
  RESOLVING: "Resolving blast radius...",
  DB_NOT_FOUND: 'Local database not found. Please run "docuvia init".',
} as const;

/** Structured-log event names appended to `impact.log` by the `impact` workflow. */
export const IMPACT_EVENTS = {
  START: "impact.start",
  ERROR: "impact.error",
  SUMMARY: "impact.summary",
} as const;
