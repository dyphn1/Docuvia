import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { ProcessedEvents, IngestionResult } from "../../types/ast-ingestion.types.js";

// Recreate the default export as a plain, non-frozen object so `vi.spyOn(fs, "readFile"/"writeFile")`
// works inside individual tests below — the real `node:fs/promises` default export isn't
// configurable under this ESM/vitest setup, which makes `vi.spyOn` throw "Cannot redefine
// property" if used directly against the real module.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: { ...actual } };
});

import fs from "node:fs/promises";
import { GitNativePersistenceService } from "./git-native-persistence.service.js";

function makeResult(): IngestionResult {
  return {
    l2Created: 0,
    l3Created: 0,
    linksCreated: 0,
    contractsCreated: 0,
    filesSkipped: 0,
    errors: [],
  };
}

function makeEvents(fileCount: number, symbolsPerFile: number): ProcessedEvents {
  const fileEvents: ProcessedEvents["fileEvents"] = [];
  const classEvents: ProcessedEvents["classEvents"] = [];
  const functionEvents: ProcessedEvents["functionEvents"] = [];

  for (let i = 0; i < fileCount; i++) {
    const filePath = `src/mod${i}.ts`;
    fileEvents.push({
      filePath,
      baseName: `mod${i}.ts`,
      dirPath: "src",
      l2Type: "module",
      pathPatterns: [filePath],
    });
    for (let s = 0; s < symbolsPerFile; s++) {
      functionEvents.push({
        name: `fn${s}`,
        fqn: `mod${i}.fn${s}`,
        filePath,
        l2NodeId: 0,
        nodeType: "change",
      });
    }
  }

  return {
    fileEvents,
    classEvents,
    functionEvents,
    importEvents: [],
    callEvents: [],
    contractEvents: [],
  };
}

describe("GitNativePersistenceService.processEvents", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docuvia-git-native-persistence-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("never calls fs.readFile for the markdown-write path (dead pre-read removed)", async () => {
    const readFileSpy = vi.spyOn(fs, "readFile");
    const service = new GitNativePersistenceService();
    const events = makeEvents(5, 3);
    const result = makeResult();

    await service.processEvents(events, tmpDir, result);

    expect(readFileSpy).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
  });

  it("writes one markdown file per file-event and per class/function symbol, with frontmatter + body content", async () => {
    const service = new GitNativePersistenceService();
    const events = makeEvents(4, 2);
    const result = makeResult();

    await service.processEvents(events, tmpDir, result);

    const fileMd = await fs.readFile(path.join(tmpDir, "knowledge", "src/mod0.ts.md"), "utf8");
    expect(fileMd).toContain("id: src/mod0.ts");
    expect(fileMd).toContain("# File: mod0.ts");

    // path.parse("src/mod0.ts") => { dir: "src", name: "mod0" } — symbol markdown lives under
    // knowledge/<dir>/<name-without-ext>/<symbolName>.md.
    const symbolMd = await fs.readFile(
      path.join(tmpDir, "knowledge", "src", "mod0", "fn0.md"),
      "utf8"
    );
    expect(symbolMd).toContain("fqn: mod0.fn0");
    expect(symbolMd).toContain("# Symbol: fn0");
  });

  it("produces identical node/markdown output and identical l2Created/l3Created counts regardless of concurrency (order-independent)", async () => {
    const service = new GitNativePersistenceService();
    const events = makeEvents(20, 4);
    const result = makeResult();

    await service.processEvents(events, tmpDir, result);

    expect(result.l2Created).toBe(20);
    expect(result.l3Created).toBe(80);
    expect(result.errors).toEqual([]);

    const nodesJsonl = await fs.readFile(path.join(tmpDir, "graph", "nodes.jsonl"), "utf8");
    const nodeIds = nodesJsonl
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).id)
      .sort();
    expect(nodeIds.length).toBe(100);

    // Every expected markdown file exists on disk (parallelized writes didn't drop any).
    for (let i = 0; i < 20; i++) {
      await expect(
        fs.access(path.join(tmpDir, "knowledge", `src/mod${i}.ts.md`))
      ).resolves.toBeUndefined();
      for (let s = 0; s < 4; s++) {
        await expect(
          fs.access(path.join(tmpDir, "knowledge", "src", `mod${i}`, `fn${s}.md`))
        ).resolves.toBeUndefined();
      }
    }
  });

  it("accumulates per-file write errors into result.errors instead of throwing, under concurrent execution", async () => {
    const service = new GitNativePersistenceService();
    const events = makeEvents(10, 2);
    const result = makeResult();

    const realWriteFile = fs.writeFile.bind(fs);
    const writeFileSpy = vi
      .spyOn(fs, "writeFile")
      .mockImplementation(async (filePath: any, ...rest: any[]) => {
        if (String(filePath).includes("mod3.ts.md")) {
          throw new Error("simulated write failure");
        }
        return (realWriteFile as any)(filePath, ...rest);
      });

    await service.processEvents(events, tmpDir, result);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("simulated write failure"))).toBe(true);
    // Other, unrelated markdown writes still succeeded despite the one failure.
    await expect(
      fs.access(path.join(tmpDir, "knowledge", "src/mod4.ts.md"))
    ).resolves.toBeUndefined();

    writeFileSpy.mockRestore();
  });
});
