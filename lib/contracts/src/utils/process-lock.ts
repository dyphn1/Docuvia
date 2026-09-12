const ProcessLockErrorMessages = {
  TIMED_OUT_WAITING: (lockPath: string) =>
    `Timed out waiting for the lock at ${lockPath} — another process may be stuck`,
} as const;

/** Raised only when a process lock could not be acquired before maxWaitMs elapsed. */
export class ProcessLockTimeoutError extends Error {
  public constructor(lockPath: string) {
    super(ProcessLockErrorMessages.TIMED_OUT_WAITING(lockPath));
    this.name = "ProcessLockTimeoutError";
  }
}

/** Tunables for a process lock; all runtime implementations must honor these semantics. */
export interface ProcessLockOptions {
  /** How long to wait for the lock before throwing, in ms. */
  maxWaitMs: number;
  /** Poll interval while waiting for the lock to free up, in ms. */
  retryIntervalMs: number;
  /** How often the holder refreshes the lockfile's mtime while it works, in ms. */
  heartbeatIntervalMs: number;
  /**
   * A lock is only reclaimed as abandoned once its mtime has been stale for this long AND its
   * recorded PID is no longer alive. Implementations must not reclaim a live holder based on
   * mtime alone.
   */
  staleAfterMs: number;
  /** Called once, the first time this call finds the lock already held by another process. */
  onWaiting?: () => void;
}

export interface ProcessLockHandle {
  /** Idempotent — safe to call more than once. Stops the heartbeat and releases the lock. */
  release(): Promise<void>;
}

/**
 * Technology boundary for cross-process locking. `@workspace/contracts` owns only this contract;
 * the Node filesystem/PID implementation lives in `@workspace/core` and is registered by token.
 */
export type AcquireProcessLock = (
  lockPath: string,
  options?: Partial<ProcessLockOptions>,
) => Promise<ProcessLockHandle>;
