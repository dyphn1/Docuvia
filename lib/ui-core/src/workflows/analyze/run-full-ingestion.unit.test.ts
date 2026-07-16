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
  type IGitProvider,
  type IGraphPersister,
  type IGraphStore,
  type IHydrationService,
  type IVcsScanner,
  type ProjectRow,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import { runFullIngestion } from "./run-full-ingestion.js";

// Mirrors init-workflow.unit.test.ts's mocking pattern (Factory Lock, pure orchestration unit
// test) -- runFullIngestion reuses init's own seedProjectRow/runDiscoveryPipeline/
// runParseAndPersist phase helpers verbatim, so this test focuses on the wiring around them
// (headSha meta write, markSynced, JSONL events, result shape) rather than re-testing those
// helpers' own already-covered behavior.

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(false),
    commitEmptyTree: vi.fn().mockResolvedValue("sha"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(false),
    readHookFile: vi.fn().mockResolvedValue(undefined),
    appendHookFile: vi.fn().mockResolvedValue(undefined),
    writeHookFile: vi.fn().mockResolvedValue(undefined),
    makeHookExecutable: vi.fn().mockResolvedValue(undefined),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getChangedLineRanges: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    getHeadSha: vi
      .fn()
      .mockResolvedValue("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
    getBranchTipSha: vi.fn().mockResolvedValue(undefined),
    readFileAtRef: vi.fn().mockResolvedValue(undefined),
    getCommitLog: vi.fn().mockResolvedValue([]),
    getCommitAncestry: vi.fn().mockResolvedValue([]),
    packDirectoryToBranch: vi.fn().mockResolvedValue(undefined),
    fetchRef: vi.fn().mockResolvedValue(undefined),
    pushRef: vi.fn().mockResolvedValue(undefined),
    getRefSha: vi.fn().mockResolvedValue(undefined),
    isAncestor: vi.fn().mockResolvedValue(false),
    getTreeSha: vi.fn().mockResolvedValue("tree-sha"),
    getCommitTimestamp: vi.fn().mockResolvedValue(0),
    createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
    acquireKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    releaseKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockStore(): IGraphStore {
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
  return {
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
    files: { getAllHashes: vi.fn().mockReturnValue([]), upsertFile: vi.fn() },
    tags: {
      upsertTag: vi.fn(),
      getIdByName: vi.fn(),
      linkNodeToTag: vi.fn(),
      getAllTagLinks: vi.fn(),
    },
    graph: {
      deleteNodesForPath: vi.fn().mockReturnValue([]),
      insertNode: vi.fn().mockReturnValue(1),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn().mockReturnValue(undefined),
      findNodeIdByNodeKey: vi.fn().mockReturnValue(undefined),
      count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
      findNodesForChangedFiles: vi.fn().mockReturnValue([]),
      findNodeByName: vi.fn(),
      getIncomingEdges: vi.fn(),
      getOutgoingEdges: vi.fn(),
      getAllNodes: vi.fn(),
      getAllLinks: vi.fn(),
      bulkLoadGraph: vi.fn(),
    },
    l3: {
      getById: vi.fn(),
      getAllExportable: vi.fn(),
      upsertDecision: vi.fn(),
    },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    meta: {
      get: vi.fn((key: string) => meta.get(key)),
      set: vi.fn((key: string, value: string) => {
        meta.set(key, value);
      }),
    },
    withWriteLock: async (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi
      .fn()
      .mockReturnValue({ prunedFiles: 0, prunedNodes: 0 }),
  };
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
    store = makeMockStore();

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

    docuviaFactory.register(TOKENS.FileDiscovery, () => fileDiscovery);
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.register(TOKENS.VcsScanner, () => vcsScanner);
    docuviaFactory.register(TOKENS.AstProcessor, () => astProcessor);
    docuviaFactory.register(TOKENS.GraphPersister, () => graphPersister);
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("seeds a project row, runs discovery -> parse -> persist, then markSynced in that order", async () => {
    const git = makeMockGitProvider();

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    expect(callOrder).toEqual(["discoverFiles", "processFiles", "markSynced"]);
    expect(store.projects.getOrInsert).toHaveBeenCalled();
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

    expect(store.meta.set).not.toHaveBeenCalled();
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
