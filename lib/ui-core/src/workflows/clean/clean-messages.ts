/** Progress/result messages for the `clean` workflow — emitted as `logger.info()` events, mirroring `init-messages.ts`. */
export const CLEAN_MESSAGES = {
  CLEANING: (dbPath: string) => `Cleaning ${dbPath}...`,
  DELETED: "Cleaned .docuvia/local.db database.",
  NOT_FOUND: "No local database found to clean.",
  DELETE_FAILED: (dbPath: string) => `Failed to delete database at ${dbPath}`,
  DELETED_AT: (dbPath: string) => `Deleted local database at ${dbPath}`,
} as const;

/** Structured-log event names appended to `clean.log` by the `clean` workflow. */
export const CLEAN_EVENTS = {
  START: "clean.start",
  SUMMARY: "clean.summary",
} as const;
