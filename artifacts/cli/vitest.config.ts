import { defineConfig } from "vitest/config";

import { SUBPROCESS_PROJECT_TIMEOUTS } from "@workspace/contracts/testing/timeouts";

const PHASE4_EVAL_MODE = "phase4-honesty";
const VITEST_MODE_FLAG = "--mode";
const PHASE4_EVAL_DEFINE_KEY = "import.meta.env.PHASE4_EVAL";

const isPhase4Eval = process.argv.some(
  (argument, index, argumentsList) =>
    (argument === VITEST_MODE_FLAG &&
      argumentsList[index + 1] === PHASE4_EVAL_MODE) ||
    argument === `${VITEST_MODE_FLAG}=${PHASE4_EVAL_MODE}`,
);

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
  // Vitest workspace projects retain MODE=test even when --mode is supplied. Convert the
  // cross-platform CLI argument into a test define so the corpus can opt in without shell env
  // assignment syntax such as VAR=value or its Windows-specific counterpart.
  define: {
    [PHASE4_EVAL_DEFINE_KEY]: JSON.stringify(isPhase4Eval),
  },
  test: {
    name: "docuvia",
    fileParallelism: false,
    ...SUBPROCESS_PROJECT_TIMEOUTS,
  },
});
