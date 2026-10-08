import {
  BlastRadiusEdgeSources,
  type BlastRadiusEntry,
} from "@workspace/contracts";

/**
 * Candidate rows are display-only context. They neither assert a dependency nor independently
 * change the impact workflow's epistemic verdict. LSP call-site fallback remains included under
 * the existing impact policy.
 */
export function isConfirmedImpactDependency(
  entry: Pick<BlastRadiusEntry, "edgeSource">,
): boolean {
  return (
    entry.edgeSource !== BlastRadiusEdgeSources.DYNAMIC_CANDIDATE &&
    entry.edgeSource !== BlastRadiusEdgeSources.CALLER_CANDIDATE
  );
}

export function filterConfirmedImpactDependencies(
  entries: readonly BlastRadiusEntry[],
): BlastRadiusEntry[] {
  return entries.filter(isConfirmedImpactDependency);
}
