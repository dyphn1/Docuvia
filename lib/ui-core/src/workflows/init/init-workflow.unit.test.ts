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
  type GraphStoreOpenOptions,
  type IGitProvider,
  type IGraphPersister,
  type IGraphStore,
  type IHydrationService,
  type IKnowledgeGitService,
  type ITempFileManager,
  type IVcsScanner,
  type ProjectRow,
} from "@workspace/contracts";
import { InitWorkflow, resolveDbPath } from "./init-workflow.js";

/**
 * Pure orchestration unit test — see
 * docs/gitbook/architecture/testing-and-quality-architecture.md's "Factory Lock": every
 * dependency `InitWorkflow` resolves is registered as a mock provider before each test, and the
 * factory is locked afterwards so a stray real-implementation import can't silently overwrite a
 * mock mid-test. No real I/O beyond the workflow's own JSONL run-log writes (a deliberate,
 * always-on side effect — see `init-log-writer.ts`).
 */

function makeMockGitProvider(): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(false),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    commitEmptyTree: vi.fn().mockResolvedValue("sha"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(false),
    resolveHooksDir: vi.fn().mockResolvedValue("/workspace/.git/hooks"),
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
    getHeadSha: vi.fn().mockResolvedValue(undefined),
    getBranchTipSha: vi.fn().mockResolvedValue(undefined),
    readFileAtRef: vi.fn().mockResolvedValue(undefined),
    listFilesAtRef: vi.fn().mockResolvedValue([]),
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
  };
}

function makeMockStore(): IGraphStore {
  let projectRow: ProjectRow | undefined;
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
      getIncomingRelations: vi.fn(),
      getOutgoingRelations: vi.fn(),
      getAllNodes: vi.fn(),
      getAllLinks: vi.fn(),
      bulkLoadGraph: vi.fn(),
      pruneOrphanedLinks: vi.fn().mockReturnValue(0),
    },
    l3: {
      getById: vi.fn(),
      getAllExportable: vi.fn(),
      upsertDecision: vi.fn(),
      importCard: vi.fn(),
    },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    meta: { get: vi.fn(), set: vi.fn() },
    withWriteLock: async (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi
      .fn()
      .mockReturnValue({ prunedFiles: 0, prunedNodes: 0 }),
  };
}

describe("InitWorkflow.execute()", () => {
  let tmpDir: string;
  let callOrder: string[];
  let store: IGraphStore;
  let openStoreSpy: ReturnType<
    typeof vi.fn<[GraphStoreOpenOptions], Promise<IGraphStore>>
  >;

  const filesToParse = [
    { file: "src/a.ts", hash: "hash-a", code: "export const a = 1;" },
  ];
  const parsedResults = [
    {
      file: "src/a.ts",
      hash: "hash-a",
      data: { imports: [], exports: [], functions: [], classes: [], calls: [] },
    },
  ];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-init-workflow-test-"),
    );
    callOrder = [];
    store = makeMockStore();

    resetFactoryForTests();

    const knowledgeGit: IKnowledgeGitService = {
      ensureKnowledgeBranch: vi.fn().mockImplementation(async () => {
        callOrder.push("ensureKnowledgeBranch");
        return { created: true };
      }),
      installPostCommitHook: vi.fn().mockImplementation(async () => {
        callOrder.push("installPostCommitHook");
        return { installed: true };
      }),
      installPrePushHook: vi.fn().mockResolvedValue({ installed: true }),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn().mockResolvedValue(undefined),
      syncKnowledgeBranch: vi.fn().mockResolvedValue({ status: "no-remote" }),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    };
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
    const tempFileManager: ITempFileManager = {
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      stopCleanup: vi.fn(),
      getTempDirPath: vi
        .fn()
        .mockReturnValue(path.join(tmpDir, ".docuvia", "tmp")),
    };

    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.register(TOKENS.FileDiscovery, () => fileDiscovery);
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.register(TOKENS.VcsScanner, () => vcsScanner);
    docuviaFactory.register(TOKENS.AstProcessor, () => astProcessor);
    docuviaFactory.register(TOKENS.GraphPersister, () => graphPersister);
    docuviaFactory.register(
      TOKENS.TempFileManager,
      () => () => tempFileManager,
    );
    openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);
    const hydrationService: IHydrationService = {
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn(),
      markSynced: vi.fn().mockImplementation(async () => {
        callOrder.push("markSynced");
      }),
      hydrate: vi.fn(),
    };
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);

    docuviaFactory.lock();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("opens the store at <workspaceRoot>/.docuvia/local.db and closes it when execute() completes", async () => {
    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(openStoreSpy).toHaveBeenCalledWith({
      dbPath: resolveDbPath(tmpDir),
    });
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("closes the store even when a phase throws", async () => {
    docuviaFactory.reset();
    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => ({
      ensureKnowledgeBranch: vi.fn().mockRejectedValue(new Error("boom")),
      installPostCommitHook: vi.fn(),
      installPrePushHook: vi.fn(),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn(),
      syncKnowledgeBranch: vi.fn(),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    }));
    docuviaFactory.register(TOKENS.FileDiscovery, () => ({
      discoverFiles: vi.fn(),
    }));
    docuviaFactory.register(TOKENS.ConfigScanner, () => ({
      scanConfigs: vi.fn(),
    }));
    docuviaFactory.register(TOKENS.VcsScanner, () => ({
      extractHotspotTags: vi.fn(),
    }));
    docuviaFactory.register(TOKENS.AstProcessor, () => ({
      processFiles: vi.fn(),
    }));
    docuviaFactory.register(TOKENS.GraphPersister, () => ({
      persist: vi.fn(),
    }));
    docuviaFactory.register(
      TOKENS.TempFileManager,
      () => () => ({}) as ITempFileManager,
    );
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.HydrationService, () => ({
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn(),
      markSynced: vi.fn().mockResolvedValue(undefined),
      hydrate: vi.fn(),
    }));
    docuviaFactory.lock();

    await expect(
      new InitWorkflow(tmpDir, createMockLogger()).execute(),
    ).rejects.toThrow("boom");
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("wires branch -> hook -> discovery -> AST parse -> markSynced in order", async () => {
    const result = await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(result.success).toBe(true);
    expect(callOrder).toEqual([
      "ensureKnowledgeBranch",
      "installPostCommitHook",
      "discoverFiles",
      "processFiles",
      "markSynced",
    ]);
  });

  it("regression: calls hydrationService.markSynced() after persisting so the next read-path command's ensureHydrated() doesn't immediately overwrite the graph just built (see HydrationService.markSynced() docs)", async () => {
    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, {
      logger: createMockLogger(),
    });
    expect(hydrationService.markSynced).toHaveBeenCalledWith(tmpDir, store);
  });

  it("is idempotent: a second execute() run does not duplicate the projects row", async () => {
    await new InitWorkflow(tmpDir, createMockLogger()).execute();
    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect((store.projects.getOrInsert as any).mock.calls.length).toBe(1);
  });

  it("reports success:true, partialFailure:false, filesFailed:0 when all files parse", async () => {
    const result = await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(result.success).toBe(true);
    expect(result.partialFailure).toBe(false);
    expect(result.filesRequested).toBe(filesToParse.length);
    expect(result.filesParsed).toBe(parsedResults.length);
    expect(result.filesFailed).toBe(0);
    expect(result.message).toBe("Project initialized successfully");
  });

  it("reports partialFailure:true when astProcessor.processFiles returns failures", async () => {
    docuviaFactory.reset();
    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => ({
      ensureKnowledgeBranch: vi.fn().mockResolvedValue({ created: true }),
      installPostCommitHook: vi.fn().mockResolvedValue({ installed: true }),
      installPrePushHook: vi.fn().mockResolvedValue({ installed: true }),
      removePostCommitHook: vi.fn(),
      removePrePushHook: vi.fn(),
      repairDuplicatePostCommitHook: vi.fn(),
      deleteKnowledgeBranch: vi.fn(),
      packSnapshotToKnowledgeBranch: vi.fn().mockResolvedValue(undefined),
      syncKnowledgeBranch: vi.fn().mockResolvedValue({ status: "no-remote" }),
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
      runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    }));
    docuviaFactory.register(TOKENS.FileDiscovery, () => ({
      discoverFiles: vi.fn().mockResolvedValue({
        filesToParse,
        existingHashes: new Map(),
        skippedCount: 0,
        skippedOversized: [],
      }),
    }));
    docuviaFactory.register(TOKENS.ConfigScanner, () => ({
      scanConfigs: vi
        .fn()
        .mockResolvedValue({ projectType: "generic", tags: [] }),
    }));
    docuviaFactory.register(TOKENS.VcsScanner, () => ({
      extractHotspotTags: vi.fn().mockResolvedValue([]),
    }));
    docuviaFactory.register(TOKENS.AstProcessor, () => ({
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
    }));
    docuviaFactory.register(TOKENS.GraphPersister, () => ({
      persist: vi.fn().mockResolvedValue({ updatedCount: 0 }),
    }));
    docuviaFactory.register(TOKENS.TempFileManager, () => () => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn(),
      stopCleanup: vi.fn(),
      getTempDirPath: vi.fn().mockReturnValue(""),
    }));
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(makeMockStore()),
    );
    docuviaFactory.register(TOKENS.HydrationService, () => ({
      resolveHydrationCommit: vi.fn(),
      isStale: vi.fn(),
      markSynced: vi.fn().mockResolvedValue(undefined),
      hydrate: vi.fn(),
    }));
    docuviaFactory.lock();

    const result = await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(result.partialFailure).toBe(true);
    expect(result.filesFailed).toBe(1);
    expect(result.message).not.toBe("Project initialized successfully");
    expect(result.failures).toEqual([
      { file: "src/broken.ts", hash: "h", error: "Worker exited with code 1" },
    ]);
  });

  it("registers exactly one SIGTERM/SIGINT pair for the run and removes both once execute() finishes", async () => {
    const sigtermBefore = process.listenerCount("SIGTERM");
    const sigintBefore = process.listenerCount("SIGINT");

    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  });
});
