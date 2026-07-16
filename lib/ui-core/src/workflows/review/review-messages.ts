/** Progress/result messages for the `review` workflow. */
export const REVIEW_MESSAGES = {
  DETECTING_CHANGES: "Detecting changes...",
  DB_NOT_FOUND: 'Local database not found. Please run "docuvia init".',
} as const;

/** Structured-log event names appended to `review.log` by the `review` workflow. */
export const REVIEW_EVENTS = {
  START: "review.start",
  ERROR: "review.error",
  SUMMARY: "review.summary",
} as const;
