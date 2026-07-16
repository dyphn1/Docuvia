/** Progress/result messages for the `snapshot` workflow. */
export const SNAPSHOT_MESSAGES = {
  SNAPSHOTTING: "Packing knowledge graph snapshot...",
  DB_NOT_FOUND: 'Local database not found. Please run "docuvia init".',
} as const;

/** Structured-log event names appended to `snapshot.log` by the `snapshot` workflow. */
export const SNAPSHOT_EVENTS = {
  START: "snapshot.start",
  ERROR: "snapshot.error",
  SUMMARY: "snapshot.summary",
} as const;

/** Prefix for the scratch directory `fs.mkdtemp()` creates under `os.tmpdir()` while rendering a snapshot. */
export const SNAPSHOT_TEMP_DIR_PREFIX = "docuvia-snapshot-";
