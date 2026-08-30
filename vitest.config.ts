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
     * CORRECTION (supersedes the paragraph above, and the first version of this one). The two CLI
     * flags do NOT behave the same way. Measured with probe tests, four cases:
     *
     *                     | project WITHOUT its own config | project WITH its own config
     *   --testTimeout     | applies  (8s test passed,       | OVERRIDES the config (40s test died
     *                     |           default is 5s)        | at 30000 despite config's 120000)
     *   --hookTimeout     | inert    (12s hook died at      | inert (40s hook passed on the
     *                     |           10000, the default)   | config's 120000)
     *
     * So `--hookTimeout` never reaches anything, while `--testTimeout` reaches everything and
     * CLAMPS a project config that asks for more. That asymmetry is why the gate kept failing on a
     * different random file per run even after `fileParallelism: false` and the per-project budgets
     * landed: serializing removed the contention, the project configs fixed the hook budget, and
     * `--testTimeout=30000` then silently held every *test* budget down to 30s regardless.
     *
     * Both flags are therefore pinned to the same value as
     * `SUBPROCESS_TEST_TIMEOUT_MS` (`@workspace/contracts/testing/timeouts`), which the three
     * project configs spread in. They are duplicated as literals in package.json only because a
     * JSON script line cannot import a TS constant -- if that constant changes, change them too.
     * Any NEW project config must still restate the budgets: the root flags cover `testTimeout`
     * but never `hookTimeout`.
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
