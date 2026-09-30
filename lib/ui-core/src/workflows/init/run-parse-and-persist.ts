import type {
  AstParseFailure,
  CallResolutionStats,
  DiscoveredFile,
  IAstProcessor,
  IGraphPersister,
  IGraphStore,
  ParsedAstFileResult,
} from "@workspace/contracts";
import {
  SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX,
  SnapshotCallSiteAvailabilityStates,
} from "@workspace/contracts";

/** Restores the call-site capability after a full pass that attempted every discoverable file
 *  (#516). Such a pass leaves `ast_call_sites` exactly as a fresh `init` would: files that are
 *  oversized or fail to parse have no call sites there either (#522 / #544 retire them), and those
 *  per-file gaps are reported through coverage, not this marker. The marker only tracks call sites
 *  lost to a snapshot that did not carry them, so ingestion never downgrades it -- a pass that did
 *  not attempt every candidate leaves it unchanged. */
export function markCallSitesAvailableAfterCompleteIngestion(input: {
  store: IGraphStore;
  projectId: number;
  candidateFileCount: number | undefined;
  parsedFileCount: number;
  failedFileCount: number;
  skippedOversizedCount: number;
}): void {
  const {
    store,
    projectId,
    candidateFileCount,
    parsedFileCount,
    failedFileCount,
    skippedOversizedCount,
  } = input;
  const attemptedEveryCandidate =
    candidateFileCount !== undefined &&
    parsedFileCount + failedFileCount + skippedOversizedCount ===
      candidateFileCount;
  if (!attemptedEveryCandidate) return;

  store.meta.set(
    `${SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX}${projectId}`,
    SnapshotCallSiteAvailabilityStates.AVAILABLE,
  );
}

export interface RunParseAndPersistResult {
  parsedResults: ParsedAstFileResult[];
  failures: AstParseFailure[];
  tags: Set<string>;
  /** Issue #221: per-file Tier A call-site resolution counters from this run's persist, absent
   *  when no parsed file had extractable call sites. */
  callResolutionByFile?: Record<string, CallResolutionStats>;
}

/** Event names for the two per-file JSONL lines this phase emits, supplied by the caller so the
 *  line lands in the calling workflow's own log file (`init.log` for `init`, `analyze.log` for
 *  `analyze`'s full/delta ingestion) under that workflow's own event-naming scheme. */
export interface RunParseAndPersistLogEvents {
  parseFailure: string;
  fileSkippedOversized: string;
}

/** Phase 4: AST parse, per-file language-tag merge, then hands off to `IGraphPersister` (the Domain Core service resolved from the factory) for graph persistence. */
export async function runParseAndPersist(deps: {
  astProcessor: IAstProcessor;
  graphPersister: IGraphPersister;
  store: IGraphStore;
  workspaceRoot: string;
  projectId: number;
  filesToParse: DiscoveredFile[];
  skippedOversized: { file: string; sizeBytes: number }[];
  /** Config + hotspot tags from `runDiscoveryPipeline`; a fresh `Set` is returned with per-file language tags folded in — the input is never mutated. */
  tags: Set<string>;
  /** Caller's own command-log writer (`appendInitLogLine`/`appendAnalyzeLogLine`) — keeps this
   *  shared phase helper's JSONL output attributed to whichever workflow actually invoked it. */
  appendLogLine: (
    workspaceRoot: string,
    event: Record<string, unknown>,
  ) => Promise<void>;
  logEvents: RunParseAndPersistLogEvents;
}): Promise<RunParseAndPersistResult> {
  const {
    astProcessor,
    graphPersister,
    store,
    workspaceRoot,
    projectId,
    filesToParse,
    skippedOversized,
    appendLogLine,
    logEvents,
  } = deps;

  const { parsed: parsedResults, failures } = await astProcessor.processFiles(
    workspaceRoot,
    filesToParse,
  );

  const tags = new Set(deps.tags);
  for (const result of parsedResults) {
    if (result.language) tags.add(result.language);
  }

  for (const failure of failures) {
    await appendLogLine(workspaceRoot, {
      event: logEvents.parseFailure,
      ...failure,
    });
  }
  for (const skipped of skippedOversized) {
    await appendLogLine(workspaceRoot, {
      event: logEvents.fileSkippedOversized,
      ...skipped,
    });
  }

  const persistResult = await graphPersister.persist({
    store,
    workspaceRoot,
    projectId,
    parsedResults,
    tags: Array.from(tags),
  });

  return {
    parsedResults,
    failures,
    tags,
    callResolutionByFile: persistResult.callResolutionByFile,
  };
}
