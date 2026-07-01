import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "artifacts/kg-engine/src"),
    },
  },
  test: {
    server: {
      deps: {
        external: [/execa/],
      },
    },
    include: [
      "artifacts/*/test/**/*.test.{ts,tsx}",
      "artifacts/*/src/**/*.unit.test.{ts,tsx}",
      "lib/**/*.unit.test.{ts,tsx}",
    ],
    environment: "node",
    setupFiles: ["artifacts/api-server/test/setup/setup.ts"],
    coverage: {
      include: [
        "artifacts/api-server/src/**/*.ts",
        "artifacts/kg-engine/src/**/*.{ts,tsx}",
        "lib/db/src/**/*.ts",
      ],
      exclude: [
        "**/dist/**",
        "**/node_modules/**",
        "lib/api-client-react/src/generated/**",
        "lib/api-zod/src/generated/**",
        "artifacts/api-server/src/examples/**",
        "artifacts/api-server/src/lib/ast/**",
        "artifacts/api-server/src/proxy/**",
        "artifacts/api-server/src/memory/**",
        "artifacts/api-server/src/routes/generate.ts",
        "artifacts/api-server/src/routes/ingest.ts",
        "artifacts/api-server/src/routes/github_webhooks.ts",
        "artifacts/api-server/src/routes/metabolism.ts",
        "artifacts/kg-engine/src/components/**",
        "artifacts/kg-engine/src/pages/**",
        "artifacts/kg-engine/src/hooks/**",
      ],
      reportsDirectory: "coverage",
      reporter: ["text", "json", "html"],
    },
  },
});
