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
      ],
      reportsDirectory: "coverage",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
        statements: 85,
        "artifacts/kg-engine/src/**/*.{ts,tsx}": {
          lines: 70,
          branches: 70,
          functions: 70,
          statements: 70,
        },
      },
    },
  },
});
