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
import { initTempLifecycle } from "./init-temp-lifecycle.js";
import { buildInitResult, type InitResult } from "./init-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";

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
 *   1. `ensureGitBranchAndHooks` (branch -> post-commit hook)
 *   2. `seedProjectRow` (idempotency check + insert against `store.projects`)
 *   3. `runDiscoveryPipeline` (parallel config/vcs/file discovery + tag merge)
 *   4. `runParseAndPersist` (AST parse + persist to the knowledge graph)
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
      // 1. Hidden knowledge-graph branch + (non-fatal) post-commit hook.
      await ensureGitBranchAndHooks(knowledgeGit, workspaceRoot, logger);

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

      // 4b. The graph this just built came from a direct parse, not a git hydration, so
      // `store.meta`'s recorded knowledge-tip sha is still unset. Without this, the very next
      // read-path command's `ensureHydrated()` would see `isStale() === true` (nothing recorded
      // != the branch's — possibly still-empty — initial commit from step 1) and immediately
      // overwrite the graph just persisted above with that stale/empty git snapshot. Record the
      // current tip now so it isn't touched until an explicit `snapshot`/`hydrate` moves it.
      const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, {
        logger,
      });
      await hydrationService.markSynced(workspaceRoot, store);

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

      let cleanupHandler: (() => void) | undefined;
      if (tempLifecycle) {
        cleanupHandler = () => {
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
      }

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
        // Deregister so this invocation never leaves a dangling process-level listener.
        if (cleanupHandler) {
          for (const signal of INIT_SHUTDOWN_SIGNALS) {
            process.removeListener(signal, cleanupHandler);
          }
        }
      }
    } finally {
      await store.close();
    }
  }
}
