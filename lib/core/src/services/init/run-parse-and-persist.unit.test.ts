import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runParseAndPersist } from "./run-parse-and-persist.js";
import { GraphStore } from "../../memory/graph-store.js";
import { AstProcessResult, DiscoveredFile, IAstProcessor } from "../../interfaces/analyzer.interfaces.js";

// Real temp GraphStore rather than a mocked repo surface — `run-parse-and-persist.ts`'s whole
// job is orchestrating several `GraphStore.graph`/`.tags`/`.files` primitive calls (including
// `ScopeResolver`-based cross-file link resolution), so asserting against the actual persisted
// rows is far less brittle than hand-writing a mock that re-implements that orchestration.
describe("runParseAndPersist", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-run-parse-and-persist-"));
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    projectId = store.projects.insert({ name: "demo", repoUrl: "file:///demo" }).id;
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeAstProcessor(result: AstProcessResult): IAstProcessor {
    return { processFiles: vi.fn().mockResolvedValue(result) };
  }

  const filesToParse: DiscoveredFile[] = [
    { file: "src/a.ts", hash: "hash-a", code: "export function foo() { bar(); }" },
  ];

  it("persists parsed files as l2_nodes and links functions with 'contains'", async () => {
    const astProcessor = makeAstProcessor({
      parsed: [
        {
          file: "src/a.ts",
          hash: "hash-a",
          data: {
            imports: [],
            exports: [],
            functions: [{ name: "foo", startLine: 0, endLine: 1 }],
            classes: [],
            calls: [],
          },
        },
      ],
      failures: [],
    });

    await runParseAndPersist({
      astProcessor,
      store,
      workspaceRoot: tmpDir,
      projectId,
      filesToParse,
      skippedOversized: [],
      tags: new Set(["typescript"]),
    });

    const fileNodeId = store.graph.findNodeIdByName("src/a.ts", "src/a.ts");
    const fnNodeId = store.graph.findNodeIdByName("src/a.ts", "foo");
    expect(fileNodeId).toBeDefined();
    expect(fnNodeId).toBeDefined();

    expect(store.files.getAllHashes()).toEqual([{ filePath: "src/a.ts", contentHash: "hash-a" }]);
  });

  it("adds per-file detected-language tags on top of the caller-supplied tag set and links them to the file node", async () => {
    const astProcessor = makeAstProcessor({
      parsed: [
        {
          file: "src/a.ts",
          hash: "hash-a",
          data: { imports: [], exports: [], functions: [], classes: [], calls: [] },
        },
      ],
      failures: [],
    });
    const tags = new Set(["backend"]);

    const result = await runParseAndPersist({
      astProcessor,
      store,
      workspaceRoot: tmpDir,
      projectId,
      filesToParse,
      skippedOversized: [],
      tags,
    });

    expect(Array.from(result.tags).sort()).toEqual(["backend", "typescript"]);
    expect(store.tags.getIdByName("typescript")).toBeDefined();
    expect(store.tags.getIdByName("backend")).toBeDefined();
  });

  it("resolves an intra-file call edge via ScopeResolver ('calls' link between the two function nodes)", async () => {
    const astProcessor = makeAstProcessor({
      parsed: [
        {
          file: "src/a.ts",
          hash: "hash-a",
          data: {
            imports: [],
            exports: [],
            functions: [
              { name: "foo", startLine: 0, endLine: 1 },
              { name: "bar", startLine: 2, endLine: 3 },
            ],
            classes: [],
            calls: [{ sourceFunction: "foo", targetFunction: "bar" }],
          },
        },
      ],
      failures: [],
    });

    await runParseAndPersist({
      astProcessor,
      store,
      workspaceRoot: tmpDir,
      projectId,
      filesToParse,
      skippedOversized: [],
      tags: new Set(),
    });

    const fooId = store.graph.findNodeIdByName("src/a.ts", "foo");
    const barId = store.graph.findNodeIdByName("src/a.ts", "bar");
    expect(fooId).toBeDefined();
    expect(barId).toBeDefined();

    // GraphNodesRepo exposes no "list links" primitive (the pilot never needed one), so query
    // the persisted node_links row directly via a second read-only connection to assert the
    // "calls" edge itself (not just that both endpoint nodes exist) was actually created.
    const DatabaseCtor = (await import("better-sqlite3")).default;
    const raw = new DatabaseCtor(path.join(tmpDir, ".docuvia", "local.db"), { readonly: true });
    try {
      const link = raw
        .prepare(
          "SELECT * FROM node_links WHERE source_node_id = ? AND target_node_id = ? AND link_type = 'calls'"
        )
        .get(fooId, barId);
      expect(link).toBeDefined();
    } finally {
      raw.close();
    }
  });

  it("logs a JSONL init.parse_failure entry per astProcessor failure", async () => {
    const astProcessor = makeAstProcessor({
      parsed: [],
      failures: [{ file: "src/broken.ts", hash: "h", error: "Worker exited with code 1" }],
    });

    await runParseAndPersist({
      astProcessor,
      store,
      workspaceRoot: tmpDir,
      projectId,
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
    const astProcessor = makeAstProcessor({ parsed: [], failures: [] });

    await runParseAndPersist({
      astProcessor,
      store,
      workspaceRoot: tmpDir,
      projectId,
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
    const skippedLine = lines.find((l) => l.event === "init.file_skipped_oversized");
    expect(skippedLine).toBeDefined();
    expect(skippedLine.file).toBe("src/huge.ts");
    expect(skippedLine.sizeBytes).toBe(600_000);
  });

  it("re-persisting the same file deletes its stale nodes first (no duplicate function nodes)", async () => {
    const makeResult = (): AstProcessResult => ({
      parsed: [
        {
          file: "src/a.ts",
          hash: "hash-a",
          data: {
            imports: [],
            exports: [],
            functions: [{ name: "foo", startLine: 0, endLine: 1 }],
            classes: [],
            calls: [],
          },
        },
      ],
      failures: [],
    });

    await runParseAndPersist({
      astProcessor: makeAstProcessor(makeResult()),
      store,
      workspaceRoot: tmpDir,
      projectId,
      filesToParse,
      skippedOversized: [],
      tags: new Set(),
    });
    await runParseAndPersist({
      astProcessor: makeAstProcessor(makeResult()),
      store,
      workspaceRoot: tmpDir,
      projectId,
      filesToParse,
      skippedOversized: [],
      tags: new Set(),
    });

    // Both the file node and the function node should still resolve to exactly one id each —
    // no duplicates left behind by the second persist.
    expect(store.graph.findNodeIdByName("src/a.ts", "src/a.ts")).toBeDefined();
    expect(store.graph.findNodeIdByName("src/a.ts", "foo")).toBeDefined();
    expect(store.files.getAllHashes()).toEqual([{ filePath: "src/a.ts", contentHash: "hash-a" }]);
  });
});
