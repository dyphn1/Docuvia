import { describe, it, expect, afterEach, vi } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { AstWorkerPool, AstWorkerCrashError } from "./ast-worker-pool.js";
import { CRASH_SENTINEL_FILE_PATH } from "./ast-worker-pool.crash-fixture.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRASH_FIXTURE_WORKER_PATH = path.resolve(__dirname, "./ast-worker-pool.crash-fixture.ts");

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

  it("attributes a worker crash to the specific file being parsed, not an adjacent one", async () => {
    // workerCount: 1 makes this deterministic — a single worker, one task in flight at a time.
    pool = new AstWorkerPool(30_000, undefined, CRASH_FIXTURE_WORKER_PATH);
    await pool.initialize(1);

    await expect(
      pool.parse({ filePath: CRASH_SENTINEL_FILE_PATH, code: "", language: "typescript" })
    ).rejects.toMatchObject({
      name: "AstWorkerCrashError",
      filePath: CRASH_SENTINEL_FILE_PATH,
    });
  }, 15000);

  it("respawns a worker after a crash and continues serving subsequent tasks", async () => {
    pool = new AstWorkerPool(30_000, undefined, CRASH_FIXTURE_WORKER_PATH);
    await pool.initialize(1);

    await expect(
      pool.parse({ filePath: CRASH_SENTINEL_FILE_PATH, code: "", language: "typescript" })
    ).rejects.toBeInstanceOf(AstWorkerCrashError);

    // Matches the audit's observation that the pool *does* respawn (13 crashes, but the
    // run still completed) — a subsequent, healthy parse must still resolve successfully.
    const response = await pool.parse({
      filePath: "healthy-file.ts",
      code: "",
      language: "typescript",
    });
    expect(response.success).toBe(true);
  }, 15000);

  it("does not leak taskFilePaths entries across successful parses", async () => {
    pool = new AstWorkerPool(30_000, undefined, CRASH_FIXTURE_WORKER_PATH);
    await pool.initialize(1);

    for (const file of ["a.ts", "b.ts", "c.ts"]) {
      await pool.parse({ filePath: file, code: "", language: "typescript" });
    }

    expect((pool as any).taskFilePaths.size).toBe(0);
  }, 15000);

  it("does not log idle workers stopped by terminate() as crashes", async () => {
    // Regression guard for the real root cause behind the "13 AstWorkerPool crashes"
    // documented in docs/analysis/docuvia-cli-vs-gitnexus-2026-07-10.md: verified directly
    // that Node reports worker.terminate() on an idle, never-used worker as exit code 1 —
    // the pool used to treat every non-zero exit as a crash regardless of *why* the worker
    // exited, so its own normal shutdown was self-reporting as a wave of crashes.
    pool = new AstWorkerPool(30_000, undefined, CRASH_FIXTURE_WORKER_PATH);
    await pool.initialize(3);

    const errorSpy = vi.spyOn(logger, "error");
    await pool.terminate();
    // Give the "exit" events from the forcefully terminated workers a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const crashLogs = errorSpy.mock.calls.filter(([, msg]) => msg === "AST worker crashed/exited");
    expect(crashLogs).toHaveLength(0);

    errorSpy.mockRestore();
    pool = undefined; // already terminated, skip afterEach's second terminate()
  }, 15000);
});
