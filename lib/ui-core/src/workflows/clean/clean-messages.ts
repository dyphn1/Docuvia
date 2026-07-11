/** Progress/result messages for the `clean` workflow — emitted as `logger.info()` events, mirroring `init-messages.ts`. */
export const CLEAN_MESSAGES = {
  CLEANING: (dbPath: string) => `Cleaning ${dbPath}...`,
  DELETED: "Cleaned .docuvia/local.db database.",
  NOT_FOUND: "No local database found to clean.",
} as const;
