import fs from "fs/promises";
import path from "path";
import {
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  SYNC_STATE_FILE_NAME,
  UTF8_ENCODING,
  DocuviaError,
  ErrorCodes,
  ProcessLockTimeoutError,
  acquireProcessLock,
} from "@workspace/contracts";

export interface SyncStateFile {
  [projectId: string]: { syncedContentHashes: string[] };
}

function resolveSyncStatePath(workspaceRoot: string): string {
  return path.join(
    workspaceRoot,
    DOCUVIA_DIR_NAME,
    DOCUVIA_LOGS_DIR_NAME,
    SYNC_STATE_FILE_NAME,
  );
}

const SYNC_STATE_LOCK_MAX_WAIT_MS = 10_000;
const SYNC_STATE_LOCK_RETRY_INTERVAL_MS = 100;
const SYNC_STATE_LOCK_STALE_MS = 60_000;
/** Suffix appended to `statePath` for the cross-process sync-state lock file (see `acquireSyncStateLock`). */
const SYNC_STATE_LOCK_FILE_SUFFIX = ".lock" as const;

const SYNC_STATE_LOCK_MESSAGES = {
  TIMED_OUT_WAITING: (lockPath: string) =>
    `Timed out waiting for the sync-state lock at ${lockPath} — another docuvia publish may be stuck`,
} as const;

/**
 * Cross-process mutex around a load→mutate→save cycle of `sync-state.json`.
 * Delegates to the canonical process-lock helper so all cross-process locks share the same
 * PID + heartbeat stale-lock semantics. Only a real lock timeout is translated to DB_LOCKED;
 * filesystem and other acquisition failures keep their original error semantics.
 */
async function acquireSyncStateLock(statePath: string) {
  const lockPath = `${statePath}${SYNC_STATE_LOCK_FILE_SUFFIX}`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    return await acquireProcessLock(lockPath, {
      maxWaitMs: SYNC_STATE_LOCK_MAX_WAIT_MS,
      retryIntervalMs: SYNC_STATE_LOCK_RETRY_INTERVAL_MS,
      staleAfterMs: SYNC_STATE_LOCK_STALE_MS,
    });
  } catch (err) {
    if (!(err instanceof ProcessLockTimeoutError)) throw err;
    throw DocuviaError.wrap(
      ErrorCodes.DB_LOCKED,
      SYNC_STATE_LOCK_MESSAGES.TIMED_OUT_WAITING(lockPath),
      err,
    );
  }
}

/** Wraps a load→mutate→save `sync-state.json` cycle in the cross-process mutex above. */
export async function withSyncStateLock<T>(
  workspaceRoot: string,
  fn: () => Promise<T>,
): Promise<T> {
  const handle = await acquireSyncStateLock(
    resolveSyncStatePath(workspaceRoot),
  );
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}

/** Content-hash dedup cache so re-running `sync` doesn't re-push already-synced L3 decisions. Missing/corrupt file reads as empty state rather than throwing — a fresh workspace has no cache yet. */
export async function loadSyncState(
  workspaceRoot: string,
): Promise<SyncStateFile> {
  try {
    const raw = await fs.readFile(
      resolveSyncStatePath(workspaceRoot),
      UTF8_ENCODING,
    );
    return JSON.parse(raw) as SyncStateFile;
  } catch {
    return {};
  }
}

export async function saveSyncState(
  workspaceRoot: string,
  state: SyncStateFile,
): Promise<void> {
  const statePath = resolveSyncStatePath(workspaceRoot);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), UTF8_ENCODING);
}
