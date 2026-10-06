import crypto from "node:crypto";
import {
  docuviaFactory,
  TOKENS,
  ChangedFileStatuses,
  UTF8_ENCODING,
  type AstParseFailure,
  type CallResolutionStats,
  type CallSiteResolutionInvalidationResult,
  type CallSiteResolutionDependency,
  type ChangedFileEntry,
  type DiscoveredFile,
  type IGitProvider,
  type IGraphStore,
  type IKnowledgeGitService,
  type ILogger,
  type ISemanticDiffAnalyzer,
  type SemanticDiffModifiedNode,
  type TierCQueueEntry,
  isDiscoverableSourceFile,
  isDocuviaGeneratedPath,
} from "@workspace/contracts";
import {
  aggregateCallResolution,
  GitConstants,
  MAX_FILE_SIZE_BYTES,
  HASH_ALGO_SHA256,
  ENCODING_HEX,
} from "@workspace/contracts";
import { runParseAndPersist } from "../init/run-parse-and-persist.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { mergeDeltaCallResolution } from "./call-resolution-stats.js";
import { ANALYZE_EVENTS, ANALYZE_MESSAGES } from "./analyze-messages.js";
import { isNodeKeyFormatStale } from "./node-key-format-guard.js";
import { retirePath } from "./path-retirement.js";
import { runFullIngestion } from "./run-full-ingestion.js";
import {
  appendTierBQueueEntries,
  removeTierBQueueEntriesForFiles,
  type TierBQueueEntry,
} from "./tier-b-queue.js";
import {
  appendTierCQueueEntries,
  removeTierCQueueEntriesForFiles,
} from "./tier-c-queue.js";
import {
  collectCommitMessageCandidates,
  collectContractSymbolCandidates,
} from "./tier-c-candidates.js";
import { AnalyzeResultKind, type AutoModeResult } from "./analyze-result.js";

/**
 * `analyze` auto mode's delta-ingestion branch (§6b) — the graph already has data and `HEAD` has
 * moved since `fromSha` (the last-ingested source sha, resolved by the caller per §6a's
 * fast-path/fallback order). Diffs `fromSha -> headSha`, re-parses added/modified/renamed source
 * files through the same `AstProcessingService` + `GraphPersister` `init`/full-ingestion use (via
 * the shared `runParseAndPersist` phase helper — its own `deleteNodesForPath()` call per parsed
 * file gives per-file replace "for free"), drops deleted files' L2 rows, and classifies each
 * *modified* file with `ISemanticDiffAnalyzer` solely to enqueue `CONTRACT_CHANGED` files into
 * the Tier B queue. Changed files are re-parsed regardless of what the detector finds.
 */
export async function runDeltaIngestion(deps: {
  workspaceRoot: string;
  logger: ILogger;
  store: IGraphStore;
  git: IGitProvider;
  knowledgeGit: IKnowledgeGitService;
  projectId: number;
  fromSha: string;
  headSha: string;
}): Promise<AutoModeResult> {
  const {
    workspaceRoot,
    logger,
    store,
    git,
    knowledgeGit,
    projectId,
    fromSha,
    headSha,
  } = deps;

  // GRPH-006's migration guard: a stale/missing `node_key` format stamp means the graph predates
  // qualified/structural keys -- an incremental re-parse of only the changed files below would
  // leave untouched files' old-flat-format keys mixed with the just-reparsed files' new-qualified
  // ones in the same graph, which `findNodeIdByNodeKey` cross-file resolution can't tell apart.
  // Force a full re-ingestion instead, exactly once, until the stamp is current again.
  if (isNodeKeyFormatStale(store)) {
    logger.info(ANALYZE_MESSAGES.NODE_KEY_FORMAT_STALE);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.DELTA_NODE_KEY_FORMAT_STALE,
    });
    return runFullIngestion({ workspaceRoot, logger, store, git });
  }

  // §6.3's backward-HEAD guard: `getChangedFilesSince(fromSha, headSha)` and readFileAtRef(headSha,
  // ...)` below both assume headSha descends from fromSha. When something moves HEAD backward while
  // the working tree/index stays at the newer state (git reset --soft, an undone amend, an aborted
  // mid-rebase), that assumption is false: the diff runs backward (real additions read as deletions)
  // and re-parsed content comes from stale git-blob history instead of what's actually on disk.
  // Bail to a full re-ingestion, which re-discovers everything from the real working tree instead of
  // trusting commit-graph position.
  if (!(await git.isAncestor(workspaceRoot, fromSha, headSha))) {
    logger.info(ANALYZE_MESSAGES.HEAD_NOT_DESCENDANT_OF_LAST_INGESTED);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.DELTA_HEAD_NOT_DESCENDANT,
      fromSha,
      headSha,
    });
    return runFullIngestion({ workspaceRoot, logger, store, git });
  }

  logger.info(ANALYZE_MESSAGES.AUTO_DELTA_INGESTION);
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.DELTA_START,
    fromSha,
    headSha,
  });

  const changedEntries = await git.getChangedFilesSince(
    workspaceRoot,
    fromSha,
    headSha,
  );
  const { toDelete, toReparse } = partitionChangedEntries(changedEntries);
  const changedDependencySnapshot = await collectChangedDependencyHashes(
    deps,
    changedEntries,
  );
  const invalidation: CallSiteResolutionInvalidationResult | undefined =
    await store.withWriteLock(() =>
      changedDependencySnapshot.dependencies.length > 0
        ? store.callSiteResolutions?.invalidateChangedDependencies(
            projectId,
            changedDependencySnapshot.dependencies,
          )
        : undefined,
    );
  const {
    filesToParse,
    skippedOversized,
    tierBEntries,
    tierCSymbolEntries,
    changedBytes,
  } = await collectFilesToParse(
    deps,
    toReparse,
    changedDependencySnapshot.contentByPath,
  );
  const pathsToRetire = new Set(toDelete);
  for (const { file } of skippedOversized) pathsToRetire.add(file);
  // Tier C's commit-message candidate source (phase1-decision-integration.md §9b/§9e) — collected
  // once per delta run (not per file), independent of which files changed.
  const tierCCommitEntries = await collectCommitMessageCandidates(
    git,
    workspaceRoot,
    fromSha,
    headSha,
  );
  const tierCEntries: TierCQueueEntry[] = [
    ...tierCCommitEntries,
    ...tierCSymbolEntries,
  ];

  // §6b's locking requirement: the delta persist step (deletes + re-parse/persist + Tier B/C queue
  // + last-ingested-sha meta write) runs under the knowledge-branch lock, the same discipline
  // `snapshot`'s git-write step uses — so a concurrent `snapshot` can't read a half-updated
  // local.db mid-delta.
  let failures: AstParseFailure[] = [];
  let filesParsed = 0;
  await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, async () => {
    const persisted = await persistDelta(deps, {
      pathsToRetire,
      filesToParse,
      affectedCallerFilePaths: invalidation?.affectedFilePaths ?? [],
      tierBEntries,
      tierCEntries,
      changedBytes,
    });
    failures = persisted.failures;
    filesParsed = persisted.filesParsed;
  });

  const filesReparsed = filesParsed - failures.length;

  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.DELTA_SUMMARY,
    fromSha,
    headSha,
    filesReparsed,
    filesDeleted: toDelete.size,
    filesFailed: failures.length,
    filesSkippedOversized: skippedOversized.length,
    tierBQueued: tierBEntries.length,
    tierCQueued: tierCEntries.length,
  });

  return {
    kind: AnalyzeResultKind.AUTO_DELTA,
    fromSha,
    headSha,
    filesReparsed,
    filesDeleted: toDelete.size,
    filesFailed: failures.length,
    filesSkippedOversized: skippedOversized.length,
    tierBQueued: tierBEntries.length,
    tierCQueued: tierCEntries.length,
  };
}

type DeltaDeps = Parameters<typeof runDeltaIngestion>[0];

async function collectChangedDependencyHashes(
  deps: DeltaDeps,
  changedEntries: ChangedFileEntry[],
): Promise<{
  dependencies: CallSiteResolutionDependency[];
  contentByPath: Map<string, string>;
}> {
  const contentHashByPath = new Map<string, string | null>();
  const contentByPath = new Map<string, string>();

  for (const entry of changedEntries) {
    if (isDocuviaGeneratedPath(entry.file)) continue;
    if (entry.status === ChangedFileStatuses.DELETED) {
      contentHashByPath.set(entry.file, null);
      continue;
    }
    if (entry.status === ChangedFileStatuses.RENAMED && entry.oldFile) {
      if (!isDocuviaGeneratedPath(entry.oldFile)) {
        contentHashByPath.set(entry.oldFile, null);
      }
    }

    const content = await deps.git.readFileAtRef(
      deps.workspaceRoot,
      deps.headSha,
      entry.file,
    );
    if (content !== undefined) contentByPath.set(entry.file, content);
    contentHashByPath.set(
      entry.file,
      content === undefined ? null : hashContent(content),
    );
  }

  return {
    dependencies: [...contentHashByPath]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, contentHash]) => ({ filePath, contentHash })),
    contentByPath,
  };
}

function hashContent(content: string): string {
  return crypto
    .createHash(HASH_ALGO_SHA256)
    .update(content, UTF8_ENCODING)
    .digest(ENCODING_HEX);
}

async function collectDependentCallerFiles(
  deps: DeltaDeps,
  affectedFilePaths: string[],
  pathsToRetire: ReadonlySet<string>,
  filesToParse: DiscoveredFile[],
): Promise<DiscoveredFile[]> {
  const existingPaths = new Set(filesToParse.map(({ file }) => file));
  const additionalFiles: DiscoveredFile[] = [];
  for (const file of affectedFilePaths) {
    if (
      existingPaths.has(file) ||
      pathsToRetire.has(file) ||
      !isDiscoverableSourceFile(file)
    ) {
      continue;
    }
    const code = await deps.git.readFileAtRef(
      deps.workspaceRoot,
      deps.headSha,
      file,
    );
    if (code === undefined) continue;
    additionalFiles.push({ file, hash: hashContent(code), code });
  }
  return additionalFiles;
}

/** Splits a name-status diff into paths whose L2 rows must be dropped (deleted files + renames'
 *  old paths) and discoverable source files to re-parse (§6b: renames are delete + add). */
function partitionChangedEntries(changedEntries: ChangedFileEntry[]): {
  toDelete: Set<string>;
  toReparse: ChangedFileEntry[];
} {
  const toDelete = new Set<string>();
  const toReparse: ChangedFileEntry[] = [];

  for (const entry of changedEntries) {
    if (entry.status === ChangedFileStatuses.DELETED) {
      toDelete.add(entry.file);
      continue;
    }
    if (entry.status === ChangedFileStatuses.RENAMED && entry.oldFile) {
      toDelete.add(entry.oldFile);
    }
    if (!isDiscoverableSourceFile(entry.file)) continue;
    toReparse.push(entry);
  }

  return { toDelete, toReparse };
}

/** Reads each re-parse candidate at `headSha`, applying the same oversize guard `init`'s
 *  discovery uses, and classifies modified files for the Tier B queue and Tier C's
 *  `CONTRACT_CHANGED`-symbol candidates (phase1-decision-integration.md §9b). Also sums each
 *  parsed file's byte size into `changedBytes` — §9m item 1's commit-cap trigger data, collected
 *  here "for free" since `sizeBytes` is already computed for the oversize guard. */
async function collectFilesToParse(
  deps: DeltaDeps,
  toReparse: ChangedFileEntry[],
  changedContentByPath: ReadonlyMap<string, string>,
): Promise<{
  filesToParse: DiscoveredFile[];
  skippedOversized: { file: string; sizeBytes: number }[];
  tierBEntries: TierBQueueEntry[];
  tierCSymbolEntries: TierCQueueEntry[];
  changedBytes: number;
}> {
  const { workspaceRoot, logger, git, headSha } = deps;

  const blobHashes = await git.listTrackedFilesWithBlobHash(workspaceRoot);
  const semanticDiffAnalyzer = docuviaFactory.resolve(
    TOKENS.SemanticDiffAnalyzer,
    { logger },
  );

  const filesToParse: DiscoveredFile[] = [];
  const skippedOversized: { file: string; sizeBytes: number }[] = [];
  const tierBEntries: TierBQueueEntry[] = [];
  const tierCSymbolEntries: TierCQueueEntry[] = [];
  let changedBytes = 0;

  for (const entry of toReparse) {
    const content =
      changedContentByPath.get(entry.file) ??
      (await git.readFileAtRef(workspaceRoot, headSha, entry.file));
    if (content === undefined) continue; // gone by the time we read it (rare race) — skip, not fatal

    const sizeBytes = Buffer.byteLength(content, UTF8_ENCODING);
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      skippedOversized.push({ file: entry.file, sizeBytes });
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.DELTA_FILE_SKIPPED_OVERSIZED,
        file: entry.file,
        sizeBytes,
      });
      continue;
    }

    // Prefer the git blob sha (matches `FileDiscoveryService`'s own hashing scheme for tracked,
    // clean files); fall back to a content sha256 (mirrors that same service's manual-hash path)
    // for the rare case a just-changed file isn't yet reflected in `listTrackedFilesWithBlobHash`.
    const hash =
      blobHashes.get(entry.file) ??
      crypto.createHash(HASH_ALGO_SHA256).update(content).digest(ENCODING_HEX);
    filesToParse.push({ file: entry.file, hash, code: content });
    changedBytes += sizeBytes;

    const { contractChanged, findings } = await classifyChangedFile(
      deps,
      semanticDiffAnalyzer,
      entry,
      content,
    );
    if (contractChanged) {
      tierBEntries.push({ file: entry.file, commitSha: headSha });
      tierCSymbolEntries.push(
        ...collectContractSymbolCandidates(entry.file, headSha, findings),
      );
    }
  }

  return {
    filesToParse,
    skippedOversized,
    tierBEntries,
    tierCSymbolEntries,
    changedBytes,
  };
}

/** Detector classification (§6b) — modified and added files are classified (added files are
 *  diffed against an empty old-content baseline; renamed files have no meaningful "old content"
 *  at this path to diff against, so they're excluded); re-parsing is never gated on the outcome.
 *  Also returns the raw `findings` so the caller can derive Tier C's `CONTRACT_CHANGED`-symbol
 *  candidates (§9b) without re-running the detector. */
async function classifyChangedFile(
  deps: DeltaDeps,
  semanticDiffAnalyzer: ISemanticDiffAnalyzer,
  entry: ChangedFileEntry,
  newContent: string,
): Promise<{
  contractChanged: boolean;
  findings: SemanticDiffModifiedNode[];
}> {
  const { workspaceRoot, git, fromSha, headSha } = deps;
  if (
    entry.status !== ChangedFileStatuses.MODIFIED &&
    entry.status !== ChangedFileStatuses.ADDED
  )
    return { contractChanged: false, findings: [] };

  // A brand-new file has no prior commit to diff against -- diff it against an empty baseline so
  // every top-level export falls into resolvePruningLevel()'s existing "no matching old node" ->
  // CONTRACT_CHANGED branch, instead of the file being silently excluded from Tier B forever.
  const oldContent =
    entry.status === ChangedFileStatuses.ADDED
      ? ""
      : await git.readFileAtRef(workspaceRoot, fromSha, entry.file);
  if (oldContent === undefined) return { contractChanged: false, findings: [] };

  const lineRanges = await git.getChangedLineRanges(
    workspaceRoot,
    fromSha,
    headSha,
    entry.file,
  );
  if (lineRanges.length === 0) return { contractChanged: false, findings: [] };

  const findings = await semanticDiffAnalyzer.analyzeFile({
    filePath: entry.file,
    oldContent,
    newContent,
    changedLineRanges: lineRanges,
  });
  return {
    contractChanged: findings.some((f) => f.pruningLevel === 1),
    findings,
  };
}

/** Retires deleted, renamed-old, oversized, and parse-failed paths (`retirePath`), re-parses +
 *  persists the changed files via the shared `runParseAndPersist` phase helper, appends the Tier
 *  B/C queues, advances the Tier B commit-cap's cumulative-bytes accumulator (§9m item 1), and
 *  stamps the last-ingested source sha. Returns the parse failures. */
async function persistDelta(
  deps: DeltaDeps,
  work: {
    pathsToRetire: Set<string>;
    filesToParse: DiscoveredFile[];
    affectedCallerFilePaths: string[];
    tierBEntries: TierBQueueEntry[];
    tierCEntries: TierCQueueEntry[];
    changedBytes: number;
  },
): Promise<{ failures: AstParseFailure[]; filesParsed: number }> {
  const filesToPersist = await prepareDeltaFiles(deps, work);
  await retireDeltaPaths(deps, work.pathsToRetire);
  const { failures, callResolutionByFile } = await parseDeltaFiles(
    deps,
    filesToPersist,
    work.pathsToRetire,
  );
  await recordDeltaCallResolution(
    deps,
    work.pathsToRetire,
    filesToPersist,
    callResolutionByFile,
  );
  await commitDeltaMetadata(deps, work, failures);
  return { failures, filesParsed: filesToPersist.length };
}

async function prepareDeltaFiles(
  deps: DeltaDeps,
  work: {
    pathsToRetire: Set<string>;
    filesToParse: DiscoveredFile[];
    affectedCallerFilePaths: string[];
  },
): Promise<DiscoveredFile[]> {
  const { pathsToRetire, filesToParse, affectedCallerFilePaths } = work;
  const dependentCallerFiles = await collectDependentCallerFiles(
    deps,
    affectedCallerFilePaths,
    pathsToRetire,
    filesToParse,
  );
  return [...filesToParse, ...dependentCallerFiles];
}

async function retireDeltaPaths(
  deps: DeltaDeps,
  pathsToRetire: Set<string>,
): Promise<void> {
  if (pathsToRetire.size === 0) return;
  const { store, projectId } = deps;
  await store.withWriteLock(() => {
    for (const file of pathsToRetire) retirePath(store, projectId, file);
    // Tier B drains can upsert `project_files`, while Tier C contract-symbol entries need an L2
    // anchor. Drop both kinds of path-scoped work before a later drain can outlive this retirement.
    removeTierBQueueEntriesForFiles(store, pathsToRetire);
    removeTierCQueueEntriesForFiles(store, pathsToRetire);
  });
}

async function parseDeltaFiles(
  deps: DeltaDeps,
  filesToPersist: DiscoveredFile[],
  pathsToRetire: Set<string>,
): Promise<{
  failures: AstParseFailure[];
  callResolutionByFile?: Record<string, CallResolutionStats>;
}> {
  const { workspaceRoot, logger, store, projectId } = deps;
  if (filesToPersist.length === 0) {
    if (pathsToRetire.size > 0) {
      // Refresh #393 evidence against the remaining tracked files on retirement-only deltas.
      await docuviaFactory.resolve(TOKENS.GraphPersister).persist({
        store,
        workspaceRoot,
        projectId,
        parsedResults: [],
        tags: [],
      });
    }
    return { failures: [] };
  }

  const astProcessor = docuviaFactory.resolve(TOKENS.AstProcessor, { logger });
  const graphPersister = docuviaFactory.resolve(TOKENS.GraphPersister);
  const result = await runParseAndPersist({
    astProcessor,
    graphPersister,
    store,
    workspaceRoot,
    projectId,
    filesToParse: filesToPersist,
    // Already logged (analyze.delta.file_skipped_oversized) while collecting source changes.
    skippedOversized: [],
    tags: new Set(),
    appendLogLine: appendAnalyzeLogLine,
    logEvents: {
      parseFailure: ANALYZE_EVENTS.DELTA_PARSE_FAILURE,
      fileSkippedOversized: ANALYZE_EVENTS.DELTA_FILE_SKIPPED_OVERSIZED,
    },
  });
  return {
    failures: result.failures,
    callResolutionByFile: result.callResolutionByFile,
  };
}

async function recordDeltaCallResolution(
  deps: DeltaDeps,
  pathsToRetire: Set<string>,
  filesToPersist: DiscoveredFile[],
  callResolutionByFile: Record<string, CallResolutionStats> | undefined,
): Promise<void> {
  if (filesToPersist.length === 0 && pathsToRetire.size === 0) return;
  const { workspaceRoot, store } = deps;
  const deltaCallResolution = callResolutionByFile ?? {};
  mergeDeltaCallResolution(
    store,
    deltaCallResolution,
    filesToPersist.map(({ file }) => file),
    pathsToRetire,
  );
  const totals = aggregateCallResolution(deltaCallResolution);
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.DELTA_CALL_RESOLUTION,
    ...totals,
    files: Object.keys(deltaCallResolution).length,
  });
}

async function commitDeltaMetadata(
  deps: DeltaDeps,
  work: {
    tierBEntries: TierBQueueEntry[];
    tierCEntries: TierCQueueEntry[];
    changedBytes: number;
  },
  failures: AstParseFailure[],
): Promise<void> {
  const { store, projectId, headSha, logger } = deps;
  const failedPaths = new Set(failures.map(({ file }) => file));
  await store.withWriteLock(() => {
    for (const file of failedPaths) retirePath(store, projectId, file);
    if (work.tierBEntries.length > 0) {
      appendTierBQueueEntries(store, work.tierBEntries);
    }
    if (work.tierCEntries.length > 0) {
      appendTierCQueueEntries(store, work.tierCEntries, logger);
    }
    removeTierBQueueEntriesForFiles(store, failedPaths);
    removeTierCQueueEntriesForFiles(store, failedPaths);
    if (work.changedBytes > 0) {
      const priorBytes = Number(
        store.meta.get(GitConstants.META_KEY_TIER_B_CHANGED_BYTES) ?? 0,
      );
      store.meta.set(
        GitConstants.META_KEY_TIER_B_CHANGED_BYTES,
        String(priorBytes + work.changedBytes),
      );
    }
    store.meta.set(GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA, headSha);
  });
}
