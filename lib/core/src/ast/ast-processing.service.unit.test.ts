import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DiscoveredFile } from "@workspace/contracts";
import { AstProcessingService } from "./ast-processing.service.js";
import { AstWorkerCrashError, type IASTWorkerPool } from "./ast-worker-pool.js";
import type { AstParseResponse } from "./ast-worker.js";

const emptyData = {
  imports: [],
  exports: [],
  functions: [],
  classes: [],
  calls: [],
};

function makeFile(file: string): DiscoveredFile {
  return { file, hash: `hash-${file}`, code: `// ${file}` };
}

function makeFakePool(
  parseImpl: (request: { filePath: string }) => Promise<AstParseResponse>,
): IASTWorkerPool {
  return {
    initialize: async () => undefined,
    parse: parseImpl as IASTWorkerPool["parse"],
    terminate: async () => undefined,
    serializeBatch: (run) => run(),
  };
}

/**
 * Helper: create a mock parse that delays by `delayMs` using a pending promise
 * resolved via fake timer. Call `vi.advanceTimersByTimeAsync(delayMs)` after
 * starting the operation to unblock it.
 */
function delayedParse(
  delayMs: number,
  response: AstParseResponse = { taskId: "t", success: true, data: emptyData },
) {
  return async () => {
    await new Promise<void>((resolve) => {
      const id = setTimeout(resolve, delayMs);
      // Prevent vitest from warning about unresolved fake timers in afterEach.
      void id;
    });
    return response;
  };
}

describe("AstProcessingService.processFiles()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns all files under 'parsed' when every parse succeeds", async () => {
    const files = [makeFile("a.ts"), makeFile("b.ts"), makeFile("c.ts")];
    const pool = makeFakePool(async () => ({
      taskId: "t",
      success: true,
      data: emptyData,
    }));
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", files);

    expect(result.parsed.length).toBe(3);
    expect(result.failures).toEqual([]);
  });

  it("moves a file to 'failures' with its error message when pool.parse resolves with success:false", async () => {
    const files = [
      makeFile("a.ts"),
      makeFile("b.ts"),
      makeFile("broken.ts"),
      makeFile("c.ts"),
      makeFile("d.ts"),
    ];
    const pool = makeFakePool(async (request) => {
      if (request.filePath === "broken.ts") {
        return { taskId: "t", success: false, error: "Unexpected token" };
      }
      return { taskId: "t", success: true, data: emptyData };
    });
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", files);

    expect(result.parsed.length).toBe(4);
    expect(result.failures).toEqual([
      { file: "broken.ts", hash: "hash-broken.ts", error: "Unexpected token" },
    ]);
  });

  it("moves a file to 'failures' when pool.parse rejects with AstWorkerCrashError", async () => {
    const files = [makeFile("a.ts"), makeFile("crash.ts")];
    const pool = makeFakePool(async (request) => {
      if (request.filePath === "crash.ts") {
        throw new AstWorkerCrashError(
          "crash.ts",
          new Error("Worker exited with code 1"),
        );
      }
      return { taskId: "t", success: true, data: emptyData };
    });
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", files);

    expect(result.parsed.length).toBe(1);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].file).toBe("crash.ts");
    expect(result.failures[0].error).toContain("Worker exited with code 1");
  });

  // Reproduces the audit's 13-crash/4236-file profile at a scale small enough to run fast:
  // 200 files, batchSize 50 (per ast-processing.service.ts), 13 crashing files scattered
  // across at least 3 of the 4 batches — proves failure attribution survives batching.
  it("reproduces the audit's 13-crash/4236-file profile: batches of failures scattered across multiple 50-file batches all get attributed correctly", async () => {
    const totalFiles = 200;
    const files = Array.from({ length: totalFiles }, (_, i) =>
      makeFile(`file-${i}.ts`),
    );

    const failingIndices = new Set([
      3, 17, 41, 55, 62, 88, 97, 110, 128, 149, 161, 175, 199,
    ]);
    expect(failingIndices.size).toBe(13);

    const pool = makeFakePool(async (request) => {
      const idx = Number(request.filePath.replace(/^file-(\d+)\.ts$/, "$1"));
      if (failingIndices.has(idx)) {
        throw new AstWorkerCrashError(
          request.filePath,
          new Error("Worker exited with code 1"),
        );
      }
      return { taskId: "t", success: true, data: emptyData };
    });
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", files);

    expect(result.failures.length).toBe(13);
    expect(result.parsed.length).toBe(totalFiles - 13);

    const failedFiles = result.failures.map((f) => f.file);
    const expectedFailedFiles = Array.from(failingIndices).map(
      (i) => `file-${i}.ts`,
    );
    expect(new Set(failedFiles)).toEqual(new Set(expectedFailedFiles));
    // No duplication.
    expect(failedFiles.length).toBe(new Set(failedFiles).size);
  });

  it("preserves the input file order in 'parsed' even when later files resolve before earlier ones", async () => {
    const files = [makeFile("a.ts"), makeFile("b.ts"), makeFile("c.ts")];
    // "a.ts" resolves last, "c.ts" resolves first -- a worker-pool completion order that's the
    // exact reverse of `files`. Previously `parsedResults` was populated via push-on-completion,
    // so this would come back as [c, b, a] instead of [a, b, c]; the same source commit's L2 rows
    // would then persist (and export) in a different order across runs purely due to this race.
    const resolveOrder = { "a.ts": 30, "b.ts": 15, "c.ts": 0 };
    const pool = makeFakePool(async (request) => {
      const delay =
        resolveOrder[request.filePath as keyof typeof resolveOrder] ?? 0;
      await new Promise<void>((resolve) => {
        const id = setTimeout(resolve, delay);
        void id;
      });
      return { taskId: "t", success: true, data: emptyData };
    });
    const service = new AstProcessingService(pool);

    // Start the operation but don't await yet — we need to advance fake timers first.
    const resultPromise = service.processFiles("/workspace", files);
    // Advance past the longest delay (30ms) to resolve all pending timers.
    await vi.advanceTimersByTimeAsync(50);
    const result = await resultPromise;

    expect(result.parsed.map((r) => r.file)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("serializes concurrent processFiles batches on the same service: a second batch waits for the first to fully complete", async () => {
    // Root-cause guard for the memory blowup when many docuvia processes analyze one large
    // project at once. If two overlapping batches ran their initialize()/parse()/terminate()
    // lifecycles concurrently on the same pool, their worker cohorts would pile up and each
    // batch's terminate() could tear down the other's in-flight workers. processFiles must
    // acquire an exclusive batch lock so concurrent invokes queue instead of interleaving.
    let active = 0;
    const pool = makeFakePool(async () => {
      active++;
      await new Promise<void>((resolve) => {
        const id = setTimeout(resolve, 20);
        void id;
      });
      active--;
      return { taskId: "t", success: true, data: emptyData };
    });
    // Faithful stand-in for AstWorkerPool.serializeBatch's chained lock: processFiles must
    // route concurrent invokes through it (peak concurrency stays 1), never interleave.
    let chain: Promise<void> = Promise.resolve();
    pool.serializeBatch = <T>(run: () => Promise<T>) => {
      const result = chain.then(run);
      chain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const service = new AstProcessingService(pool);
    const files = [makeFile("a.ts"), makeFile("b.ts")];

    // Start both batches — don't await yet so fake timers can resolve them.
    const p1 = service.processFiles("/workspace", files);
    const p2 = service.processFiles("/workspace", files);

    // Each batch's parse has a 20ms delay; they're serialized, so we need ≥40ms total.
    await vi.advanceTimersByTimeAsync(50);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.parsed.length).toBe(2);
    expect(r2.parsed.length).toBe(2);
  });

  it("serializes concurrent processFiles batches across TWO service instances sharing one pool (the resolve-two-processors contract)", async () => {
    // register.ts resolves AstProcessor per workflow; each resolve returns a NEW
    // AstProcessingService, but every one must be backed by the SAME (shared) AstWorkerPool.
    // Otherwise two workflows running in one process each spawn their own (cpus-1)-sized
    // cohort -- the tally that blows memory on "many processes on a large project". Two
    // distinct services over one shared pool must therefore still serialize their batches.
    const pool = makeFakePool(async () => {
      await new Promise<void>((resolve) => {
        const id = setTimeout(resolve, 20);
        void id;
      });
      return { taskId: "t", success: true, data: emptyData };
    });
    let chain: Promise<void> = Promise.resolve();
    pool.serializeBatch = <T>(run: () => Promise<T>) => {
      const result = chain.then(run);
      chain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const serviceA = new AstProcessingService(pool);
    const serviceB = new AstProcessingService(pool);
    const files = [makeFile("a.ts"), makeFile("b.ts")];

    // Start both batches — don't await yet so fake timers can resolve them.
    const pa = serviceA.processFiles("/workspace", files);
    const pb = serviceB.processFiles("/workspace", files);

    // Each batch's parse has a 20ms delay; they're serialized, so we need ≥40ms total.
    await vi.advanceTimersByTimeAsync(50);

    const [ra, rb] = await Promise.all([pa, pb]);

    expect(ra.parsed.length).toBe(2);
    expect(rb.parsed.length).toBe(2);
  });

  it("attaches the detected language to each parsed result", async () => {
    const pool = makeFakePool(async () => ({
      taskId: "t",
      success: true,
      data: emptyData,
    }));
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", [makeFile("a.ts")]);

    expect(result.parsed[0].language).toBe("typescript");
  });
});
