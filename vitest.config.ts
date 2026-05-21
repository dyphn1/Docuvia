import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["artifacts/*/test/**/*.test.ts", "lib/**/*.unit.test.ts"],
    environment: "node",
    setupFiles: ["artifacts/api-server/test/setup/setup.ts"],
    coverage: {
      include: ["artifacts/*/src/**/*.{ts,tsx}", "lib/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/dist/**",
        "**/node_modules/**",
        "lib/api-client-react/src/generated/**",
        "lib/api-zod/src/generated/**",
      ],
      reportsDirectory: "coverage",
      reporter: ["text", "json", "html"],
    },
  },
});
