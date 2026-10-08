import type {
  AstParseFailure,
  AstProcessResult,
  CallResolutionStats,
  DiscoveredFile,
  IAstProcessor,
  IGraphPersister,
  IGraphStore,
  ParsedAstFileResult,
} from "@workspace/contracts";
import {
  SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX,
  SNAPSHOT_CALL_RESOLUTIONS_AVAILABILITY_META_KEY_PREFIX,
  SnapshotCallSiteAvailabilityStates,
  SnapshotCallResolutionAvailabilityStates,
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
  store.meta.set(
    `${SNAPSHOT_CALL_RESOLUTIONS_AVAILABILITY_META_KEY_PREFIX}${projectId}`,
    SnapshotCallResolutionAvailabilityStates.AVAILABLE,
  );
}

export interface RunParseAndPersistResult {
  parsedResults: ParsedAstFileResult[];
  failures: AstParseFailure[];
  tags: Set<string>;
  /** Issue #221: per-file Tier A call-site resolution counters from this run's persist, absent
   *  when no parsed file had extractable call sites. */
  callResolutionByFile?: Record<string, CallResolutionStats>;
  /** The persisted proof index is complete for this source revision. */
  sourceIndexComplete: boolean;
  strictCallProofIndexFallbackReason?: string;
}

/** Event names for the two per-file JSONL lines this phase emits, supplied by the caller so the
 *  line lands in the calling workflow's own log file (`init.log` for `init`, `analyze.log` for
 *  `analyze`'s full/delta ingestion) under that workflow's own event-naming scheme. */
export interface RunParseAndPersistLogEvents {
  parseFailure: string;
  fileSkippedOversized: string;
}

function canProvideCompleteSourceIndex(input: {
  parsedResults: ParsedAstFileResult[];
  failures: AstParseFailure[];
  skippedOversized: { file: string; sizeBytes: number }[];
  filesToParse: DiscoveredFile[];
  candidateFileCount?: number;
  sourceIndexUpdateMode?: "replace" | "merge";
  sourceIndexBaseComplete?: boolean;
  /** Complete tracked source inventory for delta merges; full passes derive it from discovery. */
  sourceIndexExpectedFilePaths?: readonly string[];
}): boolean {
  const parsedEveryInput =
    input.failures.length === 0 &&
    input.skippedOversized.length === 0 &&
    input.parsedResults.length === input.filesToParse.length;
  if (input.sourceIndexUpdateMode === "merge")
    return input.sourceIndexBaseComplete === true && parsedEveryInput;
  return (
    input.candidateFileCount !== undefined &&
    parsedEveryInput &&
    input.parsedResults.length === input.candidateFileCount
  );
}

function sourceIndexResultFields(
  persistResult: Awaited<ReturnType<IGraphPersister["persist"]>>,
  requestedComplete: boolean,
): Pick<
  RunParseAndPersistResult,
  "sourceIndexComplete" | "strictCallProofIndexFallbackReason"
> {
  const sourceIndexComplete =
    persistResult.strictCallProofIndex?.complete ?? requestedComplete;
  return {
    sourceIndexComplete,
    ...(persistResult.strictCallProofIndex?.fallbackReason
      ? {
          strictCallProofIndexFallbackReason:
            persistResult.strictCallProofIndex.fallbackReason,
        }
      : {}),
  };
}

async function processFilesNotPreParsed(
  astProcessor: IAstProcessor,
  workspaceRoot: string,
  filesToParse: DiscoveredFile[],
  preParsed: AstProcessResult | undefined,
): Promise<AstProcessResult> {
  const preParsedPaths = new Set([
    ...(preParsed?.parsed.map(({ file }) => file) ?? []),
    ...(preParsed?.failures.map(({ file }) => file) ?? []),
  ]);
  const filesNotPreParsed = filesToParse.filter(
    ({ file }) => !preParsedPaths.has(file),
  );
  return filesNotPreParsed.length > 0
    ? astProcessor.processFiles(workspaceRoot, filesNotPreParsed)
    : { parsed: [], failures: [] };
}

function collectParseResults(
  filesToParse: DiscoveredFile[],
  preParsed: AstProcessResult | undefined,
  remaining: AstProcessResult,
): Pick<RunParseAndPersistResult, "parsedResults" | "failures"> {
  const parsedByFile = new Map(
    [...(preParsed?.parsed ?? []), ...remaining.parsed].map((result) => [
      result.file,
      result,
    ]),
  );
  const parsedResults = filesToParse.flatMap((file) => {
    const parsed = parsedByFile.get(file.file);
    return parsed ? [parsed] : [];
  });
  return {
    parsedResults,
    failures: [...(preParsed?.failures ?? []), ...remaining.failures],
  };
}

function mergeParsedLanguages(
  inputTags: Set<string>,
  parsedResults: ParsedAstFileResult[],
): Set<string> {
  const tags = new Set(inputTags);
  for (const result of parsedResults) {
    if (result.language) tags.add(result.language);
  }
  return tags;
}

async function logParseDiagnostics(input: {
  workspaceRoot: string;
  appendLogLine: (
    workspaceRoot: string,
    event: Record<string, unknown>,
  ) => Promise<void>;
  logEvents: RunParseAndPersistLogEvents;
  failures: AstParseFailure[];
  skippedOversized: { file: string; sizeBytes: number }[];
}): Promise<void> {
  const {
    workspaceRoot,
    appendLogLine,
    logEvents,
    failures,
    skippedOversized,
  } = input;
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
}

/** Phase 4: AST parse, per-file language-tag merge, then hands off to `IGraphPersister` (the Domain Core service resolved from the factory) for graph persistence. */
export async function runParseAndPersist(deps: {
  astProcessor: IAstProcessor;
  graphPersister: IGraphPersister;
  store: IGraphStore;
  workspaceRoot: string;
  projectId: number;
  filesToParse: DiscoveredFile[];
  /** Parse results already produced by delta candidate-domain comparison. */
  preParsed?: AstProcessResult;
  /** Full-discovery candidate count; omitted by delta ingestion, which can never claim a complete index. */
  candidateFileCount?: number;
  /** Full ingestion replaces all facts; a delta merges into a validated complete baseline. */
  sourceIndexUpdateMode?: "replace" | "merge";
  sourceIndexBaseComplete?: boolean;
  /** Complete tracked source inventory for delta merges; full passes derive it from discovery. */
  sourceIndexExpectedFilePaths?: readonly string[];
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
    preParsed,
    candidateFileCount,
    sourceIndexUpdateMode,
    sourceIndexBaseComplete,
    sourceIndexExpectedFilePaths,
    skippedOversized,
    appendLogLine,
    logEvents,
  } = deps;

  const remaining = await processFilesNotPreParsed(
    astProcessor,
    workspaceRoot,
    filesToParse,
    preParsed,
  );
  const { parsedResults, failures } = collectParseResults(
    filesToParse,
    preParsed,
    remaining,
  );
  const tags = mergeParsedLanguages(deps.tags, parsedResults);
  await logParseDiagnostics({
    workspaceRoot,
    appendLogLine,
    logEvents,
    failures,
    skippedOversized,
  });

  const sourceIndexComplete = canProvideCompleteSourceIndex({
    parsedResults,
    failures,
    skippedOversized,
    filesToParse,
    candidateFileCount,
    sourceIndexUpdateMode,
    sourceIndexBaseComplete,
  });
  const expectedSourceFilePaths =
    sourceIndexExpectedFilePaths ??
    (sourceIndexUpdateMode === "merge"
      ? undefined
      : filesToParse.map(({ file }) => file));

  const persistResult = await graphPersister.persist({
    store,
    workspaceRoot,
    projectId,
    parsedResults,
    tags: Array.from(tags),
    sourceIndexComplete,
    ...(expectedSourceFilePaths
      ? { sourceIndexExpectedFilePaths: expectedSourceFilePaths }
      : {}),
    ...(sourceIndexUpdateMode ? { sourceIndexUpdateMode } : {}),
  });
  const sourceIndexFields = sourceIndexResultFields(
    persistResult,
    sourceIndexComplete,
  );

  return {
    parsedResults,
    failures,
    tags,
    callResolutionByFile: persistResult.callResolutionByFile,
    ...sourceIndexFields,
  };
}
