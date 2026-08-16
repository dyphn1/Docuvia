import { defineConfig } from "vitest/config";

/**
 * Root-level (cross-package) test project — hosts repo-wide regression tests such as
 * `test/layer-boundary.test.ts` (issue #30's layer-boundary eslint config guard). Mirrors the
 * per-package project convention (`lib/*`, `artifacts/*`) so `pnpm run test` picks it up too.
 */
export default defineConfig({
  test: {
    name: "root",
    include: ["**/*.test.ts"],
  },
});
