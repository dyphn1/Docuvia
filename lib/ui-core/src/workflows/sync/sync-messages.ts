/** Progress/result messages for the `sync` workflow. */
export const SYNC_MESSAGES = {
  STARTING: (projectId: string) => `Starting sync for project ${projectId}...`,
  DB_NOT_FOUND: 'Local database not found. Please run "docuvia init".',
  NOTHING_TO_SYNC: "Nothing to sync: no changed files detected.",
  NOTHING_NEW: (skippedL2Count: number) =>
    `Nothing new to sync (${skippedL2Count} module(s) skipped, no remote match).`,
  SYNCED: (synced: number, skippedL2Count: number) =>
    `Synced ${synced} decision(s), ${skippedL2Count} module(s) skipped.`,
} as const;
