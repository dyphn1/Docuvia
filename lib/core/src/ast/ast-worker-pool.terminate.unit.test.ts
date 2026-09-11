import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import { AstWorkerPool } from "./ast-worker-pool.js";
import { AstMessages } from "./ast-constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANG_FIXTURE_WORKER_PATH = path.resolve(
  __dirname,
  "./ast-worker-pool.hang-fixture.ts",
);

describe("AstWorkerPool terminate()", () => {
  it(
    "rejects both in-flight and queued parse promises and clears task state",
    async () => {
      const pool = new AstWorkerPool(
        undefined,
        30_000,
        undefined,
        HANG_FIXTURE_WORKER_PATH,
      );
      await pool.initialize(1);

      const inFlight = pool.parse({
        filePath: "in-flight.ts",
        code: "",
        language: "typescript",
      });
      const queued = pool.parse({
        filePath: "queued.ts",
        code: "",
        language: "typescript",
      });
      // Attach handlers before terminate() rejects either promise so the test never creates an
      // unhandled-rejection race.
      const settled = Promise.allSettled([inFlight, queued]);

      await pool.terminate();
      const results = await settled;

      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(Error);
          expect((result.reason as Error).message).toBe(
            AstMessages.POOL_TERMINATED,
          );
        }
      }

      expect((pool as any).pendingTasks.size).toBe(0);
      expect((pool as any).taskQueue).toHaveLength(0);
      expect((pool as any).taskTimeouts.size).toBe(0);
      expect((pool as any).workerTasks.size).toBe(0);
      expect((pool as any).taskFilePaths.size).toBe(0);
      expect((pool as any).workers).toHaveLength(0);
      expect((pool as any).workerQueue).toHaveLength(0);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
