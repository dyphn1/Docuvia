/** Progress/result messages for the `status` workflow. */
export const STATUS_MESSAGES = {
  GETTING_STATUS: "Getting status...",
  DB_NOT_FOUND: 'Local database not found. Please run "docuvia init".',
} as const;

/** Structured-log event names appended to `status.log` by the `status` workflow. */
export const STATUS_EVENTS = {
  START: "status.start",
  ERROR: "status.error",
  SUMMARY: "status.summary",
} as const;
