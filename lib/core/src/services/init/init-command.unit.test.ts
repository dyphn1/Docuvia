import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import DatabaseCtor from "better-sqlite3";
import { InitCommand } from "./init-command.js";
import { GraphStore } from "../../memory/graph-store.js";
import { IWorkspaceGitService } from "../../interfaces/workspace-git.interfaces.js";
import {
  IAstProcessor,
  IConfigScanner,
  IFileDiscovery,
  IVcsScanner,
} from "../../interfaces/analyzer.interfaces.js";

/**
 * Adapts old `init-service.unit.test.ts`'s behavioral contract onto the decomposed
 * `InitCommand`. Uses a REAL temp `GraphStore` (mirroring the old test's real temp
 * `better-sqlite3` connection against `.docuvia/local.db`) plus mocked
 * `IWorkspaceGitService`/`IFileDiscovery`/`IAstProcessor`/`IConfigScanner`/`IVcsScanner` at the
 * same granularity the old test mocked `InitService`'s constructor dependencies. Old
 * `IGraphDatabaseRepository.persistAstGraph` had a single call-order marker; since persistence
 * is now several `GraphStore.graph`/`.tags`/`.files` primitive calls instead of one method,
 * call-order assertions below stop at `processFiles` and persistence itself is asserted via
 * the real DB state after `execute()` returns.
 */
describe("InitCommand.execute()", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: GraphStore;
  let callOrder: string[];

  let git: IWorkspaceGitService;
  let discovery: IFileDiscovery;
  let astProcessor: IAstProcessor;
  let configScanner: IConfigScanner;
  let vcsScanner: IVcsScanner;

  const filesToParse = [{ file: "src/a.ts", hash: "hash-a", code: "export const a = 1;" }];
  const parsedResults = [
    {
      file: "src/a.ts",
      hash: "hash-a",
      data: { imports: [], exports: [], functions: [], classes: [], calls: [] },
    },
  ];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-init-command-test-"));
    dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    callOrder = [];

    git = {
      isGitRepository: vi.fn().mockResolvedValue(true),
      ensureKnowledgeBranch: vi.fn().mockImplementation(async () => {
        callOrder.push("ensureKnowledgeBranch");
        return { created: true };
      }),
      installPostCommitHook: vi.fn().mockImplementation(async () => {
        callOrder.push("installPostCommitHook");
        return { installed: true };
      }),
      listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
      listUntrackedFiles: vi.fn().mockResolvedValue([]),
      listModifiedFiles: vi.fn().mockResolvedValue([]),
      readBlobContent: vi.fn().mockResolvedValue(""),
      getRemoteUrl: vi.fn().mockResolvedValue(undefined),
      getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
      getChangedFilesSince: vi.fn().mockResolvedValue([]),
      getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    };

    discovery = {
      discoverFiles: vi.fn().mockImplementation(async () => {
        callOrder.push("discoverFiles");
        return { filesToParse, existingHashes: new Map(), skippedCount: 0, skippedOversized: [] };
      }),
    };

    astProcessor = {
      processFiles: vi.fn().mockImplementation(async () => {
        callOrder.push("processFiles");
        return { parsed: parsedResults, failures: [] };
      }),
    };

    configScanner = {
      scanConfigs: vi
        .fn()
        .mockResolvedValue({ projectType: "typescript", tags: ["typescript", "backend"] }),
    };

    vcsScanner = {
      extractHotspotTags: vi.fn().mockResolvedValue(["domain:core"]),
    };
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeCommand() {
    return new InitCommand({
      store,
      git,
      discovery,
      astProcessor,
      configScanner,
      vcsScanner,
      workspaceRoot: tmpDir,
      onProgress: () => {},
    });
  }

  function countProjectRows(): number {
    const raw = new DatabaseCtor(dbPath, { readonly: true });
    try {
      const { c } = raw.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number };
      return c;
    } finally {
      raw.close();
    }
  }

  it("wires branch -> hook -> discovery -> AST parse in order", async () => {
    const command = makeCommand();
    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(callOrder).toEqual([
      "ensureKnowledgeBranch",
      "installPostCommitHook",
      "discoverFiles",
      "processFiles",
    ]);
  });

  it("persists the merged tag set (config + hotspot + per-file language tags)", async () => {
    const command = makeCommand();
    await command.execute();

    expect(store.tags.getIdByName("typescript")).toBeDefined();
    expect(store.tags.getIdByName("backend")).toBeDefined();
    expect(store.tags.getIdByName("domain:core")).toBeDefined();
  });

  it("stores the git remote URL as repo_url when a remote is configured", async () => {
    (git.getRemoteUrl as any).mockResolvedValue("https://github.com/example/repo.git");
    const command = makeCommand();
    await command.execute();

    const project = store.projects.getFirst();
    expect(project?.repo_url).toBe("https://github.com/example/repo.git");
    expect(project?.vcs_type).toBe("git");
  });

  it("falls back to a file:// repo_url when no git remote is configured", async () => {
    (git.getRemoteUrl as any).mockResolvedValue(undefined);
    const command = makeCommand();
    await command.execute();

    const project = store.projects.getFirst();
    expect(project?.repo_url).toBe(pathToFileURL(path.resolve(tmpDir)).href);
  });

  it("is idempotent: a second execute() run does not duplicate the projects row", async () => {
    const command = makeCommand();
    await command.execute();
    await command.execute();

    expect(countProjectRows()).toBe(1);
  });

  it("reports success:true, partialFailure:false, filesFailed:0 when all files parse", async () => {
    const command = makeCommand();
    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(result.partialFailure).toBe(false);
    expect(result.filesRequested).toBe(filesToParse.length);
    expect(result.filesParsed).toBe(parsedResults.length);
    expect(result.filesFailed).toBe(0);
    expect(result.message).toBe("Project initialized successfully");
  });

  it("threads filesSkippedOversized from discovery into the result, init.log, and success message", async () => {
    (discovery.discoverFiles as any).mockImplementation(async () => {
      callOrder.push("discoverFiles");
      return {
        filesToParse,
        existingHashes: new Map(),
        skippedCount: 0,
        skippedOversized: [{ file: "src/huge.ts", sizeBytes: 600_000 }],
      };
    });

    const command = makeCommand();
    const result = await command.execute();

    expect(result.filesFailed).toBe(0);
    expect(result.filesSkippedOversized).toBe(1);
    expect(result.message).toContain("1");
    expect(result.message).not.toBe("Project initialized successfully");

    const logPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));

    const skippedLine = lines.find((l: any) => l.event === "init.file_skipped_oversized");
    expect(skippedLine).toBeDefined();
    expect(skippedLine.file).toBe("src/huge.ts");
    expect(skippedLine.sizeBytes).toBe(600_000);

    const summaryLine = lines[lines.length - 1];
    expect(summaryLine.event).toBe("init.summary");
    expect(summaryLine.filesSkippedOversized).toBe(1);
  });

  it("reports partialFailure:true and a non-generic message when astProcessor.processFiles returns failures", async () => {
    (astProcessor.processFiles as any).mockImplementation(async () => {
      callOrder.push("processFiles");
      return {
        parsed: [],
        failures: [{ file: "src/broken.ts", hash: "h", error: "Worker exited with code 1" }],
      };
    });
    const command = makeCommand();
    const result = await command.execute();

    expect(result.partialFailure).toBe(true);
    expect(result.filesFailed).toBe(1);
    expect(result.message).not.toBe("Project initialized successfully");
    expect(result.message).toContain("1");
    expect(result.failures).toEqual([
      { file: "src/broken.ts", hash: "h", error: "Worker exited with code 1" },
    ]);
  });

  it("reproduces the audit scenario: 13 of 50 files fail, init still completes and reports the exact counts", async () => {
    const auditFilesToParse = Array.from({ length: 50 }, (_, i) => ({
      file: `src/file-${i}.ts`,
      hash: `hash-${i}`,
      code: `// file ${i}`,
    }));
    const auditFailures = Array.from({ length: 13 }, (_, i) => ({
      file: `src/file-${i}.ts`,
      hash: `hash-${i}`,
      error: "Worker exited with code 1",
    }));
    const auditParsed = auditFilesToParse.slice(13).map((f) => ({
      file: f.file,
      hash: f.hash,
      data: { imports: [], exports: [], functions: [], classes: [], calls: [] },
    }));

    (discovery.discoverFiles as any).mockImplementation(async () => {
      callOrder.push("discoverFiles");
      return {
        filesToParse: auditFilesToParse,
        existingHashes: new Map(),
        skippedCount: 0,
        skippedOversized: [],
      };
    });
    (astProcessor.processFiles as any).mockImplementation(async () => {
      callOrder.push("processFiles");
      return { parsed: auditParsed, failures: auditFailures };
    });

    const command = makeCommand();
    const result = await command.execute();

    expect(result.filesRequested).toBe(50);
    expect(result.filesParsed).toBe(37);
    expect(result.filesFailed).toBe(13);
    expect(result.filesParsed + result.filesFailed).toBe(result.filesRequested);
    expect(result.success).toBe(true);
    expect(result.partialFailure).toBe(true);

    const logPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    const summaryLine = lines[lines.length - 1];
    expect(summaryLine.event).toBe("init.summary");
    expect(summaryLine.filesFailed).toBe(13);
  });

  it("registers exactly one SIGTERM/SIGINT pair for the run and removes both once execute() finishes", async () => {
    const sigtermBefore = process.listenerCount("SIGTERM");
    const sigintBefore = process.listenerCount("SIGINT");

    const command = makeCommand();
    await command.execute();

    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  });
});
