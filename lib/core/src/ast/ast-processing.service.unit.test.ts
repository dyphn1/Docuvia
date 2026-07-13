import { describe, it, expect } from "vitest";
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
  };
}

describe("AstProcessingService.processFiles()", () => {
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
