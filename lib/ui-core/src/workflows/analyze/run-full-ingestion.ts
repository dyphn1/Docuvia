import {
  docuviaFactory,
  TOKENS,
  type IGitProvider,
  type IGraphStore,
  type ILogger,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import { seedProjectRow } from "../init/seed-project-row.js";
import { runDiscoveryPipeline } from "../init/run-discovery-pipeline.js";
import { runParseAndPersist } from "../init/run-parse-and-persist.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { ANALYZE_EVENTS, ANALYZE_MESSAGES } from "./analyze-messages.js";
import { AnalyzeResultKind, type AutoModeResult } from "./analyze-result.js";

/**
 * `analyze` auto mode's full-ingestion branch (§6a) — the graph has no project row or no L2
 * nodes. Reuses `init`'s own Phase 2-4 helpers verbatim (`seedProjectRow`,
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

  const project = await seedProjectRow(store.projects, git, workspaceRoot);

  const discoveryResult = await runDiscoveryPipeline({
    configScanner,
    vcsScanner,
    fileDiscovery,
    filesRepo: store.files,
    workspaceRoot,
  });

  const { parsedResults, failures } = await runParseAndPersist({
    astProcessor,
    graphPersister,
    store,
    workspaceRoot,
    projectId: project.id,
    filesToParse: discoveryResult.filesToParse,
    skippedOversized: discoveryResult.skippedOversized,
    tags: discoveryResult.tags,
    appendLogLine: appendAnalyzeLogLine,
    logEvents: {
      parseFailure: ANALYZE_EVENTS.FULL_PARSE_FAILURE,
      fileSkippedOversized: ANALYZE_EVENTS.FULL_FILE_SKIPPED_OVERSIZED,
    },
  });

  // Mirrors init-workflow.ts's Phase 4b comment: this graph just came from a direct parse, not a
  // git hydration, so `store.meta`'s recorded knowledge-tip sha is still unset (or stale) —
  // without this, the next read-path command's `ensureHydrated()` could overwrite the graph just
  // persisted above with a stale/empty git snapshot.
  await hydrationService.markSynced(workspaceRoot, store);

  const headSha = await git.getHeadSha(workspaceRoot);
  if (headSha) {
    await store.withWriteLock(() => {
      store.meta.set(GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA, headSha);
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
