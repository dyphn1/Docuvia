import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.unit.test.{ts,tsx}"],
    environment: "node",
  },
});
