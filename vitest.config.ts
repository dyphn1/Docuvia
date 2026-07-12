import { defineConfig, coverageConfigDefaults } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
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
        "**/*.crash-fixture.ts",
        "**/types.ts",
        "**/constants.ts",
        "scripts/**",
        "lib/ui-core/src/docuvia-api.ts",
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
