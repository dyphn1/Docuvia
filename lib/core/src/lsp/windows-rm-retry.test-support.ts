import fs from "node:fs";
import {
  PLATFORM_WIN32,
  ERRNO_EPERM,
  ERRNO_EACCES,
  ERRNO_EBUSY,
} from "@workspace/contracts";

/** Test-only cleanup helper (never imported by production code, never exported from this
 *  package's public barrel). A preflight/edge-provider test that exercises the real npx-fallback
 *  probe (no local `node_modules/.bin` copy) now spawns a genuine child process (`where` + a
 *  shell-wrapped `npx`, see `windows-shell-spawn.ts`) with the test's own temp dir as `cwd`. On
 *  Windows, the OS can briefly keep a lock on a just-exited child process's working directory
 *  after the awaited command has already settled, so a bare `fs.rmSync` in `afterEach`/`finally`
 *  occasionally throws `EPERM` even though the test's own assertions already passed -- a cleanup
 *  race, not a correctness failure. Retries past that race instead of failing the test over it. */
export async function rmSyncRetrying(
  target: string,
  attempts = 30,
  initialDelayMs = 100,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === attempts) {
        const code = (err as NodeJS.ErrnoException).code;
        if (
          process.platform === PLATFORM_WIN32 &&
          (code === ERRNO_EPERM ||
            code === ERRNO_EACCES ||
            code === ERRNO_EBUSY)
        ) {
          console.warn(
            `[rmSyncRetrying] Ignoring transient Windows temp dir cleanup error (${code}) for ${target}`,
          );
          return;
        }
        throw err;
      }
      // Backs off up to ~1s per step (capped) rather than a fixed short delay -- under full-suite
      // concurrent load, releasing the lock on a process-tree's working directory (cmd.exe's own
      // node.exe child, which npx itself may re-spawn a grandchild node.exe under) can take longer
      // than a single short wait; live-observed still failing after 5 attempts at a flat 100ms.
      const delay = Math.min(initialDelayMs * attempt, 1000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
