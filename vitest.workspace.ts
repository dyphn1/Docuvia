import { defineWorkspace } from "vitest/config";

import path from "path";

export default defineWorkspace([
  {
    test: {
      name: "node-backend",
      environment: "node",
      include: [
        "artifacts/api-server/test/**/*.test.{ts,tsx}",
        "artifacts/api-server/src/**/*.unit.test.{ts,tsx}",
        "artifacts/cli/test/**/*.test.{ts,tsx}",
        "artifacts/cli/src/**/*.unit.test.{ts,tsx}",
        "lib/*/test/**/*.test.{ts,tsx}",
        "lib/**/*.unit.test.{ts,tsx}",
      ],
      setupFiles: ["artifacts/api-server/test/setup/setup.ts"],
    },
  },
  {
    test: {
      name: "react-frontend",
      environment: "happy-dom",
      globals: true,
      include: [
        "artifacts/kg-engine/test/**/*.test.{ts,tsx}",
        "artifacts/kg-engine/src/**/*.unit.test.{ts,tsx}",
      ],
      setupFiles: ["artifacts/kg-engine/test/setup.ts"],
      alias: {
        "@": path.resolve(__dirname, "artifacts/kg-engine/src"),
      },
    },
    esbuild: {
      jsx: "automatic",
    },
  },
]);
