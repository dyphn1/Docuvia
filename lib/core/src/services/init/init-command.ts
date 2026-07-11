import { IWorkspaceGitService } from "../../interfaces/workspace-git.interfaces.js";
import { IAstProcessor, IConfigScanner, IFileDiscovery, IVcsScanner } from "../../interfaces/analyzer.interfaces.js";
import type { GraphStore } from "../../memory/graph-store.js";
import { logger } from "../../utils/logger.js";
import { INIT_SERVICE_MESSAGES } from "../../constants/init-service-messages.js";
import { appendInitLogLine, writeInitSummary } from "../init-log-writer.js";
import { ensureGitBranchAndHooks } from "./ensure-git-branch-and-hooks.js";
import { seedProjectRow } from "./seed-project-row.js";
import { runDiscoveryPipeline } from "./run-discovery-pipeline.js";
import { runParseAndPersist } from "./run-parse-and-persist.js";
import { initTempLifecycle } from "./init-temp-lifecycle.js";
import { buildInitResult, InitResult } from "./init-result.js";

export interface InitCommandDeps {
  store: GraphStore;
  git: IWorkspaceGitService;
  discovery: IFileDiscovery;
  astProcessor: IAstProcessor;
  configScanner: IConfigScanner;
  vcsScanner: IVcsScanner;
  workspaceRoot: string;
  onProgress?: (msg: string) => void;
}

/**
 * `InitCommand` — the decomposed replacement for old `InitService.init()`'s 136-line
 * god-method. `execute()` is a short, readable sequence calling the extracted phase functions
 * in old `init()`'s exact original order:
 *
 *   1. `ensureGitBranchAndHooks` (branch -> post-commit hook)
 *   2. `seedProjectRow` (idempotency check + insert against `store.projects`)
 *   3. `runDiscoveryPipeline` (parallel config/vcs/file discovery + tag merge)
 *   4. `runParseAndPersist` (AST parse + persist to `store.graph`/`.tags`/`.files`)
 *   5. `initTempLifecycle` (TempFileManager construct + initialize)
 *   6. `buildInitResult` (success/partial-failure message selection)
 *
 * bracketed by `init.start`/`init.summary` JSONL logging via `command-log-writer.ts`
 * (through `init-log-writer.ts`), matching old `InitService.init()`'s logging behavior.
 *
 * Every dependency is a required constructor parameter (no defaults) — this class never
 * constructs its own dependencies; only `composition/build-init-capability.ts` is allowed to
 * `new` the concrete service classes.
 */
export class InitCommand {
  constructor(private readonly deps: InitCommandDeps) {}

  /**
   * Closes the `GraphStore` this command was constructed with. Not part of the plan's
   * illustrative `buildInitCapability` sketch (which returns a bare `Promise<InitCommand>`,
   * no store reference alongside it), but required so *some* composition-root caller
   * (`artifacts/cli/src/commands/init.ts` / `mcp/tools/init.ts`, both later migration steps)
   * can actually fulfil "lifecycle owned by the composition root only ... in a `finally`"
   * without `InitCommand` needing to expose its whole `GraphStore` just for that one call.
   * Safe to call whether or not `execute()` ran (e.g. if `execute()` itself threw).
   */
  public async dispose(): Promise<void> {
    await this.deps.store.close();
  }

  public async execute(): Promise<InitResult> {
    const { store, git, discovery, astProcessor, configScanner, vcsScanner, workspaceRoot, onProgress } =
      this.deps;
    const log = onProgress ?? (() => {});

    log(INIT_SERVICE_MESSAGES.INITIALIZING(workspaceRoot));
    await appendInitLogLine(workspaceRoot, { event: "init.start", workspaceRoot });

    // 1. Hidden knowledge-graph branch + (non-fatal) post-commit hook.
    await ensureGitBranchAndHooks(git, workspaceRoot, log);

    // 2. Idempotent project-row seed (schema readiness already guaranteed by GraphStore.open()).
    const project = await seedProjectRow(store.projects, git, workspaceRoot);

    // 3. Discover, tag (config + VCS hotspot), in parallel.
    log("Scanning project files...");
    const discoveryResult = await runDiscoveryPipeline({
      configScanner,
      vcsScanner,
      fileDiscovery: discovery,
      filesRepo: store.files,
      workspaceRoot,
    });

    // 4. Parse + persist (adds per-file language tags to the same shared tag set).
    const { parsedResults, failures } = await runParseAndPersist({
      astProcessor,
      store,
      workspaceRoot,
      projectId: project.id,
      filesToParse: discoveryResult.filesToParse,
      skippedOversized: discoveryResult.skippedOversized,
      tags: discoveryResult.tags,
      onProgress: log,
    });

    // 5. TempFileManager for LSP/incremental updates (non-fatal on failure). Registers exactly
    // one SIGTERM/SIGINT pair for this invocation, removed in `finally` below — see the plan's
    // "one shared signal handler at the composition root" guidance for this milestone (a single
    // `init` invocation is its own scope; a multi-command shared-handler abstraction is future
    // work once more commands exist).
    log(INIT_SERVICE_MESSAGES.INITIALIZING_TEMP_FILES);
    const tempLifecycle = await initTempLifecycle(workspaceRoot);

    let cleanupHandler: (() => void) | undefined;
    if (tempLifecycle) {
      cleanupHandler = () => {
        logger.info("Cleaning up temp files on shutdown...");
        tempLifecycle.tempFileManager
          .cleanup()
          .catch((err) => logger.error({ error: err }, "Temp file cleanup on shutdown failed"))
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
        logger.warn(
          { filesRequested, filesParsed, filesFailed, filesSkippedOversized, failures },
          "init completed with parse failures or skipped files"
        );
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
      // Deregister so this invocation never leaves a dangling process-level listener — the
      // exact leak (registered on every `init()` call, never removed) old `InitService.init()`
      // had.
      if (cleanupHandler) {
        process.removeListener("SIGTERM", cleanupHandler);
        process.removeListener("SIGINT", cleanupHandler);
      }
    }
  }
}
