import { defineConfig } from "vitest/config";

import { SUBPROCESS_PROJECT_TIMEOUTS } from "@workspace/contracts/testing/timeouts";

/**
 * Issue #230 follow-up — `@workspace/git-local` runs its files **one at a time**.
 *
 * `git-local-provider.integration.test.ts` and `fast-import.unit.test.ts` shell out to real
 * `git` for essentially every case, including `beforeEach` fixture setup — which is why this
 * package produced both "Test timed out" and "Hook timed out in 10000ms" pre-push failures.
 * See `artifacts/cli/vitest.config.ts` for the full rationale; the same setting is on
 * `lib/core` for its LSP tests.
 */
export default defineConfig({
  test: {
    name: "@workspace/git-local",
    fileParallelism: false,
    ...SUBPROCESS_PROJECT_TIMEOUTS,
  },
});
