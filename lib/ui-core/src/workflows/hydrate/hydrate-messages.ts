/** Progress/result messages for the `hydrate` workflow. */
export const HYDRATE_MESSAGES = {
  HYDRATING: "Hydrating local database from the knowledge branch...",
  NOTHING_TO_HYDRATE: 'Nothing to hydrate from yet. Please run "docuvia init".',
} as const;

/** Structured-log event names appended to `hydrate.log` by the `hydrate` workflow. */
export const HYDRATE_EVENTS = {
  START: "hydrate.start",
  SUMMARY: "hydrate.summary",
} as const;
