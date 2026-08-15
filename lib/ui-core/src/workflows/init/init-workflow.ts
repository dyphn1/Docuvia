import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type IGraphStore,
  type ILogger,
} from "@workspace/contracts";
import { INIT_EVENTS, INIT_MESSAGES } from "./init-messages.js";
import { appendInitLogLine, writeInitSummary } from "./init-log-writer.js";
import { ensureGitBranchAndHooks } from "./ensure-git-branch-and-hooks.js";
import { seedProjectRow } from "./seed-project-row.js";
import { runDiscoveryPipeline } from "./run-discovery-pipeline.js";
import { runParseAndPersist } from "./run-parse-and-persist.js";
import { stampFullIngestionForTierB } from "./stamp-full-ingestion-for-tier-b.js";
import { initTempLifecycle } from "./init-temp-lifecycle.js";
import {
  buildInitResult,
  buildSkippedInitResult,
  type InitResult,
} from "./init-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { packCurrentGraphOntoKnowledgeBranch } from "../snapshot/pack-current-graph.js";

export { resolveDbPath };

/** Node.js shutdown signals this workflow briefly listens for while a temp-file manager is active. */
const INIT_SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

/**
 * The `init` workflow — the Orchestration Layer's composition for the `init` capability (see
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Orchestration Layer section).
 * Resolves every dependency from `docuviaFactory` by interface token — never imports a
 * concrete implementation package — and owns the `IGraphStore`'s lifecycle end to end
 * (`open()` here, `close()` in `execute()`'s `finally`).
 *
 * `execute()` is a short, readable sequence calling the extracted phase functions in order:
 *   0. Already-initialized detection (roadmap item 35 / issue #43): once `ensureGitBranchAndHooks`
 *      has run, if `store.projects.getFirst()` returns a project row *and* `store.graph.count()`
 *      reports `l2Nodes > 0`, this workspace already has a populated graph -- return
 *      `buildSkippedInitResult()` immediately rather than re-running the expensive
 *      discovery/parse/persist steps below. `docuvia analyze` (delta ingestion) is the intended
 *      way to refresh an already-initialized workspace's graph, not a repeat `init`.
 *   1. `ensureGitBranchAndHooks` (branch -> post-commit hook)
 *   2. `seedProjectRow` (idempotency check + insert against `store.projects`)
 *   3. `runDiscoveryPipeline` (parallel config/vcs/file discovery + tag merge)
 *   4. `runParseAndPersist` (AST parse + persist to the knowledge graph)
 *   4b2. `stampFullIngestionForTierB` -- stamps `lastIngestedSourceSha` and queues every just-
 *        parsed file for Tier B, so `init` stays behaviorally identical to `analyze`'s own
 *        empty-graph full-ingestion branch (`run-full-ingestion.ts`) rather than silently leaving
 *        the initial parse un-queued.
 *   4c. `packCurrentGraphOntoKnowledgeBranch` (non-fatal), then -- only once it succeeds --
 *       `hydrationService.markSynced` (records the knowledge-tip sha so the very next read-path
 *       command's `ensureHydrated()` doesn't overwrite the graph just persisted above; deferred
 *       until after a successful pack so a failed pack instead leaves `HydrationService.hydrate()`'s
 *       pending-write guard able to do its job). The branch `ensureGitBranchAndHooks` just created
 *       carries an empty tree (`KnowledgeGitService.ensureKnowledgeBranch`'s doc comment); without
 *       packing, it would stay empty until the next manual `docuvia snapshot` or `git push`, so a
 *       fresh clone/CI checkout or `docuvia hydrate` elsewhere would see nothing even though this
 *       workspace's `local.db` is fully populated.
 *   5. `initTempLifecycle` (temp-file manager construct + initialize)
 *   6. `buildInitResult` (success/partial-failure message selection)
 * bracketed by `init.start`/`init.summary` JSONL logging.
 */
export class InitWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(): Promise<InitResult> {
    const { workspaceRoot, logger } = this;

    logger.info(INIT_MESSAGES.INITIALIZING(workspaceRoot));
    await appendInitLogLine(workspaceRoot, {
      event: INIT_EVENTS.START,
      workspaceRoot,
    });

    // No generic annotations — each TOKENS.X value carries its own return/params types, so
    // `resolve()` infers the correct interface automatically (see
    // docs/gitbook/architecture/virtual-contracts-architecture.md#8).
    const git = docuviaFactory.resolve(TOKENS.GitProvider);
    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger,
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
    const buildTempFileManager = docuviaFactory.resolve(TOKENS.TempFileManager);
    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);

    let store: IGraphStore;
    try {
      store = await openStore({ dbPath: resolveDbPath(workspaceRoot) });
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.INIT_WORKFLOW_FAILED,
        INIT_MESSAGES.OPEN_DB_FAILED,
        err,
      );
    }

    try {
      // 0. Already-initialized detection (roadmap item 35 / issue #43) -- mirrors
      // `analyze-workflow.ts`'s `dispatchAutoMode()` empty-graph check (`!project || l2Nodes ===
      // 0`), inverted: a project row *and* a populated L2 graph mean this workspace already went
      // through a real `init`, so re-running discovery/parse/persist here would be pure,
      // expensive redundant work -- `analyze`'s own delta/no-op path is the correct place for
      // "refresh an existing graph," not `init`. This check applies to every `docuvia init`
      // invocation, not just `--platform=`-scoped ones (see init-workflow.unit.test.ts's
      // "already initialized" describe block and the plan this fix followed, §6).
      const existingProject = store.projects.getFirst();
      const { l2Nodes: existingL2Nodes } = store.graph.count();
      const alreadyInitialized =
        existingProject !== undefined && existingL2Nodes > 0;

      // 1. Hidden knowledge-graph branch + (non-fatal) post-commit/pre-push hooks -- runs on
      // both paths; idempotent and cheap (no file discovery/parsing). Keeping this on the light
      // path is deliberate: a repeat `init` call still benefits from any legacy-hook-upgrade
      // logic (`installPostCommitHook`/`installPrePushHook` both no-op when already installed)
      // without needing a separate `doctor --fix` run.
      await ensureGitBranchAndHooks(knowledgeGit, workspaceRoot, logger);

      if (alreadyInitialized) {
        logger.info(INIT_MESSAGES.ALREADY_INITIALIZED);
        await appendInitLogLine(workspaceRoot, {
          event: INIT_EVENTS.ALREADY_INITIALIZED,
          workspaceRoot,
        });
        return buildSkippedInitResult();
      }

      // 2. Idempotent project-row seed (schema readiness already guaranteed by openStore()).
      const project = await seedProjectRow(store.projects, git, workspaceRoot);

      // 3. Discover, tag (config + VCS hotspot), in parallel.
      logger.info(INIT_MESSAGES.SCANNING_WORKSPACE);
      const discoveryResult = await runDiscoveryPipeline({
        configScanner,
        vcsScanner,
        fileDiscovery,
        filesRepo: store.files,
        workspaceRoot,
      });

      // 4. Parse + persist (adds per-file language tags to the same shared tag set).
      logger.info(INIT_MESSAGES.PARSING_AST);
      const { parsedResults, failures } = await runParseAndPersist({
        astProcessor,
        graphPersister,
        store,
        workspaceRoot,
        projectId: project.id,
        filesToParse: discoveryResult.filesToParse,
        skippedOversized: discoveryResult.skippedOversized,
        tags: discoveryResult.tags,
        appendLogLine: appendInitLogLine,
        logEvents: {
          parseFailure: INIT_EVENTS.PARSE_FAILURE,
          fileSkippedOversized: INIT_EVENTS.FILE_SKIPPED_OVERSIZED,
        },
      });
      logger.info(INIT_MESSAGES.PERSISTING_GRAPH);

      // 4b2. Stamp `lastIngestedSourceSha` and queue every just-parsed file for Tier B (LSP
      // cross-file edge resolution) -- the same step `analyze`'s own empty-graph full-ingestion
      // branch runs after its parse+persist (see stamp-full-ingestion-for-tier-b.ts's doc
      // comment). Without this, a workspace populated via `docuvia init` would never have its
      // initial files queued for Tier B at all, since only a file touched by a later commit would
      // enter the queue via `analyze`'s delta path -- `init` must stay behaviorally identical to
      // analyze's own first-run ingestion here.
      await stampFullIngestionForTierB({
        store,
        git,
        workspaceRoot,
        parsedResults,
      });

      // 4c. Pack this graph onto the knowledge branch now, rather than leaving its
      // `ensureGitBranchAndHooks`-created initial commit empty until the next manual `docuvia
      // snapshot` or `git push` (pre-push hook). Non-fatal: the local graph above is already
      // intact and reportable as a successful init either way.
      logger.info(INIT_MESSAGES.SNAPSHOTTING_KNOWLEDGE_BRANCH);
      const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, {
        logger,
      });
      try {
        await packCurrentGraphOntoKnowledgeBranch(
          workspaceRoot,
          store,
          knowledgeGit,
        );
        // Record the post-pack resolved tip only once the pack actually landed -- recording it
        // beforehand (this file's prior behavior) raced the pack itself: resolveHydrationCommit()
        // resolves to a *different*, newer commit the instant a same-source-sha pack succeeds
        // (STOR-001 point 2's "newest entry per source sha wins"), which made the very next
        // read-path command's isStale() spuriously true even after a fully successful init. Just as
        // importantly, *not* calling this when the pack fails leaves HydrationService.hydrate()'s
        // pending-write guard (pack-current-graph.ts) able to do its job on the next read-path
        // command, instead of a stale-but-present meta value doing so by accident.
        await hydrationService.markSynced(workspaceRoot, store);
      } catch (err) {
        logger.warn(INIT_MESSAGES.SNAPSHOT_AFTER_INIT_FAILED, {
          error: err instanceof Error ? err.message : String(err),
        });
        await appendInitLogLine(workspaceRoot, {
          event: INIT_EVENTS.SNAPSHOT_AFTER_INIT_FAILED,
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // 5. Temp file manager for LSP/incremental updates (non-fatal on failure). Registers
      // exactly one SIGTERM/SIGINT pair for this invocation, removed in `finally` below — a
      // single `init` invocation is its own scope; a multi-command shared-handler abstraction
      // is future work once more commands exist.
      logger.info(INIT_MESSAGES.INITIALIZING_TEMP_FILES);
      const tempLifecycle = await initTempLifecycle(
        buildTempFileManager,
        workspaceRoot,
        logger,
      );

      const disposeShutdownHandlers = registerTempLifecycleShutdownHandlers(
        tempLifecycle,
        logger,
      );

      try {
        const filesRequested = discoveryResult.filesToParse.length;
        const filesParsed = parsedResults.length;
        const filesFailed = failures.length;
        const filesSkippedOversized = discoveryResult.skippedOversized.length;

        if (filesFailed > 0 || filesSkippedOversized > 0) {
          logger.warn(INIT_MESSAGES.PARSE_FAILURES_OR_SKIPPED, {
            filesRequested,
            filesParsed,
            filesFailed,
            filesSkippedOversized,
          });
        }

        const result = buildInitResult({
          filesRequested,
          filesParsed,
          filesFailed,
          failures,
          filesSkippedOversized,
        });

        await writeInitSummary(workspaceRoot, {
          filesRequested,
          filesParsed,
          filesFailed,
          failures,
          filesSkippedOversized,
        });

        return result;
      } finally {
        disposeShutdownHandlers();
      }
    } finally {
      await store.close();
    }
  }
}

/**
 * Registers this invocation's SIGTERM/SIGINT cleanup handler for the temp-file manager (extracted
 * from `execute()` solely to keep its own cyclomatic complexity within budget) and returns a
 * disposer that deregisters it — callers must invoke the disposer exactly once, in a `finally`,
 * so no invocation ever leaves a dangling process-level listener. A no-op tempLifecycle (nothing
 * to clean up) yields a no-op disposer.
 */
function registerTempLifecycleShutdownHandlers(
  tempLifecycle: Awaited<ReturnType<typeof initTempLifecycle>>,
  logger: ILogger,
): () => void {
  if (!tempLifecycle) return () => {};

  const cleanupHandler = () => {
    logger.info(INIT_MESSAGES.CLEANING_UP_TEMP_FILES);
    tempLifecycle.tempFileManager
      .cleanup()
      .catch((err) =>
        logger.error(INIT_MESSAGES.TEMP_FILE_CLEANUP_FAILED, {
          error: String(err),
        }),
      )
      .finally(() => tempLifecycle.stop());
  };
  for (const signal of INIT_SHUTDOWN_SIGNALS) {
    process.on(signal, cleanupHandler);
  }

  return () => {
    for (const signal of INIT_SHUTDOWN_SIGNALS) {
      process.removeListener(signal, cleanupHandler);
    }
  };
}
