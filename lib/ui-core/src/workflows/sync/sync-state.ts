import fs from "fs/promises";
import path from "path";
import {
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  SYNC_STATE_FILE_NAME,
  UTF8_ENCODING,
  DocuviaError,
  ErrorCodes,
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
/** Node.js `fs.open` flag: fail (`EEXIST`) instead of overwriting if the path already exists — the basis of `acquireSyncStateLock`'s exclusive-create lock (same shape as `lib/contracts`'s `process-lock.ts`). */
const FS_FLAG_EXCLUSIVE_CREATE_WRITE = "wx" as const;
/** `NodeJS.ErrnoException.code` reported by `fs.open(path, "wx")` when `path` already exists. */
const ERRNO_EEXIST = "EEXIST" as const;

const SYNC_STATE_LOCK_MESSAGES = {
  TIMED_OUT_WAITING: (lockPath: string) =>
    `Timed out waiting for the sync-state lock at ${lockPath} — another docuvia sync may be stuck`,
} as const;

/**
 * Cross-process mutex around a load→mutate→save cycle of `sync-state.json` — same shape as
 * `graph-store.ts`'s `acquireInitLock`/`releaseInitLock`. Needed because `loadSyncState()` and
 * `saveSyncState()` are a plain, unguarded read-modify-write: two concurrent `docuvia sync` runs
 * can both load the same dedup state and the second writer's save silently clobbers the first's
 * update, losing a `syncedContentHashes` entry with no error at all.
 */
async function acquireSyncStateLock(statePath: string): Promise<string> {
  const lockPath = `${statePath}${SYNC_STATE_LOCK_FILE_SUFFIX}`;
  const deadline = Date.now() + SYNC_STATE_LOCK_MAX_WAIT_MS;

  for (;;) {
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      const handle = await fs.open(lockPath, FS_FLAG_EXCLUSIVE_CREATE_WRITE);
      await handle.close();
      return lockPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== ERRNO_EEXIST) throw err;

      const stat = await fs.stat(lockPath).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > SYNC_STATE_LOCK_STALE_MS) {
        await fs.rm(lockPath, { force: true });
        continue;
      }

      if (Date.now() > deadline) {
        throw new DocuviaError(
          ErrorCodes.DB_LOCKED,
          SYNC_STATE_LOCK_MESSAGES.TIMED_OUT_WAITING(lockPath),
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SYNC_STATE_LOCK_RETRY_INTERVAL_MS),
      );
    }
  }
}

async function releaseSyncStateLock(lockPath: string): Promise<void> {
  await fs.rm(lockPath, { force: true });
}

/** Wraps a load→mutate→save `sync-state.json` cycle in the cross-process mutex above. */
export async function withSyncStateLock<T>(
  workspaceRoot: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = await acquireSyncStateLock(
    resolveSyncStatePath(workspaceRoot),
  );
  try {
    return await fn();
  } finally {
    await releaseSyncStateLock(lockPath);
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
