import {
  CallSiteResolutionClasses,
  CallSiteVerificationStatuses,
  SNAPSHOT_CALL_RESOLUTIONS_AVAILABILITY_META_KEY_PREFIX,
  SnapshotCallResolutionAvailabilityStates,
  type CallResolutionSummary,
  type IGraphStore,
  type SnapshotCallResolutionRow,
} from "@workspace/contracts";

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isTrustedResolution(row: SnapshotCallResolutionRow): boolean {
  if (row.isStale) return false;
  if (row.verificationStatus === CallSiteVerificationStatuses.CONTRADICTED) {
    return false;
  }
  if (row.resolutionClass === CallSiteResolutionClasses.PROVEN) return true;
  return (
    row.verificationStatus === CallSiteVerificationStatuses.VERIFIED &&
    row.selectedTargetNodeKey !== null &&
    row.verifiedTargetNodeKey === row.selectedTargetNodeKey
  );
}

export function isTrustedCallResolution(
  summary: CallResolutionSummary,
): boolean {
  return summary.evidenceLabel !== undefined;
}

function getConfidence(row: SnapshotCallResolutionRow): number | undefined {
  if (
    row.isStale ||
    row.resolutionClass !== CallSiteResolutionClasses.LIKELY ||
    row.confidence === null
  ) {
    return undefined;
  }
  return row.confidence;
}

function getEvidenceLabel(
  row: SnapshotCallResolutionRow,
): CallResolutionSummary["evidenceLabel"] {
  if (!isTrustedResolution(row)) return undefined;
  return row.verificationStatus === CallSiteVerificationStatuses.VERIFIED
    ? "tier-b-verified"
    : "static-proof";
}

function getAlternatives(row: SnapshotCallResolutionRow): string[] {
  if (row.isStale || row.resolutionClass !== CallSiteResolutionClasses.LIKELY) {
    return [];
  }
  return [...row.candidates]
    .sort((left, right) => left.ordinal - right.ordinal)
    .filter(({ targetNodeKey }) => targetNodeKey !== row.selectedTargetNodeKey)
    .slice(0, 2)
    .map(({ targetNodeKey }) => targetNodeKey);
}

function getAmbiguousCandidates(row: SnapshotCallResolutionRow): string[] {
  if (
    row.isStale ||
    row.resolutionClass !== CallSiteResolutionClasses.AMBIGUOUS
  ) {
    return [];
  }
  return [...row.candidates]
    .sort((left, right) => left.ordinal - right.ordinal)
    .slice(0, 3)
    .map(({ targetNodeKey }) => targetNodeKey);
}

export function toCallResolutionSummary(
  row: SnapshotCallResolutionRow,
  explainResolution: boolean,
): CallResolutionSummary {
  const confidence = getConfidence(row);
  const evidenceLabel = getEvidenceLabel(row);
  const summary: CallResolutionSummary = {
    callSiteKey: row.callSiteKey,
    resolutionClass: row.isStale ? "unknown" : row.resolutionClass,
    verificationStatus: row.isStale ? "unknown" : row.verificationStatus,
    selectedTargetNodeKey: row.isStale ? null : row.selectedTargetNodeKey,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(evidenceLabel ? { evidenceLabel } : {}),
    isStale: row.isStale,
    alternatives: getAlternatives(row),
    candidates: getAmbiguousCandidates(row),
  };
  if (explainResolution) {
    summary.evidence = row;
  }
  return summary;
}

export function getCurrentCallResolutionRows(
  store: IGraphStore,
): SnapshotCallResolutionRow[] {
  const project = store.projects.getFirst();
  const getAllForProject = store.callSiteResolutions?.getAllForProject;
  if (!project || typeof getAllForProject !== "function") return [];
  const availability = store.meta.get(
    `${SNAPSHOT_CALL_RESOLUTIONS_AVAILABILITY_META_KEY_PREFIX}${project.id}`,
  );
  if (availability === SnapshotCallResolutionAvailabilityStates.UNAVAILABLE) {
    return [];
  }
  return getAllForProject.call(store.callSiteResolutions, project.id);
}

/** Resolves certainty only from exact per-site rows. A graph `calls` edge without one is unknown. */
export function getCallResolutionSummariesForEdge(
  store: IGraphStore,
  callerNodeKey: string | undefined,
  targetNodeKey: string | undefined,
  explainResolution = false,
  availableRows?: SnapshotCallResolutionRow[],
): CallResolutionSummary[] {
  if (!callerNodeKey || !targetNodeKey) return [unknownCallResolution()];
  const rows = (availableRows ?? getCurrentCallResolutionRows(store))
    .filter(
      (row) =>
        row.projectionCallerNodeKey === callerNodeKey &&
        row.selectedTargetNodeKey === targetNodeKey,
    )
    .sort((left, right) => compareText(left.callSiteKey, right.callSiteKey));
  return rows.length > 0
    ? rows.map((row) => toCallResolutionSummary(row, explainResolution))
    : [unknownCallResolution()];
}

export function unknownCallResolution(): CallResolutionSummary {
  return {
    callSiteKey: null,
    resolutionClass: "unknown",
    verificationStatus: "unknown",
    selectedTargetNodeKey: null,
    isStale: false,
    alternatives: [],
    candidates: [],
  };
}
