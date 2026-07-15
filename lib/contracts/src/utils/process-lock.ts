import fs from "node:fs/promises";
import { UTF8_ENCODING } from "../constants/encoding.js";

/** Node.js `fs.open` flag: fail (`EEXIST`) instead of overwriting if the path already exists — the basis of this module's exclusive-create lock. */
const FS_FLAG_EXCLUSIVE_CREATE_WRITE = "wx" as const;
/** `NodeJS.ErrnoException.code` reported by `fs.open(path, "wx")` when `path` already exists. */
const ERRNO_EEXIST = "EEXIST" as const;
/** `NodeJS.ErrnoException.code` reported by `process.kill(pid, 0)` when `pid` exists but the current process lacks permission to signal it (still means "alive"). */
const ERRNO_EPERM = "EPERM" as const;

const ProcessLockErrorMessages = {
  TIMED_OUT_WAITING: (lockPath: string) =>
    `Timed out waiting for the lock at ${lockPath} — another process may be stuck`,
} as const;

/** Tunables for {@link acquireProcessLock}; all have defaults, override per call site. */
export interface ProcessLockOptions {
  /** How long to wait for the lock before throwing, in ms. */
  maxWaitMs: number;
  /** Poll interval while waiting for the lock to free up, in ms. */
  retryIntervalMs: number;
  /** How often the holder refreshes the lockfile's mtime while it works, in ms. */
  heartbeatIntervalMs: number;
  /**
   * A lock is only reclaimed as abandoned once its mtime has been stale for this long AND its
   * recorded PID is no longer alive (see `isProcessAlive`) — mtime alone can't distinguish a
   * crashed holder from a live one whose heartbeat is merely delayed under load.
   */
  staleAfterMs: number;
  /** Called once, the first time this call finds the lock already held by another process. */
  onWaiting?: () => void;
}

export interface ProcessLockHandle {
  /** Idempotent — safe to call more than once. Stops the heartbeat and removes the lockfile. */
  release(): Promise<void>;
}

const DEFAULT_OPTIONS: ProcessLockOptions = {
  maxWaitMs: 10_000,
  retryIntervalMs: 100,
  heartbeatIntervalMs: 10_000,
  staleAfterMs: 30_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `process.kill(pid, 0)` throws ESRCH if the PID is gone, but EPERM if it exists and we just
 *  lack permission to signal it — either way EPERM means "alive". */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === ERRNO_EPERM;
  }
}

async function readLockPid(lockPath: string): Promise<number | undefined> {
  try {
    const pid = Number.parseInt(await fs.readFile(lockPath, UTF8_ENCODING), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function removeStaleLockIfAbandoned(
  lockPath: string,
  staleAfterMs: number,
): Promise<boolean> {
  const stat = await fs.stat(lockPath).catch(() => undefined);
  if (!stat || Date.now() - stat.mtimeMs <= staleAfterMs) return false;

  const pid = await readLockPid(lockPath);
  if (pid !== undefined && isProcessAlive(pid)) return false;

  await fs.rm(lockPath, { force: true }).catch(() => {});
  return true;
}

/**
 * Cross-process mutex backed by an exclusively-created (`wx`) lockfile containing the holder's
 * PID — the same shape as the ad hoc locks in `graph-store.ts`'s `acquireInitLock` and
 * `libgit2-provider.ts`'s `acquireKnowledgeLock` (see PLAT-006), generalized with a heartbeat so
 * it's safe to hold across a long-running operation (not just a sub-second DB bootstrap): the
 * holder periodically touches the lockfile's mtime, and waiters only reclaim it as abandoned once
 * both the mtime is stale *and* the recorded PID is confirmed dead.
 */
export async function acquireProcessLock(
  lockPath: string,
  options: Partial<ProcessLockOptions> = {},
): Promise<ProcessLockHandle> {
  const opts: ProcessLockOptions = { ...DEFAULT_OPTIONS, ...options };
  const deadline = Date.now() + opts.maxWaitMs;
  let notifiedWaiting = false;

  for (;;) {
    try {
      const handle = await fs.open(lockPath, FS_FLAG_EXCLUSIVE_CREATE_WRITE);
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== ERRNO_EEXIST) throw err;

      if (!notifiedWaiting) {
        notifiedWaiting = true;
        options.onWaiting?.();
      }

      if (await removeStaleLockIfAbandoned(lockPath, opts.staleAfterMs))
        continue;

      if (Date.now() > deadline) {
        throw new Error(ProcessLockErrorMessages.TIMED_OUT_WAITING(lockPath));
      }
      await sleep(opts.retryIntervalMs);
    }
  }

  const heartbeat = setInterval(() => {
    const now = new Date();
    fs.utimes(lockPath, now, now).catch(() => {});
  }, opts.heartbeatIntervalMs);
  heartbeat.unref?.();

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      await fs.rm(lockPath, { force: true }).catch(() => {});
    },
  };
}
