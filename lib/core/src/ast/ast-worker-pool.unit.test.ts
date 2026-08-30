import { describe, it, expect, afterEach, vi } from "vitest";
import { Worker } from "worker_threads";
import * as path from "path";
import { fileURLToPath } from "url";
import { createMockLogger } from "@workspace/contracts";
import { AstWorkerPool, AstWorkerCrashError } from "./ast-worker-pool.js";
import { AstMessages } from "./ast-constants.js";
import { CRASH_SENTINEL_FILE_PATH } from "./ast-worker-pool.crash-fixture.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRASH_FIXTURE_WORKER_PATH = path.resolve(
  __dirname,
  "./ast-worker-pool.crash-fixture.ts",
);
const HANG_FIXTURE_WORKER_PATH = path.resolve(
  __dirname,
  "./ast-worker-pool.hang-fixture.ts",
);

describe("AstWorkerPool CALL edge extraction", () => {
  let pool: AstWorkerPool | undefined;

  afterEach(async () => {
    if (pool) {
      await pool.terminate();
      pool = undefined;
    }
  });

  it(
    "populates calls[] for a TypeScript function that calls another function",
    async () => {
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
      expect(response.data!.calls.length).toBeGreaterThanOrEqual(1);
      expect(response.data!.calls).toContainEqual(
        expect.objectContaining({
          sourceFunction: "caller",
          targetFunction: "helper",
        }),
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "terminate() does not respawn replacement workers",
    async () => {
      pool = new AstWorkerPool();
      await pool.initialize(2);

      await pool.terminate();
      // Give any (incorrect) respawn-on-exit handling a chance to run before asserting.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect((pool as any).workers.length).toBe(0);
      expect((pool as any).workerQueue.length).toBe(0);

      pool = undefined; // already terminated, skip afterEach's second terminate()
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "attributes a worker crash to the specific file being parsed, not an adjacent one",
    async () => {
      // workerCount: 1 makes this deterministic — a single worker, one task in flight at a time.
      pool = new AstWorkerPool(
        undefined,
        30_000,
        undefined,
        CRASH_FIXTURE_WORKER_PATH,
      );
      await pool.initialize(1);

      await expect(
        pool.parse({
          filePath: CRASH_SENTINEL_FILE_PATH,
          code: "",
          language: "typescript",
        }),
      ).rejects.toMatchObject({
        name: "AstWorkerCrashError",
        filePath: CRASH_SENTINEL_FILE_PATH,
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "respawns a worker after a crash and continues serving subsequent tasks",
    async () => {
      pool = new AstWorkerPool(
        undefined,
        30_000,
        undefined,
        CRASH_FIXTURE_WORKER_PATH,
      );
      await pool.initialize(1);

      await expect(
        pool.parse({
          filePath: CRASH_SENTINEL_FILE_PATH,
          code: "",
          language: "typescript",
        }),
      ).rejects.toBeInstanceOf(AstWorkerCrashError);

      // Matches the audit's observation that the pool *does* respawn (13 crashes, but the
      // run still completed) — a subsequent, healthy parse must still resolve successfully.
      const response = await pool.parse({
        filePath: "healthy-file.ts",
        code: "",
        language: "typescript",
      });
      expect(response.success).toBe(true);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it("still dispatches a task queued behind a crashing one to the respawned worker", async () => {
    // Regression guard: processQueue() used to shift only one task/worker pair per call, and
    // spawnWorker() never called it after pushing a freshly (re)spawned worker into
    // workerQueue. With workerCount 1, queuing a second task in the same tick as a crashing
    // one -- before the crash's respawn has run -- left that second task in taskQueue and the
    // respawned worker idle in workerQueue with nothing left to pair them: no further
    // "message" event was ever going to fire to trigger another processQueue() call.
    pool = new AstWorkerPool(
      undefined,
      30_000,
      undefined,
      CRASH_FIXTURE_WORKER_PATH,
    );
    await pool.initialize(1);

    const crashPromise = pool.parse({
      filePath: CRASH_SENTINEL_FILE_PATH,
      code: "",
      language: "typescript",
    });
    // Queued in the same tick, before the crash's respawn has had a chance to run.
    const healthyPromise = pool.parse({
      filePath: "healthy-file.ts",
      code: "",
      language: "typescript",
    });

    await expect(crashPromise).rejects.toBeInstanceOf(AstWorkerCrashError);
    const response = await healthyPromise;
    expect(response.success).toBe(true);
  }, 5000);

  it(
    "does not leak taskFilePaths entries across successful parses",
    async () => {
      pool = new AstWorkerPool(
        undefined,
        30_000,
        undefined,
        CRASH_FIXTURE_WORKER_PATH,
      );
      await pool.initialize(1);

      for (const file of ["a.ts", "b.ts", "c.ts"]) {
        await pool.parse({ filePath: file, code: "", language: "typescript" });
      }

      expect((pool as any).taskFilePaths.size).toBe(0);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "initialize() is idempotent: a second call does not stack another worker cohort",
    async () => {
      pool = new AstWorkerPool();
      await pool.initialize(2);
      expect((pool as any).workers.length).toBe(2);

      // Overlapping/repeated invokes on the same pool must not each spawn their own
      // (cpus-1)-sized cohort on top of the existing one -- that worker multiplication is
      // the memory-amplification root cause for "many processes on a large project".
      await pool.initialize(4);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((pool as any).workers.length).toBe(2);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "serializeBatch() runs concurrent batches strictly one-at-a-time",
    async () => {
      pool = new AstWorkerPool();
      await pool.initialize(2);

      let active = 0;
      let maxActive = 0;
      const batch = () => {
        return pool!.serializeBatch(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 25));
          active--;
        });
      };

      // Fire three batches in the same tick, exactly like overlapping docuvia processes would.
      await Promise.all([batch(), batch(), batch()]);

      // The chained lock must keep the worker lifecycle of all three batches serialized —
      // never more than one batch's parse/terminate round running at once.
      expect(maxActive).toBe(1);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "re-arms crash handling after terminate(): a reused pool still respawns after a crash",
    async () => {
      // Shared-pool reuse contract (register.ts now hands every AstProcessor the same pool):
      // batch 1 runs initialize->terminate, then batch 2 re-initializes the SAME pool. If
      // terminate() left `shuttingDown` permanently true, batch 2 would treat a real worker
      // crash as "exited during shutdown" and never respawn -- the next task would hang until
      // timeout. The crash must still surface AND the respawn must still happen.
      pool = new AstWorkerPool(
        undefined,
        30_000,
        undefined,
        CRASH_FIXTURE_WORKER_PATH,
      );
      await pool.initialize(1);
      await pool.terminate();

      await pool.initialize(1);
      await expect(
        pool.parse({
          filePath: CRASH_SENTINEL_FILE_PATH,
          code: "",
          language: "typescript",
        }),
      ).rejects.toBeInstanceOf(AstWorkerCrashError);

      const response = await pool.parse({
        filePath: "healthy-after-reuse.ts",
        code: "",
        language: "typescript",
      });
      expect(response.success).toBe(true);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "does not log idle workers stopped by terminate() as crashes",
    async () => {
      // Regression guard for the real root cause behind the "13 AstWorkerPool crashes"
      // documented in docs/analysis/docuvia-cli-vs-gitnexus-2026-07-10.md: verified directly
      // that Node reports worker.terminate() on an idle, never-used worker as exit code 1 —
      // the pool used to treat every non-zero exit as a crash regardless of *why* the worker
      // exited, so its own normal shutdown was self-reporting as a wave of crashes.
      const logger = createMockLogger();
      pool = new AstWorkerPool(
        logger,
        30_000,
        undefined,
        CRASH_FIXTURE_WORKER_PATH,
      );
      await pool.initialize(3);

      await pool.terminate();
      // Give the "exit" events from the forcefully terminated workers a chance to fire.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const crashLogs = logger.events.filter(
        (e) => e.level === "error" && e.message === "AST worker crashed/exited",
      );
      expect(crashLogs).toHaveLength(0);

      pool = undefined; // already terminated, skip afterEach's second terminate()
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "logs when worker.terminate() rejects during task-timeout teardown",
    async () => {
      // Issue #116: the forced-termination catch used to be empty, silently hiding a
      // failed resource release. A terminate() rejection is now observable via a warn log.
      const logger = createMockLogger();
      pool = new AstWorkerPool(
        logger,
        100,
        undefined,
        HANG_FIXTURE_WORKER_PATH,
      );
      await pool.initialize(1);

      // Make the forced terminate() reject — the hang fixture never responds, so the only
      // way this task can settle is through the timeout->terminate path.
      const terminateSpy = vi
        .spyOn(Worker.prototype, "terminate")
        .mockRejectedValue(new Error("forced termination failed"));

      const parsePromise = pool.parse({
        filePath: "hang.ts",
        code: "",
        language: "typescript",
      });

      // Wait for the timeout (100ms) + terminate rejection to be logged.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const terminateLogs = logger.events.filter(
        (e) => e.message === AstMessages.WORKER_TERMINATE_FAILED,
      );
      expect(terminateLogs).toHaveLength(1);
      expect(terminateLogs[0].level).toBe("warn");
      expect(terminateLogs[0].context).toEqual(
        expect.objectContaining({
          filePath: "hang.ts",
        }),
      );

      terminateSpy.mockRestore();
      pool = undefined; // terminate() was mocked to reject; let afterEach skip the second call
      // The parse promise never settles because the mock prevented the worker from exiting —
      // attach a no-op catch to keep the rejected path from surfacing as unhandled.
      parsePromise.catch(() => undefined);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
