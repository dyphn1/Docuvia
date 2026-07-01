// @ts-nocheck
import { describe, it, expect, vi } from "vitest";

// Mock the migrator to avoid actually running migrations during test
vi.mock("drizzle-orm/postgres-js/migrator", () => ({
  migrate: vi.fn().mockResolvedValue(undefined),
}));

describe("migrate script", () => {
  it("runs migrations successfully", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);

    await import("./migrate.ts");

    // Give it time to resolve promises
    await new Promise((r) => setTimeout(r, 500));

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
