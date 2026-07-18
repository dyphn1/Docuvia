import fs from "node:fs/promises";
import path from "node:path";
import {
  acquireProcessLock,
  DOCUVIA_DIR_NAME,
  INIT_COMMAND_LOCK_FILE_NAME,
} from "@workspace/contracts";

/**
 * Whole-command single-flight lock (PLAT-006) — a second concurrent `init` on the same workspace
 * waits here instead of re-running every phase concurrently with the first. Generous relative to
 * `acquireInitLock`'s DB-bootstrap-only 10s wait: this scope includes file discovery + AST
 * parsing, which can run for minutes on a large repo.
 *
 * Shared by every `init` entry point (CLI `docuvia init`, the `docuvia_init` MCP tool) so PLAT-006's
 * "one lockfile guards the entire init command" promise actually holds across all of them — a gap
 * found 2026-07-18 (the MCP tool called `docuviaApi.init()` directly, unlocked) is exactly the
 * concurrent-AI-agent-integration scenario PLAT-006's own Advice section names as the realistic
 * trigger.
 */
const INIT_COMMAND_LOCK_MAX_WAIT_MS = 30 * 60_000;
const INIT_COMMAND_LOCK_HEARTBEAT_MS = 10_000;
const INIT_COMMAND_LOCK_STALE_MS = 30_000;

/** Runs `fn` under the PLAT-006 `init`-command lock for `cwd`, releasing it (best-effort) even if
 *  `fn` throws. `onWaiting`, if given, fires once if this call has to wait for another holder. */
export async function withInitCommandLock<T>(
  cwd: string,
  fn: () => Promise<T>,
  onWaiting?: () => void,
): Promise<T> {
  const lockPath = path.join(
    cwd,
    DOCUVIA_DIR_NAME,
    INIT_COMMAND_LOCK_FILE_NAME,
  );
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const lock = await acquireProcessLock(lockPath, {
    maxWaitMs: INIT_COMMAND_LOCK_MAX_WAIT_MS,
    heartbeatIntervalMs: INIT_COMMAND_LOCK_HEARTBEAT_MS,
    staleAfterMs: INIT_COMMAND_LOCK_STALE_MS,
    onWaiting,
  });
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
