export const KNOWLEDGE_SNAPSHOT_FORMAT_VERSION = 1;
export const SNAPSHOT_DYNAMIC_EVIDENCE_VERSION = 1;
export const SNAPSHOT_CALL_SITES_VERSION = 1;
export const SNAPSHOT_CALL_SITES_JSONL_FILE_NAME = "call-sites.jsonl";

/** Existing dynamic-evidence rows stay project-scoped in docuvia_meta. */
export const DYNAMIC_DEPENDENCY_EVIDENCE_META_KEY_PREFIX =
  "impact.dynamic-dependencies.v1:";

/** Hydration records call-site capability per project so unrelated projects cannot share status. */
export const SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX =
  "snapshot.call-sites.availability.v1:";

export const SnapshotCallSiteAvailabilityStates = {
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
} as const;

export const SNAPSHOT_CALL_SITE_UNAVAILABLE_REASON =
  "snapshot-call-sites-unavailable";
