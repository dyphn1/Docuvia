import type { IGraphStore, TierBCoverageHint } from "@workspace/contracts";

/**
 * §5.3/§5.7 item 2's "not yet processed" hint. Returns `undefined` when there's nothing
 * ambiguous to report for either direction (see call sites for what counts as "empty" per
 * direction) -- callers must treat `undefined` as "omit the field entirely," not "empty object."
 */
export function resolveTierBCoverageHint(
  store: IGraphStore,
  ownFilePath: string | undefined,
  incomingEmpty: boolean,
  outgoingEmpty: boolean,
): TierBCoverageHint | undefined {
  if (!incomingEmpty && !outgoingEmpty) return undefined;

  const ownFileStatus = ownFilePath
    ? store.files.getTierBFileStatus(ownFilePath)
    : undefined;
  const ownFileLastProcessedAt = ownFileStatus?.lastProcessedAt ?? null;
  const needsOutgoingHint = outgoingEmpty && ownFileLastProcessedAt === null;

  const coverage = store.files.getTierBCoverage();
  const needsIncomingHint =
    incomingEmpty && coverage.processedFiles < coverage.totalFiles;

  if (!needsOutgoingHint && !needsIncomingHint) return undefined;

  return {
    ownFileLastProcessedAt,
    workspaceFilesProcessed: coverage.processedFiles,
    workspaceFilesTotal: coverage.totalFiles,
  };
}
