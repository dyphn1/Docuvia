import { describe, it, expect } from "vitest";
import { NodeProcessProvider } from "./process-provider.js";

describe("NodeProcessProvider", () => {
  it("returns an environment snapshot instead of the mutable process.env object (issue #439)", () => {
    const provider = new NodeProcessProvider();
    const key = `DOCUVIA_PROCESS_PROVIDER_TEST_${Date.now()}`;

    process.env[key] = "original";
    try {
      const env = provider.env;
      env[key] = "mutated-through-provider";

      expect(process.env[key]).toBe("original");
      expect(provider.env).not.toBe(process.env);
    } finally {
      delete process.env[key];
    }
  });
});
