import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import Database from "better-sqlite3";
import { InitService } from "./init-service.js";
import { IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";
import {
  IFileDiscovery,
  IAstProcessor,
  IGraphDatabaseRepository,
  IConfigScanner,
  IVcsScanner,
} from "../interfaces/analyzer.interfaces.js";

describe("InitService.init()", () => {
  let tmpDir: string;
  let dbPath: string;
  let callOrder: string[];

  let workspaceGit: IWorkspaceGitService;
  let fileDiscovery: IFileDiscovery;
  let astProcessor: IAstProcessor;
  let graphRepository: IGraphDatabaseRepository;
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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-init-service-test-"));
    dbPath = path.join(tmpDir, ".docuvia", "local.db");
    callOrder = [];

    workspaceGit = {
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

    fileDiscovery = {
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

    graphRepository = {
      persistAstGraph: vi.fn().mockImplementation(async () => {
        callOrder.push("persistAstGraph");
        return { updatedCount: 1, fileIdMap: new Map() };
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

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeService() {
    return new InitService(
      tmpDir,
      () => {},
      workspaceGit,
      fileDiscovery,
      astProcessor,
      graphRepository,
      configScanner,
      vcsScanner
    );
  }

  it("wires branch -> hook -> recon -> AST parse -> feature sniffing -> persistence in order", async () => {
    const service = makeService();
    const result = await service.init();

    expect(result.success).toBe(true);
    expect(callOrder).toEqual([
      "ensureKnowledgeBranch",
      "installPostCommitHook",
      "discoverFiles",
      "processFiles",
      "persistAstGraph",
    ]);
  });

  it("passes the merged tag set (config + hotspot + per-file language tags) to persistAstGraph", async () => {
    const service = makeService();
    await service.init();

    expect(graphRepository.persistAstGraph).toHaveBeenCalledWith(
      tmpDir,
      parsedResults,
      expect.arrayContaining(["typescript", "backend", "domain:core"])
    );
  });

  it("stores the git remote URL as repo_url when a remote is configured", async () => {
    (workspaceGit.getRemoteUrl as any).mockResolvedValue("https://github.com/example/repo.git");
    const service = makeService();
    await service.init();

    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT repo_url, vcs_type FROM projects").get() as any;
      expect(row.repo_url).toBe("https://github.com/example/repo.git");
      expect(row.vcs_type).toBe("git");
    } finally {
      db.close();
    }
  });

  it("falls back to a file:// repo_url when no git remote is configured", async () => {
    (workspaceGit.getRemoteUrl as any).mockResolvedValue(undefined);
    const service = makeService();
    await service.init();

    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT repo_url FROM projects").get() as any;
      expect(row.repo_url).toBe(pathToFileURL(path.resolve(tmpDir)).href);
    } finally {
      db.close();
    }
  });

  it("is idempotent: a second init() run does not duplicate the projects row", async () => {
    const service = makeService();
    await service.init();
    await service.init();

    const db = new Database(dbPath, { readonly: true });
    try {
      const { c } = db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number };
      expect(c).toBe(1);
    } finally {
      db.close();
    }
  });

  it("reports success:true, partialFailure:false, filesFailed:0 when all files parse", async () => {
    const service = makeService();
    const result = await service.init();

    expect(result.success).toBe(true);
    expect(result.partialFailure).toBe(false);
    expect(result.filesRequested).toBe(filesToParse.length);
    expect(result.filesParsed).toBe(parsedResults.length);
    expect(result.filesFailed).toBe(0);
    expect(result.message).toBe("Project initialized successfully");
  });

  it("threads filesSkippedOversized from discovery into the result, init.log, and success message", async () => {
    (fileDiscovery.discoverFiles as any).mockImplementation(async () => {
      callOrder.push("discoverFiles");
      return {
        filesToParse,
        existingHashes: new Map(),
        skippedCount: 0,
        skippedOversized: [{ file: "src/huge.ts", sizeBytes: 600_000 }],
      };
    });

    const service = makeService();
    const result = await service.init();

    expect(result.filesFailed).toBe(0);
    expect((result as any).filesSkippedOversized).toBe(1);
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
    const service = makeService();
    const result = await service.init();

    expect(result.partialFailure).toBe(true);
    expect(result.filesFailed).toBe(1);
    expect(result.message).not.toBe("Project initialized successfully");
    expect(result.message).toContain("1");
    expect(result.failures).toEqual([
      { file: "src/broken.ts", hash: "h", error: "Worker exited with code 1" },
    ]);
  });

  it("reproduces the audit scenario: 13 of 50 files fail, init still completes and reports the exact counts", async () => {
    // Representative smaller N (50 instead of the audit's 4236) to keep the test fast — the
    // ratio (13 failures) matters more than the absolute count for this test's purpose.
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

    (fileDiscovery.discoverFiles as any).mockImplementation(async () => {
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

    const service = makeService();
    const result = await service.init();

    expect(result.filesRequested).toBe(50);
    expect(result.filesParsed).toBe(37);
    expect(result.filesFailed).toBe(13);
    expect(result.filesParsed + result.filesFailed).toBe(result.filesRequested);
    expect(result.success).toBe(true);
    expect(result.partialFailure).toBe(true);

    // G3: an agent could `Read` this exact file after a real run.
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
});
