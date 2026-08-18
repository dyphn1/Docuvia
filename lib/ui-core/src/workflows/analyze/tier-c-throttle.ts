import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import {
  acquireProcessLock,
  DOCUVIA_DIR_NAME,
  TIER_C_LOCK_FILE_NAME,
  type ProcessLockHandle,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";

/** How long a Tier C dispatch waits for a contended lock before giving up (§9k gating test 3: "a
 *  second concurrent dispatch attempt ... is rejected/deferred"). Short and non-blocking by
 *  design -- this runs inside an automated pre-push/hook composition, not an interactive command,
 *  so there is no user to keep waiting; a contended lock degrades honestly (skip + log) rather
 *  than stalling the push. */
const TIER_C_LOCK_MAX_WAIT_MS = 200;
const TIER_C_LOCK_HEARTBEAT_MS = 5_000;
const TIER_C_LOCK_STALE_MS = 30_000;

/**
 * §9f's concurrency=1 throttle -- the PLAT-006 single-flight lock pattern (PID-stamped lockfile,
 * staleness takeover), held for the whole Tier C dispatch window. Returns `undefined` (never
 * throws) when the lock is already held by another process -- the caller's honest-degradation
 * path (skip the drain, log, exit 0) rather than a hard failure.
 */
export async function tryAcquireTierCLock(
  workspaceRoot: string,
): Promise<ProcessLockHandle | undefined> {
  const lockPath = path.join(
    workspaceRoot,
    DOCUVIA_DIR_NAME,
    TIER_C_LOCK_FILE_NAME,
  );
  try {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    return await acquireProcessLock(lockPath, {
      maxWaitMs: TIER_C_LOCK_MAX_WAIT_MS,
      retryIntervalMs: 50,
      heartbeatIntervalMs: TIER_C_LOCK_HEARTBEAT_MS,
      staleAfterMs: TIER_C_LOCK_STALE_MS,
    });
  } catch {
    return undefined;
  }
}

export interface SystemLoadCheck {
  ok: boolean;
  /** Present when `ok` is `false` (why it tripped) or when the check is a documented no-op
   *  (Windows) -- either way, a reason worth a JSONL log line, never a silently fabricated signal. */
  note?: string;
}

/**
 * §9f's one-shot system-load check: `os.loadavg()[0] / os.cpus().length > threshold`, sampled
 * once before dispatch -- no polling loop, no watcher. `os.loadavg()` always returns zeros on
 * Windows (Node's documented platform limitation), which would otherwise read as "load is always
 * fine" -- a fabricated signal this project's honest-degradation discipline forbids. Windows is
 * therefore a documented no-op (`ok: true` with an explanatory `note`, logged rather than silently
 * assumed) until real contention is reported on a platform where it can actually be observed.
 */
export function checkTierCSystemLoad(
  threshold: number = GitConstants.DEFAULT_TIER_C_LOAD_THRESHOLD,
): SystemLoadCheck {
  if (process.platform === "win32") {
    return {
      ok: true,
      note: "os.loadavg() returns zeros on Windows -- system-load check is a documented no-op here",
    };
  }

  const cpuCount = os.cpus().length || 1;
  const ratio = os.loadavg()[0] / cpuCount;
  if (ratio > threshold) {
    return {
      ok: false,
      note: `load ratio ${ratio.toFixed(2)} exceeds threshold ${threshold}`,
    };
  }
  return { ok: true };
}
