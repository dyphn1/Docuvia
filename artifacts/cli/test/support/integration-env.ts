import { rmSync } from "fs";

/**
 * Shared timing/teardown primitives for integration tests that drive **real** subprocesses,
 * git shell-outs and SQLite handles.
 *
 * Both exports exist for the same reason: these tests are correct in isolation but flake under
 * the full suite's parallel load — the pre-push hook (`pnpm run test`) is this repo's real gate
 * because CI is Linux-only, so a gate that fails on a different random file each run is worse
 * than no gate. The failures were never assertion failures; they were wall-clock budgets and
 * Windows file-locking, i.e. environment, not behavior.
 */

/**
 * Per-test budget for a test that spawns real CLI subprocesses or runs a full `init`.
 *
 * Re-exported, not redefined: this is the same fact as every other subprocess budget in the repo
 * (including the ones in each project's `vitest.config.ts`), so it has exactly one definition —
 * `SUBPROCESS_TEST_TIMEOUT_MS` in `@workspace/contracts/testing/timeouts`. The alias is kept
 * because this name is already imported across this package's integration suite.
 */
export { SUBPROCESS_TEST_TIMEOUT_MS as REAL_SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

/**
 * Removes a test's temp directory, tolerating Windows' mandatory file locking.
 *
 * `rmSync(dir, { recursive: true, force: true })` is NOT enough on Windows: `force` only
 * suppresses ENOENT, so a directory still held by a just-exited child process (git, or a
 * better-sqlite3 handle whose finalizer has not run) throws EPERM and fails the test in
 * `afterEach` — after the assertions already passed. Node's `maxRetries`/`retryDelay` exist for
 * exactly this race.
 *
 * A cleanup failure is still never a test failure: the OS reclaims `os.tmpdir()`, so this warns
 * instead of throwing — the same contract `TestSandbox.teardown()` already uses.
 */
export function removeTempDir(dir: string | undefined): void {
  if (!dir) return;
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (err) {
    process.emitWarning(
      `Failed to remove test temp dir ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
