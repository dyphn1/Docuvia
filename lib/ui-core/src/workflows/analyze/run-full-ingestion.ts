import {
  aggregateCallResolution,
  docuviaFactory,
  TOKENS,
  type IGitProvider,
  type IGraphStore,
  type ILogger,
} from "@workspace/contracts";
import { seedProjectRow } from "../init/seed-project-row.js";
import { stampFullCallsProjectionCallerPolicy } from "../calls-projection-caller-policy.js";
import { runDiscoveryPipeline } from "../init/run-discovery-pipeline.js";
import {
  markCallSitesAvailableAfterCompleteIngestion,
  runParseAndPersist,
} from "../init/run-parse-and-persist.js";
import { stampFullIngestionForTierB } from "../init/stamp-full-ingestion-for-tier-b.js";
import { packCurrentGraphOntoKnowledgeBranch } from "../snapshot/pack-current-graph.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { stampFullCallResolution } from "./call-resolution-stats.js";
import { ANALYZE_EVENTS, ANALYZE_MESSAGES } from "./analyze-messages.js";
import { AnalyzeResultKind, type AutoModeResult } from "./analyze-result.js";
import { retirePath } from "./path-retirement.js";
import { removeTierBQueueEntriesForFiles } from "./tier-b-queue.js";
import { removeTierCQueueEntriesForFiles } from "./tier-c-queue.js";

/**
 * `analyze` auto mode's full-ingestion branch (§6a) — the graph has no project row, no L2 nodes,
 * or must be rebuilt after a history replacement. Reuses `init`'s own Phase 2-4 helpers (`seedProjectRow`,
 * `runDiscoveryPipeline`, `runParseAndPersist`) rather than re-implementing them; the old
 * config-scan-only output (`projectType`/`suggestedTags`) is folded in as part of this, per §6a.
 * Deliberately does NOT call `ensureGitBranchAndHooks` (branch/hook setup stays `init`'s job —
 * this dispatch must not touch the post-commit hook) and does not require a git repository at
 * all (mirrors `init`'s own git-optional discovery).
 */
export async function runFullIngestion(deps: {
  workspaceRoot: string;
  logger: ILogger;
  store: IGraphStore;
  git: IGitProvider;
}): Promise<AutoModeResult> {
  const { workspaceRoot, logger, store, git } = deps;

  logger.info(ANALYZE_MESSAGES.AUTO_FULL_INGESTION);
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.FULL_START,
  });

  const fileDiscovery = docuviaFactory.resolve(TOKENS.FileDiscovery, {
    logger,
  });
  const configScanner = docuviaFactory.resolve(TOKENS.ConfigScanner, {
    logger,
  });
  const vcsScanner = docuviaFactory.resolve(TOKENS.VcsScanner, { logger });
  const astProcessor = docuviaFactory.resolve(TOKENS.AstProcessor, {
    logger,
  });
  const graphPersister = docuviaFactory.resolve(TOKENS.GraphPersister);
  const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, {
    logger,
  });
  const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
    logger,
  });

  const project = await seedProjectRow(store.projects, git, workspaceRoot);
  await store.withWriteLock(() => {
    store.callSiteResolutions?.invalidateAll(project.id);
  });

  const discoveryResult = await runDiscoveryPipeline({
    configScanner,
    vcsScanner,
    fileDiscovery,
    // A full analyze fallback is authoritative for the current tree: matching persisted hashes
    // cannot stand in for rebuilding graph edges and call-resolution state.
    filesRepo: { getAllHashes: () => [] },
    workspaceRoot,
  });

  const currentFiles = new Set(
    discoveryResult.filesToParse.map(({ file }) => file),
  );
  await store.withWriteLock(() => {
    const pathsToRetire = new Set(
      store.files
        .getAllHashes()
        .filter(({ filePath }) => !currentFiles.has(filePath))
        .map(({ filePath }) => filePath),
    );
    for (const file of pathsToRetire) retirePath(store, project.id, file);
    removeTierBQueueEntriesForFiles(store, pathsToRetire);
    removeTierCQueueEntriesForFiles(store, pathsToRetire);
  });

  const { parsedResults, failures, callResolutionByFile } =
    await runParseAndPersist({
      astProcessor,
      graphPersister,
      store,
      workspaceRoot,
      projectId: project.id,
      filesToParse: discoveryResult.filesToParse,
      candidateFileCount: discoveryResult.candidateFileCount,
      skippedOversized: discoveryResult.skippedOversized,
      tags: discoveryResult.tags,
      appendLogLine: appendAnalyzeLogLine,
      logEvents: {
        parseFailure: ANALYZE_EVENTS.FULL_PARSE_FAILURE,
        fileSkippedOversized: ANALYZE_EVENTS.FULL_FILE_SKIPPED_OVERSIZED,
      },
    });
  markCallSitesAvailableAfterCompleteIngestion({
    store,
    projectId: project.id,
    candidateFileCount: discoveryResult.candidateFileCount,
    parsedFileCount: parsedResults.length,
    failedFileCount: failures.length,
    skippedOversizedCount: discoveryResult.skippedOversized.length,
  });

  const failedPaths = new Set(failures.map(({ file }) => file));
  if (failedPaths.size > 0) {
    await store.withWriteLock(() => {
      for (const file of failedPaths) retirePath(store, project.id, file);
      removeTierBQueueEntriesForFiles(store, failedPaths);
      removeTierCQueueEntriesForFiles(store, failedPaths);
    });
  }

  stampFullCallsProjectionCallerPolicy(store.meta, project.id);

  // Issue #221: a full run reparses every discoverable file, so its per-file call-resolution
  // counters replace the stored map wholesale, including an authoritative empty result.
  const fullCallResolutionByFile = callResolutionByFile ?? {};
  stampFullCallResolution(store, fullCallResolutionByFile, {
    clearWhenEmpty: true,
  });
  if (Object.keys(fullCallResolutionByFile).length > 0) {
    const totals = aggregateCallResolution(fullCallResolutionByFile);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FULL_CALL_RESOLUTION,
      ...totals,
      files: Object.keys(fullCallResolutionByFile).length,
    });
  }

  // First-ever ingestion has no prior commit to diff against -- mirrors semantic-diff.ts's
  // resolvePruningLevel's "no matching old node" -> CONTRACT_CHANGED treatment, extended to
  // whole-file granularity since there's nothing to diff per-node yet. Shared with `init`'s own
  // parse+persist phase (see stamp-full-ingestion-for-tier-b.ts's doc comment) so the two can't
  // drift apart again.
  await stampFullIngestionForTierB({
    store,
    git,
    workspaceRoot,
    parsedResults,
  });

  // Mirrors init-workflow.ts's step 4c: a full re-ingestion means the knowledge branch had
  // nothing hydratable (dispatchEmptyGraph's tryHydrateThenDelta already came up empty), so its
  // tip is exactly as empty as `init`'s own initial commit -- pack this graph onto it now rather
  // than leaving it empty until the next manual `docuvia snapshot` or `git push`. Non-fatal: the
  // local graph above is already intact and reportable as a successful analyze either way.
  try {
    await packCurrentGraphOntoKnowledgeBranch(
      workspaceRoot,
      store,
      knowledgeGit,
    );
    // Record the post-pack resolved tip only once the pack actually landed -- mirrors
    // init-workflow.ts's step 4c reordering: recording it beforehand raced the pack itself
    // (resolveHydrationCommit() resolves to a different, newer commit the instant a
    // same-source-sha pack succeeds), and not calling this when the pack fails leaves
    // HydrationService.hydrate()'s pending-write guard (pack-current-graph.ts) able to do its job
    // on the next read-path command.
    await hydrationService.markSynced(workspaceRoot, store);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(ANALYZE_MESSAGES.SNAPSHOT_AFTER_FULL_INGESTION_FAILED, {
      error: message,
    });
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FULL_SNAPSHOT_FAILED,
      message,
    });
  }

  const filesRequested = discoveryResult.filesToParse.length;
  const filesParsed = parsedResults.length;
  const filesFailed = failures.length;
  const filesSkippedOversized = discoveryResult.skippedOversized.length;

  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.FULL_SUMMARY,
    projectType: discoveryResult.projectType,
    filesRequested,
    filesParsed,
    filesFailed,
    filesSkippedOversized,
  });

  return {
    kind: AnalyzeResultKind.AUTO_FULL_INGESTION,
    projectType: discoveryResult.projectType,
    suggestedTags: Array.from(discoveryResult.tags),
    filesRequested,
    filesParsed,
    filesFailed,
    filesSkippedOversized,
  };
}
