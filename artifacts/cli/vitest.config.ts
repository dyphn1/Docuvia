import { defineConfig } from "vitest/config";

/**
 * Issue #230 follow-up — the `docuvia` CLI project runs its files **one at a time**.
 *
 * `test/integration/**` drives real CLI subprocesses (`TestSandbox.runCli`), real `git init`/
 * `commit`, and real `local.db` handles. Run in parallel with each other these oversubscribe the
 * machine and lose races that have nothing to do with the code under test: five consecutive
 * pre-push runs failed on five *different* files (php/python preflight, git-local-provider,
 * fast-import, init-cli-mcp-symmetry, uninstall), two of them with "Hook timed out in 10000ms",
 * which no `--testTimeout` can reach. The pre-push hook is this repo's real gate (CI is
 * Linux-only), so a gate that fails on a random file each run is worse than no gate.
 *
 * Serializing within the project removes the contention at its source rather than absorbing it
 * into ever-larger budgets — each raised budget only moved which file lost the race. Package
 * projects still run in parallel with one another, so the suite as a whole does not go serial.
 *
 * `lib/git-local` and `lib/core` carry the same setting for the same reason; see their configs.
 */
export default defineConfig({
  test: {
    name: "docuvia",
    fileParallelism: false,
  },
});
