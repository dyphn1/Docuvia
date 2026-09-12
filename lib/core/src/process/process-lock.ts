import fs from "node:fs/promises";
import {
  UTF8_ENCODING,
  FS_FLAG_EXCLUSIVE_CREATE_WRITE,
  ERRNO_EEXIST,
  ERRNO_EPERM,
  ERRNO_EACCES,
  ERRNO_EBUSY,
  ProcessLockTimeoutError,
  type ProcessLockHandle,
  type ProcessLockOptions,
} from "@workspace/contracts";

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

function isRetryableLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return (
    code === ERRNO_EEXIST ||
    code === ERRNO_EPERM ||
    code === ERRNO_EACCES ||
    code === ERRNO_EBUSY
  );
}

async function tryCreateLockFile(lockPath: string): Promise<boolean> {
  try {
    const handle = await fs.open(lockPath, FS_FLAG_EXCLUSIVE_CREATE_WRITE);
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch (err) {
    if (!isRetryableLockError(err)) throw err;
    return false;
  }
}

/**
 * Node runtime implementation of the process-lock contract. The lockfile contains the holder PID
 * and is heartbeated while held; a waiter only reclaims a stale lock when the recorded process is
 * also confirmed dead.
 */
export async function acquireProcessLock(
  lockPath: string,
  options: Partial<ProcessLockOptions> = {},
): Promise<ProcessLockHandle> {
  const opts: ProcessLockOptions = { ...DEFAULT_OPTIONS, ...options };
  const deadline = Date.now() + opts.maxWaitMs;
  let notifiedWaiting = false;

  for (;;) {
    if (await tryCreateLockFile(lockPath)) break;

    if (!notifiedWaiting) {
      notifiedWaiting = true;
      options.onWaiting?.();
    }

    if (await removeStaleLockIfAbandoned(lockPath, opts.staleAfterMs)) continue;

    if (Date.now() > deadline) {
      throw new ProcessLockTimeoutError(lockPath);
    }
    await sleep(opts.retryIntervalMs);
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
