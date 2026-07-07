import { describe, it, expect, afterEach } from "vitest";
import { AstWorkerPool } from "./ast-worker-pool.js";

describe("AstWorkerPool CALL edge extraction", () => {
  let pool: AstWorkerPool | undefined;

  afterEach(async () => {
    if (pool) {
      await pool.terminate();
      pool = undefined;
    }
  });

  it("populates calls[] for a TypeScript function that calls another function", async () => {
    pool = new AstWorkerPool();
    await pool.initialize(1);

    const response = await pool.parse({
      filePath: "regression-fixture.ts",
      code: [
        "function helper() {",
        "  return 42;",
        "}",
        "",
        "function caller() {",
        "  return helper();",
        "}",
      ].join("\n"),
      language: "typescript",
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual(expect.any(Object));
    // Regression guard for Issue 0 (§0 of the 2026-07-04 gitbook audit): the ast-worker
    // capture switch previously had no "call" case, so calls[] was always empty and zero
    // CALL edges were ever created project-wide. Fixed in commit 1c92234.
    expect(response.data!.calls.length).toBeGreaterThan(0);
    expect(response.data!.calls).toContainEqual({
      sourceFunction: "caller",
      targetFunction: "helper",
    });
  }, 15000);

  it("terminate() does not respawn replacement workers", async () => {
    pool = new AstWorkerPool();
    await pool.initialize(2);

    await pool.terminate();
    // Give any (incorrect) respawn-on-exit handling a chance to run before asserting.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect((pool as any).workers.length).toBe(0);
    expect((pool as any).workerQueue.length).toBe(0);

    pool = undefined; // already terminated, skip afterEach's second terminate()
  }, 15000);
});
