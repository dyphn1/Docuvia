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
    };

    fileDiscovery = {
      discoverFiles: vi.fn().mockImplementation(async () => {
        callOrder.push("discoverFiles");
        return { filesToParse, existingHashes: new Map(), skippedCount: 0 };
      }),
    };

    astProcessor = {
      processFiles: vi.fn().mockImplementation(async () => {
        callOrder.push("processFiles");
        return parsedResults;
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
});
