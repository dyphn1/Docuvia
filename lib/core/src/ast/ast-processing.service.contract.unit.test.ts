import { describe, expect, it, vi } from "vitest";
import type { DiscoveredFile } from "@workspace/contracts";
import { AstProcessingService } from "./ast-processing.service.js";
import type { IASTWorkerPool } from "./ast-worker-pool.js";
import type { AstParseResponse } from "./ast-worker.js";
import { AstMessages } from "./ast-constants.js";

// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
// Sections: Unit Tests, Regression Tests, Contract Tests, Fixture Design, CI Quality Gates.
// This suite intentionally adds contract evidence that was missing from the older regression-heavy
// ast-processing.service.unit.test.ts suite. See issue #369 for the quantitative evidence matrix.

const emptyData = {
  imports: [],
  exports: [],
  functions: [],
  classes: [],
  calls: [],
};

type FakeParseRequest = {
  filePath: string;
  code?: string;
  language?: unknown;
};

function makeFile(file: string): DiscoveredFile {
  return { file, hash: `hash-${file}`, code: `// ${file}` };
}

function makeFakePool(
  parseImpl: (request: FakeParseRequest) => Promise<AstParseResponse>,
): IASTWorkerPool {
  return {
    initialize: async () => undefined,
    parse: parseImpl as IASTWorkerPool["parse"],
    terminate: async () => undefined,
    serializeBatch: (run) => run(),
  };
}

describe("AstProcessingService.processFiles() contract evidence", () => {
  it("handles an empty input list without parsing and still closes the worker-pool lifecycle", async () => {
    const parse = vi.fn(async () => ({
      taskId: "unused",
      success: true,
      data: emptyData,
    }));
    const pool = makeFakePool(parse);
    const initialize = vi.fn(async () => undefined);
    const terminate = vi.fn(async () => undefined);
    pool.initialize = initialize;
    pool.terminate = terminate;
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", []);

    expect(result).toEqual({ parsed: [], failures: [] });
    expect(parse).not.toHaveBeenCalled();
    expect(initialize).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("returns the complete parsed result contract for a successful file", async () => {
    const file = makeFile("feature.ts");
    const pool = makeFakePool(async () => ({
      taskId: "task-success",
      success: true,
      data: emptyData,
    }));
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", [file]);

    expect(result).toEqual({
      parsed: [
        {
          file: "feature.ts",
          hash: "hash-feature.ts",
          data: emptyData,
          language: "typescript",
        },
      ],
      failures: [],
    });
  });

  it("uses the documented fallback error when a failure response has no error detail", async () => {
    const pool = makeFakePool(async () => ({
      taskId: "task-no-detail",
      success: false,
    }));
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", [makeFile("broken.ts")]);

    expect(result).toEqual({
      parsed: [],
      failures: [
        {
          file: "broken.ts",
          hash: "hash-broken.ts",
          error: AstMessages.PARSE_FAILURE_NO_DETAIL,
        },
      ],
    });
  });

  it("normalizes a malformed success response with missing data into an explicit failure", async () => {
    const pool = makeFakePool(async () => ({
      taskId: "task-malformed",
      success: true,
    }));
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", [makeFile("malformed.ts")]);

    expect(result).toEqual({
      parsed: [],
      failures: [
        {
          file: "malformed.ts",
          hash: "hash-malformed.ts",
          error: AstMessages.PARSE_FAILURE_NO_DETAIL,
        },
      ],
    });
  });

  it("normalizes a generic thrown Error into the failure contract instead of rejecting the batch", async () => {
    const pool = makeFakePool(async () => {
      throw new Error("parser dependency failed");
    });
    const service = new AstProcessingService(pool);

    const result = await service.processFiles("/workspace", [makeFile("throw.ts")]);

    expect(result).toEqual({
      parsed: [],
      failures: [
        {
          file: "throw.ts",
          hash: "hash-throw.ts",
          error: "parser dependency failed",
        },
      ],
    });
  });

  it("preserves duplicate inputs as distinct ordered results rather than silently deduplicating them", async () => {
    const parse = vi.fn(async () => ({
      taskId: "task-duplicate",
      success: true,
      data: emptyData,
    }));
    const pool = makeFakePool(parse);
    const service = new AstProcessingService(pool);
    const duplicate = makeFile("duplicate.ts");

    const result = await service.processFiles("/workspace", [duplicate, duplicate]);

    expect(result.parsed).toHaveLength(2);
    expect(result.parsed.map((item) => item.file)).toEqual([
      "duplicate.ts",
      "duplicate.ts",
    ]);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("produces identical normalized output and parse side effects across two identical-input runs", async () => {
    const requests: FakeParseRequest[] = [];
    const pool = makeFakePool(async (request) => {
      requests.push({ ...request });
      return {
        taskId: `task-${request.filePath}`,
        success: true,
        data: emptyData,
      };
    });
    const service = new AstProcessingService(pool);
    const files = [makeFile("a.ts"), makeFile("b.ts")];

    const first = await service.processFiles("/workspace", files);
    const firstRequests = requests.splice(0, requests.length);
    const second = await service.processFiles("/workspace", files);
    const secondRequests = requests.splice(0, requests.length);

    expect(second).toEqual(first);
    expect(secondRequests).toEqual(firstRequests);
  });
});
