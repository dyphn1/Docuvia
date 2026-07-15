/** Progress/result messages for the `export-topology` workflow. */
export const EXPORT_TOPOLOGY_MESSAGES = {
  EXPORTING: "Exporting topology...",
  DB_NOT_FOUND: 'Local database not found. Please run "docuvia init".',
} as const;

/** Structured-log event names appended to `export-topology.log` by the `export-topology` workflow. */
export const EXPORT_TOPOLOGY_EVENTS = {
  START: "export-topology.start",
  ERROR: "export-topology.error",
  SUMMARY: "export-topology.summary",
} as const;
