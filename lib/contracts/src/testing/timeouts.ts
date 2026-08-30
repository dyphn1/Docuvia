/**
 * The single wall-clock budget for tests and hooks that drive **real** subprocesses — `git`
 * shell-outs, spawned CLI processes, `npx` probes for language-server binaries, SQLite handles.
 *
 * One constant, not a per-file literal, because every one of these sites is the same fact: "this
 * work spawns processes, so it is bounded by machine load, not by the code under test." When that
 * fact needs a bigger number, it needs a bigger number *everywhere* — a value tuned file-by-file
 * is what produced a pre-push gate that failed on a different random file each run.
 *
 * Sized from measurement and deliberately generous: under a full parallel `vitest run` on Windows,
 * `uninstall.test.ts`'s four tests took 45.8s wall-clock and `init-cli-mcp-symmetry.ts`'s two took
 * 55.5s, while each passes in ~5s alone; `git-local-provider.integration.test.ts` has been measured
 * at 78s. **A timeout here should mean "genuinely hung", never "the machine was busy."**
 */
export const SUBPROCESS_TEST_TIMEOUT_MS = 120_000;

/**
 * The same budget shaped for a `vitest.config.ts`'s `test` block.
 *
 * Every workspace project that has its own config file MUST spread this in. Measured: a Vitest
 * workspace project inherits nothing from the root — not the root config's options, and not the
 * root command's CLI flags either. A 12s `beforeEach` probe run as
 * `vitest run <probe> --hookTimeout=30000` still died at "Hook timed out in 10000ms" (vitest's
 * default) until the budget was restated in the project's own config. The
 * `--testTimeout`/`--hookTimeout` flags on the root `test` script are therefore inert; these
 * options are the only ones that reach a project.
 *
 * `hookTimeout` is a SEPARATE budget from `testTimeout` and is not raised by it, so both are set.
 */
export const SUBPROCESS_PROJECT_TIMEOUTS = {
  testTimeout: SUBPROCESS_TEST_TIMEOUT_MS,
  hookTimeout: SUBPROCESS_TEST_TIMEOUT_MS,
} as const;
