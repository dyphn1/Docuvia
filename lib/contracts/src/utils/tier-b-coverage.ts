import type { IGraphStore } from "../interfaces/graph-store.interfaces.js";
import type { TierBCoverageHint } from "../interfaces/query.interfaces.js";

/**
 * §5.3/§5.7 item 2's "not yet processed" hint. Returns `undefined` when there's nothing
 * ambiguous to report for either direction (see call sites for what counts as "empty" per
 * direction) -- callers must treat `undefined` as "omit the field entirely," not "empty object."
 *
 * Pure store-read helper reused by both `lib/core`'s `QueryService.getContext()` and
 * `lib/ui-core`'s `ImpactWorkflow` — lives in contracts (utils precedent: `process-lock.ts`)
 * so the Orchestration layer doesn't import `lib/core` directly (Virtual Contracts §8).
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
