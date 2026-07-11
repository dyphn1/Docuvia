import { TempFileManager } from "../temp-file-manager.js";
import { logger } from "../../utils/logger.js";

export interface InitTempLifecycle {
  tempFileManager: TempFileManager;
  /** Stops the periodic cleanup interval. Named to make the composition root's/`InitCommand`'s
   *  `finally`/signal-handling call site read as "stop the lifecycle this function started",
   *  distinct from `TempFileManager.stopCleanup()`'s own narrower name. */
  stop(): void;
}

/**
 * Phase 5 of `InitCommand.execute()`: constructs and initializes a `TempFileManager` for this
 * `init` run, ported from old `InitService.init()`'s step 5 (minus process-signal
 * registration — `TempFileManager` no longer self-registers `SIGTERM`/`SIGINT` handlers
 * internally, and this file doesn't either; the caller (`InitCommand.execute()`) owns
 * registering/deregistering exactly one signal-handler pair per invocation, per the plan's
 * "one shared signal handler at the composition root" guidance for this milestone).
 *
 * Non-fatal on failure, matching old behavior: returns `undefined` (logged as a warning)
 * rather than throwing, since a broken temp-file manager shouldn't fail `init` itself.
 */
export async function initTempLifecycle(workspaceRoot: string): Promise<InitTempLifecycle | undefined> {
  try {
    const tempFileManager = new TempFileManager(workspaceRoot);
    await tempFileManager.initialize();
    logger.info({ tempDir: tempFileManager.getTempDirPath() }, "Temp file manager initialized");
    return { tempFileManager, stop: () => tempFileManager.stopCleanup() };
  } catch (err: any) {
    logger.warn({ error: err.message }, "Failed to initialize temp file manager (non-fatal)");
    return undefined;
  }
}
