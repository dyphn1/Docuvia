import { defineConfig, coverageConfigDefaults } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: true,
    /**
     * NOTE: do not add `testTimeout`/`hookTimeout` (or other per-test options) here expecting the
     * `lib/*` / `artifacts/*` projects to pick them up. Vitest workspaces do not inherit them:
     * "None of the configuration options are inherited from the root-level config file"
     * (https://v1.vitest.dev/guide/workspace.html). Verified empirically — with `testTimeout:
     * 30000` set in this file, a 6s probe test under `lib/git-local` still failed with "Test timed
     * out in 5000ms". The suite-wide timeouts therefore live on the `test` script in the root
     * package.json, next to `--coverage`, which is global for the same reason.
     *
     * `--hookTimeout` is a SEPARATE budget from `--testTimeout` and defaults to 10s regardless of
     * what `--testTimeout` is set to. Both must be passed: `git-local-provider.integration.test.ts`
     * failed the pre-push gate with "Hook timed out in 10000ms" while `--testTimeout=30000` was
     * already in place, because its `beforeEach` shells out to real `git` and exceeds 10s under the
     * full suite's parallel load. Keep the two flags together wherever either appears (the `test`
     * script and lint-staged's `vitest related`).
     *
     * CORRECTION: the CLI flags are NOT global either. A project that has its own
     * `vitest.config.ts` ignores them exactly as it ignores this file's options -- measured with a
     * 12s `beforeEach` probe under `lib/git-local`, which failed at "Hook timed out in 10000ms"
     * (vitest's default) while `pnpm test` was passing `--hookTimeout=30000`, and passed once the
     * budgets were restated in that project's own config. This is why the pre-push gate kept
     * failing on a different random file per run even after `fileParallelism: false` landed:
     * serializing removed the contention, but the three serialized projects were still running on
     * the 10s default. `artifacts/cli`, `lib/core` and `lib/git-local` now each restate
     * `testTimeout`/`hookTimeout`. Any NEW project config must do the same -- the root flags will
     * not cover it.
     */
    coverage: {
      provider: "v8",
      clean: false,
      reporter: ["text", "json", "html"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "**/index.ts",
        "**/*-result.ts",
        "**/*-messages.ts",
        "**/*-interfaces.ts",
        "**/*.interfaces.ts",
        "**/*.crash-fixture.ts",
        "**/types.ts",
        "**/constants.ts",
        "scripts/**",
        "lib/ui-core/src/docuvia-api.ts",
        "artifacts/cli/src/cli.ts",
        "lib/core/src/ast/ast-worker.js",
        "lib/core/src/ast/ast-worker.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
