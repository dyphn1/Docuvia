import { describe, it, expect, vi } from "vitest";
import { AstProcessingService } from "./ast-processing.service.js";
import { AstWorkerCrashError, IASTWorkerPool } from "./ast-worker-pool.js";
import { DiscoveredFile } from "../interfaces/analyzer.interfaces.js";
import type { AstParseResponse } from "../workers/ast-worker.js";

const emptyData = { imports: [], exports: [], functions: [], classes: [], calls: [] };

function makeFile(file: string): DiscoveredFile {
  return { file, hash: `hash-${file}`, code: `// ${file}` };
}

function makeFakePool(
  parseImpl: (request: { filePath: string }) => Promise<AstParseResponse>
): IASTWorkerPool {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    parse: vi.fn().mockImplementation(parseImpl),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AstProcessingService.processFiles()", () => {
  it("returns all files under 'parsed' when every parse succeeds", async () => {
    const files = [makeFile("a.ts"), makeFile("b.ts"), makeFile("c.ts")];
    const pool = makeFakePool(async (request) => ({
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
        throw new AstWorkerCrashError("crash.ts", new Error("Worker exited with code 1"));
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
    const files = Array.from({ length: totalFiles }, (_, i) => makeFile(`file-${i}.ts`));

    // 13 failing indices spread across batch 0 (0-49), batch 1 (50-99), batch 2 (100-149),
    // and batch 3 (150-199) — not clustered in one batch.
    const failingIndices = new Set([3, 17, 41, 55, 62, 88, 97, 110, 128, 149, 161, 175, 199]);
    expect(failingIndices.size).toBe(13);

    const pool = makeFakePool(async (request) => {
      const idx = Number(request.filePath.replace(/^file-(\d+)\.ts$/, "$1"));
      if (failingIndices.has(idx)) {
        throw new AstWorkerCrashError(request.filePath, new Error("Worker exited with code 1"));
      }
      return { taskId: "t", success: true, data: emptyData };
    });
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", files);

    expect(result.failures.length).toBe(13);
    expect(result.parsed.length).toBe(totalFiles - 13);

    const failedFiles = result.failures.map((f) => f.file);
    const expectedFailedFiles = Array.from(failingIndices).map((i) => `file-${i}.ts`);
    expect(new Set(failedFiles)).toEqual(new Set(expectedFailedFiles));
    // No duplication.
    expect(failedFiles.length).toBe(new Set(failedFiles).size);
  });
});
