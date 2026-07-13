import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type {
  AstProcessResult,
  IAstProcessor,
  IGraphPersister,
  IGraphStore,
} from "@workspace/contracts";
import { runParseAndPersist } from "./run-parse-and-persist.js";

// `store` is opaque to `runParseAndPersist` — it's only forwarded, untouched, to the
// (mocked) `graphPersister`. Actual persistence behavior is covered by
// `lib/core/src/graph/persist-ast-graph.unit.test.ts` against a real `GraphStore`; this test
// is a pure orchestration unit test per docs/gitbook/architecture/testing-and-quality-architecture.md
// ("NO I/O ALLOWED" for `lib/ui-core`), except for the real JSONL run-log writes, which are a
// deliberate, always-on side effect of the workflow itself (see `init-log-writer.ts`).
const fakeStore = {} as IGraphStore;

function makeAstProcessor(result: AstProcessResult): IAstProcessor {
  return { processFiles: vi.fn().mockResolvedValue(result) };
}

function makeGraphPersister(): IGraphPersister & {
  persist: ReturnType<typeof vi.fn>;
} {
  return { persist: vi.fn().mockResolvedValue({ updatedCount: 0 }) };
}

const filesToParse = [
  {
    file: "src/a.ts",
    hash: "hash-a",
    code: "export function foo() { bar(); }",
  },
];

describe("runParseAndPersist", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-run-parse-and-persist-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("hands astProcessor's parsed results straight to graphPersister.persist(), merging in per-file language tags", async () => {
    const astProcessor = makeAstProcessor({
      parsed: [
        {
          file: "src/a.ts",
          hash: "hash-a",
          data: {
            imports: [],
            exports: [],
            functions: [],
            classes: [],
            calls: [],
          },
          language: "typescript",
        },
      ],
      failures: [],
    });
    const graphPersister = makeGraphPersister();

    const result = await runParseAndPersist({
      astProcessor,
      graphPersister,
      store: fakeStore,
      workspaceRoot: tmpDir,
      projectId: 1,
      filesToParse,
      skippedOversized: [],
      tags: new Set(["backend"]),
    });

    expect(Array.from(result.tags).sort()).toEqual(["backend", "typescript"]);
    expect(graphPersister.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        store: fakeStore,
        workspaceRoot: tmpDir,
        projectId: 1,
        tags: expect.arrayContaining(["backend", "typescript"]),
      }),
    );
  });

  it("does not mutate the caller-supplied tags Set", async () => {
    const astProcessor = makeAstProcessor({
      parsed: [
        {
          file: "src/a.ts",
          hash: "hash-a",
          data: {
            imports: [],
            exports: [],
            functions: [],
            classes: [],
            calls: [],
          },
          language: "typescript",
        },
      ],
      failures: [],
    });
    const callerTags = new Set(["backend"]);

    await runParseAndPersist({
      astProcessor,
      graphPersister: makeGraphPersister(),
      store: fakeStore,
      workspaceRoot: tmpDir,
      projectId: 1,
      filesToParse,
      skippedOversized: [],
      tags: callerTags,
    });

    expect(Array.from(callerTags)).toEqual(["backend"]);
  });

  it("logs a JSONL init.parse_failure entry per astProcessor failure", async () => {
    const astProcessor = makeAstProcessor({
      parsed: [],
      failures: [
        {
          file: "src/broken.ts",
          hash: "h",
          error: "Worker exited with code 1",
        },
      ],
    });

    await runParseAndPersist({
      astProcessor,
      graphPersister: makeGraphPersister(),
      store: fakeStore,
      workspaceRoot: tmpDir,
      projectId: 1,
      filesToParse,
      skippedOversized: [],
      tags: new Set(),
    });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const failureLine = lines.find((l) => l.event === "init.parse_failure");
    expect(failureLine).toBeDefined();
    expect(failureLine.file).toBe("src/broken.ts");
    expect(failureLine.error).toBe("Worker exited with code 1");
  });

  it("logs a JSONL init.file_skipped_oversized entry per skipped file", async () => {
    await runParseAndPersist({
      astProcessor: makeAstProcessor({ parsed: [], failures: [] }),
      graphPersister: makeGraphPersister(),
      store: fakeStore,
      workspaceRoot: tmpDir,
      projectId: 1,
      filesToParse: [],
      skippedOversized: [{ file: "src/huge.ts", sizeBytes: 600_000 }],
      tags: new Set(),
    });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const skippedLine = lines.find(
      (l) => l.event === "init.file_skipped_oversized",
    );
    expect(skippedLine).toBeDefined();
    expect(skippedLine.file).toBe("src/huge.ts");
    expect(skippedLine.sizeBytes).toBe(600_000);
  });
});
