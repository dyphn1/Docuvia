import type { ILogger, ITempFileManager } from "@workspace/contracts";

export interface InitTempLifecycle {
  tempFileManager: ITempFileManager;
  /** Stops the periodic cleanup interval. Named to make the caller's `finally`/signal-handling call site read as "stop the lifecycle this function started". */
  stop(): void;
}

/** Phase 5: constructs and initializes a temp-file manager for this `init` run. Non-fatal on failure: returns `undefined` (logged as a warning) rather than throwing, since a broken temp-file manager shouldn't fail `init` itself. */
export async function initTempLifecycle(
  buildTempFileManager: (workspaceRoot: string, logger?: ILogger) => ITempFileManager,
  workspaceRoot: string,
  logger: ILogger
): Promise<InitTempLifecycle | undefined> {
  try {
    const tempFileManager = buildTempFileManager(workspaceRoot, logger);
    await tempFileManager.initialize();
    logger.info("Temp file manager initialized", { tempDir: tempFileManager.getTempDirPath() });
    return { tempFileManager, stop: () => tempFileManager.stopCleanup() };
  } catch (err: any) {
    logger.warn("Failed to initialize temp file manager (non-fatal)", {
      error: err?.message ?? String(err),
    });
    return undefined;
  }
}
