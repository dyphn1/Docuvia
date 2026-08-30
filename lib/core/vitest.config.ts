import { defineConfig } from "vitest/config";

/**
 * Issue #230 follow-up — `@workspace/core` runs its files **one at a time**.
 *
 * 29 of this package's 56 test files live under `src/lsp/`, and they spawn `npx` and probe PATH
 * for language-server binaries (`php-lsp-preflight`, `python-lsp-preflight`,
 * `python-lsp-edge-provider` were all repeat pre-push offenders). Process-spawn latency under a
 * loaded machine is exactly what blew their `beforeEach` past the 10s hook budget.
 *
 * Serialized at package granularity rather than by excluding `src/lsp/**` into a separate
 * project: a Vitest workspace entry pointing at a standalone config file is not picked up as a
 * project here (verified — the lane silently matched zero files, which looks indistinguishable
 * from "everything passed"), whereas a per-package `vitest.config.ts` is the pattern this repo
 * already relies on. See `artifacts/cli/vitest.config.ts` for the full rationale.
 */
export default defineConfig({
  test: {
    name: "@workspace/core",
    fileParallelism: false,
  },
});
