import type { ILogger, ITempFileManager } from "@workspace/contracts";
import { INIT_MESSAGES } from "./init-messages.js";

export interface InitTempLifecycle {
  tempFileManager: ITempFileManager;
  /** Stops the periodic cleanup interval. Named to make the caller's `finally`/signal-handling call site read as "stop the lifecycle this function started". */
  stop(): void;
}

/** Phase 5: constructs and initializes a temp-file manager for this `init` run. Non-fatal on failure: returns `undefined` (logged as a warning) rather than throwing, since a broken temp-file manager shouldn't fail `init` itself. */
export async function initTempLifecycle(
  buildTempFileManager: (
    workspaceRoot: string,
    logger?: ILogger,
  ) => ITempFileManager,
  workspaceRoot: string,
  logger: ILogger,
): Promise<InitTempLifecycle | undefined> {
  try {
    const tempFileManager = buildTempFileManager(workspaceRoot, logger);
    await tempFileManager.initialize();
    logger.info(INIT_MESSAGES.TEMP_FILE_MANAGER_INITIALIZED, {
      tempDir: tempFileManager.getTempDirPath(),
    });
    return { tempFileManager, stop: () => tempFileManager.stopCleanup() };
  } catch (err: any) {
    logger.warn(INIT_MESSAGES.TEMP_FILE_MANAGER_INIT_FAILED, {
      error: err?.message ?? String(err),
    });
    return undefined;
  }
}
