import path from "path";
import {
  docuviaFactory,
  TOKENS,
  DOCUVIA_DIR_NAME,
  LOCAL_DB_FILE_NAME,
  DocuviaError,
  ErrorCodes,
  type IGraphStore,
  type ILogger,
} from "@workspace/contracts";
import { INIT_MESSAGES } from "./init-messages.js";
import { appendInitLogLine, writeInitSummary } from "./init-log-writer.js";
import { ensureGitBranchAndHooks } from "./ensure-git-branch-and-hooks.js";
import { seedProjectRow } from "./seed-project-row.js";
import { runDiscoveryPipeline } from "./run-discovery-pipeline.js";
import { runParseAndPersist } from "./run-parse-and-persist.js";
import { initTempLifecycle } from "./init-temp-lifecycle.js";
import { buildInitResult, type InitResult } from "./init-result.js";

/** `<workspaceRoot>/.docuvia/local.db`. */
export function resolveDbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, DOCUVIA_DIR_NAME, LOCAL_DB_FILE_NAME);
}

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
    private readonly logger: ILogger
  ) {}

  public async execute(): Promise<InitResult> {
    const { workspaceRoot, logger } = this;

    logger.info(INIT_MESSAGES.INITIALIZING(workspaceRoot));
    await appendInitLogLine(workspaceRoot, { event: "init.start", workspaceRoot });

    // No generic annotations — each TOKENS.X value carries its own return/params types, so
    // `resolve()` infers the correct interface automatically (see
    // docs/gitbook/architecture/virtual-contracts-architecture.md#8).
    const git = docuviaFactory.resolve(TOKENS.GitProvider);
    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, { logger });
    const fileDiscovery = docuviaFactory.resolve(TOKENS.FileDiscovery, { logger });
    const configScanner = docuviaFactory.resolve(TOKENS.ConfigScanner, { logger });
    const vcsScanner = docuviaFactory.resolve(TOKENS.VcsScanner, { logger });
    const astProcessor = docuviaFactory.resolve(TOKENS.AstProcessor, { logger });
    const graphPersister = docuviaFactory.resolve(TOKENS.GraphPersister);
    const buildTempFileManager = docuviaFactory.resolve(TOKENS.TempFileManager);
    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);

    let store: IGraphStore;
    try {
      store = await openStore({ dbPath: resolveDbPath(workspaceRoot) });
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.INIT_WORKFLOW_FAILED, "Failed to open the local database", err);
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
      });
      logger.info(INIT_MESSAGES.PERSISTING_GRAPH);

      // 5. Temp file manager for LSP/incremental updates (non-fatal on failure). Registers
      // exactly one SIGTERM/SIGINT pair for this invocation, removed in `finally` below — a
      // single `init` invocation is its own scope; a multi-command shared-handler abstraction
      // is future work once more commands exist.
      logger.info(INIT_MESSAGES.INITIALIZING_TEMP_FILES);
      const tempLifecycle = await initTempLifecycle(buildTempFileManager, workspaceRoot, logger);

      let cleanupHandler: (() => void) | undefined;
      if (tempLifecycle) {
        cleanupHandler = () => {
          logger.info("Cleaning up temp files on shutdown...");
          tempLifecycle.tempFileManager
            .cleanup()
            .catch((err) => logger.error("Temp file cleanup on shutdown failed", { error: String(err) }))
            .finally(() => tempLifecycle.stop());
        };
        process.on("SIGTERM", cleanupHandler);
        process.on("SIGINT", cleanupHandler);
      }

      try {
        const filesRequested = discoveryResult.filesToParse.length;
        const filesParsed = parsedResults.length;
        const filesFailed = failures.length;
        const filesSkippedOversized = discoveryResult.skippedOversized.length;

        if (filesFailed > 0 || filesSkippedOversized > 0) {
          logger.warn("init completed with parse failures or skipped files", {
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
          process.removeListener("SIGTERM", cleanupHandler);
          process.removeListener("SIGINT", cleanupHandler);
        }
      }
    } finally {
      await store.close();
    }
  }
}
