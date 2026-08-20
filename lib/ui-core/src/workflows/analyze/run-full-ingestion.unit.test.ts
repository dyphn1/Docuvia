import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type AstProcessResult,
  type IAstProcessor,
  type IConfigScanner,
  type IFileDiscovery,
  type IGraphPersister,
  type IGraphStore,
  type IHydrationService,
  type IVcsScanner,
  type ProjectRow,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import {
  makeMockStore,
  makeMockGitProvider,
  makeMockKnowledgeGit,
} from "@workspace/contracts/testing";
import { runFullIngestion } from "./run-full-ingestion.js";
import { readTierBQueue } from "./tier-b-queue.js";

// Mirrors init-workflow.unit.test.ts's mocking pattern (Factory Lock, pure orchestration unit
// test) -- runFullIngestion reuses init's own seedProjectRow/runDiscoveryPipeline/
// runParseAndPersist phase helpers verbatim, so this test focuses on the wiring around them
// (headSha meta write, markSynced, JSONL events, result shape) rather than re-testing those
// helpers' own already-covered behavior.

function makeFullIngestionStore(): IGraphStore {
  let projectRow: ProjectRow | undefined;
  const meta = new Map<string, string>();
  const doInsert = (input: { name: string; repoUrl: string }) => {
    projectRow = {
      id: 1,
      name: input.name,
      repo_url: input.repoUrl,
      description: null,
      status: "active",
      vcs_type: "git",
      svn_url: null,
      last_git_ingested_at: null,
      last_svn_revision: null,
      last_ast_ingested_at: null,
      owner_id: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    return projectRow;
  };
  return makeMockStore({
    projects: {
      getFirst: vi.fn().mockImplementation(() => projectRow),
      insert: vi.fn().mockImplementation(doInsert),
      getOrInsert: vi
        .fn()
        .mockImplementation((input: { name: string; repoUrl: string }) =>
          projectRow ? projectRow : doInsert(input),
        ),
      count: vi.fn().mockImplementation(() => (projectRow ? 1 : 0)),
    },
    meta: {
      get: vi.fn((key: string) => meta.get(key)),
      set: vi.fn((key: string, value: string) => {
        meta.set(key, value);
      }),
    },
  });
}

describe("runFullIngestion()", () => {
  let tmpDir: string;
  let store: IGraphStore;
  let callOrder: string[];
  let hydrationService: IHydrationService;

  const filesToParse = [
    { file: "src/a.ts", hash: "hash-a", code: "export const a = 1;" },
  ];
  const parsedResults = [
    {
      file: "src/a.ts",
      hash: "hash-a",
      data: { imports: [], exports: [], functions: [], classes: [], calls: [] },
      language: "typescript",
    },
  ];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-run-full-ingestion-"),
    );
    callOrder = [];
    store = makeFullIngestionStore();

    resetFactoryForTests();

    const fileDiscovery: IFileDiscovery = {
      discoverFiles: vi.fn().mockImplementation(async () => {
        callOrder.push("discoverFiles");
        return {
          filesToParse,
          existingHashes: new Map(),
          skippedCount: 0,
          skippedOversized: [],
        };
      }),
    };
    const astProcessor: IAstProcessor = {
      processFiles: vi
        .fn()
        .mockImplementation(async (): Promise<AstProcessResult> => {
          callOrder.push("processFiles");
          return { parsed: parsedResults, failures: [] };
        }),
    };
    const configScanner: IConfigScanner = {
      scanConfigs: vi
        .fn()
        .mockResolvedValue({ projectType: "typescript", tags: ["typescript"] }),
    };
    const vcsScanner: IVcsScanner = {
      extractHotspotTags: vi.fn().mockResolvedValue([]),
    };
    const graphPersister: IGraphPersister = {
      persist: vi.fn().mockResolvedValue({ updatedCount: 1 }),
    };
    hydrationService = {
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn(),
      markSynced: vi.fn().mockImplementation(async () => {
        callOrder.push("markSynced");
      }),
      hydrate: vi.fn(),
    };
    const knowledgeGit = makeMockKnowledgeGit({
      packSnapshotToKnowledgeBranch: vi.fn().mockImplementation(async () => {
        callOrder.push("packSnapshotToKnowledgeBranch");
      }),
    });

    docuviaFactory.register(TOKENS.FileDiscovery, () => fileDiscovery);
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.register(TOKENS.VcsScanner, () => vcsScanner);
    docuviaFactory.register(TOKENS.AstProcessor, () => astProcessor);
    docuviaFactory.register(TOKENS.GraphPersister, () => graphPersister);
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn().mockResolvedValue({
        nodesWritten: 0,
        edgesWritten: 0,
        markdownFilesWritten: 0,
      }),
    }));
    docuviaFactory.lock();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("seeds a project row, runs discovery -> parse -> persist -> knowledge-branch pack -> markSynced in that order", async () => {
    const git = makeMockGitProvider();

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    expect(callOrder).toEqual([
      "discoverFiles",
      "processFiles",
      "packSnapshotToKnowledgeBranch",
      "markSynced",
    ]);
    expect(store.projects.getOrInsert).toHaveBeenCalled();
  });

  it("still returns a successful result when packing the knowledge-graph snapshot fails (non-fatal)", async () => {
    const git = makeMockGitProvider();
    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger: createMockLogger(),
    });
    (knowledgeGit.packSnapshotToKnowledgeBranch as any).mockRejectedValueOnce(
      new Error("git fast-import failed"),
    );

    const result = await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    expect(result).toMatchObject({ kind: "autoFullIngestion", filesParsed: 1 });
  });

  it("writes the last-ingested-source-sha meta key to headSha on success", async () => {
    const git = makeMockGitProvider({
      getHeadSha: vi
        .fn()
        .mockResolvedValue("cafebabecafebabecafebabecafebabecafebabe"),
    });

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    expect(store.meta.set).toHaveBeenCalledWith(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      "cafebabecafebabecafebabecafebabecafebabe",
    );
  });

  it("queues every successfully-parsed file into the Tier B queue on first ingestion", async () => {
    const git = makeMockGitProvider({
      getHeadSha: vi
        .fn()
        .mockResolvedValue("cafebabecafebabecafebabecafebabecafebabe"),
    });

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    expect(readTierBQueue(store)).toEqual([
      {
        file: "src/a.ts",
        commitSha: "cafebabecafebabecafebabecafebabecafebabe",
      },
    ]);
  });

  it("does not write the meta key when there is no HEAD (unborn or no git repo)", async () => {
    const git = makeMockGitProvider({
      getHeadSha: vi.fn().mockResolvedValue(undefined),
    });

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    expect(store.meta.set).not.toHaveBeenCalledWith(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      expect.anything(),
    );
  });

  it("reports projectType/suggestedTags (the old config-scan output) plus file counts", async () => {
    const git = makeMockGitProvider();

    const result = await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    expect(result).toEqual({
      kind: "autoFullIngestion",
      projectType: "typescript",
      suggestedTags: expect.arrayContaining(["typescript"]),
      filesRequested: 1,
      filesParsed: 1,
      filesFailed: 0,
      filesSkippedOversized: 0,
    });
  });

  it("logs a full-ingestion parse failure to analyze.log as analyze.full.parse_failure, not init.log", async () => {
    const git = makeMockGitProvider();
    docuviaFactory.reset();
    resetFactoryForTests();
    const fileDiscovery: IFileDiscovery = {
      discoverFiles: vi.fn().mockResolvedValue({
        filesToParse,
        existingHashes: new Map(),
        skippedCount: 0,
        skippedOversized: [],
      }),
    };
    const astProcessor: IAstProcessor = {
      processFiles: vi.fn().mockResolvedValue({
        parsed: [],
        failures: [
          {
            file: "src/broken.ts",
            hash: "h",
            error: "Worker exited with code 1",
          },
        ],
      }),
    };
    const configScanner: IConfigScanner = {
      scanConfigs: vi
        .fn()
        .mockResolvedValue({ projectType: "typescript", tags: ["typescript"] }),
    };
    const vcsScanner: IVcsScanner = {
      extractHotspotTags: vi.fn().mockResolvedValue([]),
    };
    const graphPersister: IGraphPersister = {
      persist: vi.fn().mockResolvedValue({ updatedCount: 0 }),
    };
    docuviaFactory.register(TOKENS.FileDiscovery, () => fileDiscovery);
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.register(TOKENS.VcsScanner, () => vcsScanner);
    docuviaFactory.register(TOKENS.AstProcessor, () => astProcessor);
    docuviaFactory.register(TOKENS.GraphPersister, () => graphPersister);
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn().mockResolvedValue({
        nodesWritten: 0,
        edgesWritten: 0,
        markdownFilesWritten: 0,
      }),
    }));
    docuviaFactory.lock();

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    const analyzeLogPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const analyzeLines = fs
      .readFileSync(analyzeLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const failureLine = analyzeLines.find(
      (l) => l.event === "analyze.full.parse_failure",
    );
    expect(failureLine).toBeDefined();
    expect(failureLine.file).toBe("src/broken.ts");

    const initLogPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    expect(fs.existsSync(initLogPath)).toBe(false);
  });

  it("logs analyze.full.start and analyze.full.summary JSONL lines", async () => {
    const git = makeMockGitProvider();

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.event === "analyze.full.start")).toBe(true);
    const summary = lines.find((l) => l.event === "analyze.full.summary");
    expect(summary?.projectType).toBe("typescript");
    expect(summary?.filesParsed).toBe(1);
  });
});
