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
import { GitConstants } from "@workspace/contracts";
import { InitWorkflow, resolveDbPath } from "./init-workflow.js";
import { readTierBQueue } from "../analyze/tier-b-queue.js";

/**
 * Pure orchestration unit test — see
 * docs/gitbook/architecture/testing-and-quality-architecture.md's "Factory Lock": every
 * dependency `InitWorkflow` resolves is registered as a mock provider before each test, and the
 * factory is locked afterwards so a stray real-implementation import can't silently overwrite a
 * mock mid-test. No real I/O beyond the workflow's own JSONL run-log writes (a deliberate,
 * always-on side effect — see `init-log-writer.ts`).
 */

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
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
    listWorktrees: vi.fn().mockResolvedValue([]),
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
    files: {
      getAllHashes: vi.fn().mockReturnValue([]),
      upsertFile: vi.fn(),
      markTierBProcessed: vi.fn(),
      getTierBFileStatus: vi.fn(),
      getTierBCoverage: vi.fn(),
    },
    tags: {
      upsertTag: vi.fn(),
      getIdByName: vi.fn(),
      linkNodeToTag: vi.fn(),
      getAllTagLinks: vi.fn(),
    },
    graph: {
      deleteNodesForPath: vi.fn().mockReturnValue([]),
      getSemanticCoverage: vi.fn(),
      getCanarySample: vi.fn().mockReturnValue([]),
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
      getAllNodes: vi.fn().mockReturnValue([]),
      getAllLinks: vi.fn().mockReturnValue([]),
      bulkLoadGraph: vi.fn(),
      pruneOrphanedLinks: vi.fn().mockReturnValue(0),
      withFtsSyncSuspended: (fn: any) => fn(),
    },
    l3: {
      getById: vi.fn(),
      getAllExportable: vi.fn().mockReturnValue([]),
      getByL2NodeId: vi.fn(),
      upsertDecision: vi.fn(),
      importCard: vi.fn(),
      updateValidityStatus: vi.fn(),
    },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    meta: {
      get: vi.fn((key: string) => meta.get(key)),
      set: vi.fn((key: string, value: string) => {
        meta.set(key, value);
      }),
    },
    callSites: {
      deleteForFile: vi.fn(),
      insertMany: vi.fn(),
      getForFiles: vi.fn().mockReturnValue(new Map()),
      getByTargetFunctions: vi.fn().mockReturnValue(new Map()),
    },
    withWriteLock: async (fn) => fn(),
    withTransaction: (fn) => fn(),
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
  let gitOverrides: Partial<IGitProvider>;
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

    gitOverrides = {};
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
      packSnapshotToKnowledgeBranch: vi.fn().mockImplementation(async () => {
        callOrder.push("packSnapshotToKnowledgeBranch");
      }),
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

    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider(gitOverrides),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.register(TOKENS.FileDiscovery, () => fileDiscovery);
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.register(TOKENS.VcsScanner, () => vcsScanner);
    docuviaFactory.register(TOKENS.AstProcessor, () => astProcessor);
    docuviaFactory.register(TOKENS.GraphPersister, () => graphPersister);
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn().mockResolvedValue({
        nodesWritten: 0,
        edgesWritten: 0,
        markdownFilesWritten: 0,
      }),
    }));
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
      importL3Cards: vi.fn().mockResolvedValue({ cardsFound: 0, imported: 0 }),
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
      importL3Cards: vi.fn().mockResolvedValue({ cardsFound: 0, imported: 0 }),
    }));
    docuviaFactory.lock();

    await expect(
      new InitWorkflow(tmpDir, createMockLogger()).execute(),
    ).rejects.toThrow("boom");
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("wires branch -> hook -> discovery -> AST parse -> knowledge-branch pack -> markSynced in order", async () => {
    const result = await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(result.success).toBe(true);
    expect(callOrder).toEqual([
      "ensureKnowledgeBranch",
      "installPostCommitHook",
      "discoverFiles",
      "processFiles",
      "packSnapshotToKnowledgeBranch",
      "markSynced",
    ]);
  });

  it("still reports success when packing the knowledge-graph snapshot fails (non-fatal)", async () => {
    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger: createMockLogger(),
    });
    (knowledgeGit.packSnapshotToKnowledgeBranch as any).mockRejectedValueOnce(
      new Error("git fast-import failed"),
    );

    const result = await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(result.success).toBe(true);
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("regression: calls hydrationService.markSynced() after persisting so the next read-path command's ensureHydrated() doesn't immediately overwrite the graph just built (see HydrationService.markSynced() docs)", async () => {
    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, {
      logger: createMockLogger(),
    });
    expect(hydrationService.markSynced).toHaveBeenCalledWith(tmpDir, store);
  });

  it("regression: writes the last-ingested-source-sha meta key to headSha on success, mirroring analyze's own full ingestion (run-full-ingestion.ts)", async () => {
    gitOverrides.getHeadSha = vi
      .fn()
      .mockResolvedValue("cafebabecafebabecafebabecafebabecafebabe");

    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(store.meta.set).toHaveBeenCalledWith(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      "cafebabecafebabecafebabecafebabecafebabe",
    );
  });

  it("regression: queues every successfully-parsed file into the Tier B queue, so a fresh `init` is resolvable by a later `analyze --escalate-to-lsp` without needing a follow-up commit", async () => {
    gitOverrides.getHeadSha = vi
      .fn()
      .mockResolvedValue("cafebabecafebabecafebabecafebabecafebabe");

    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(readTierBQueue(store)).toEqual([
      {
        file: "src/a.ts",
        commitSha: "cafebabecafebabecafebabecafebabecafebabe",
      },
    ]);
  });

  it("does not write the last-ingested-source-sha meta key when there is no HEAD (unborn or no git repo)", async () => {
    gitOverrides.getHeadSha = vi.fn().mockResolvedValue(undefined);

    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(store.meta.set).not.toHaveBeenCalledWith(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      expect.anything(),
    );
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
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn().mockResolvedValue({
        nodesWritten: 0,
        edgesWritten: 0,
        markdownFilesWritten: 0,
      }),
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
      importL3Cards: vi.fn().mockResolvedValue({ cardsFound: 0, imported: 0 }),
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

  /**
   * Roadmap item 35 / issue #43: `init` used to always re-run the full discovery/parse/persist
   * sequence even on an already-initialized workspace. These tests assert the short-circuit
   * added to `execute()` (§0 in the class doc comment above). Per the leaf-dependency mocking
   * approach this file already uses throughout (`callOrder` + individual `vi.fn()` spies
   * registered via `docuviaFactory`, not module-level `vi.mock()` of the pure phase-composer
   * functions in `run-discovery-pipeline.ts`/`run-parse-and-persist.ts`/
   * `stamp-full-ingestion-for-tier-b.ts`/`pack-current-graph.ts`) -- each of those composer
   * functions has no side effect of its own beyond calling into an already-mocked leaf
   * dependency (`fileDiscovery.discoverFiles`, `astProcessor.processFiles`,
   * `knowledgeGit.packSnapshotToKnowledgeBranch`, `store.meta.set`, etc.), so asserting those
   * leaf mocks were never called is equivalent to — and more consistent with this file's
   * existing style than — a separate module-level mock of the composer functions themselves.
   */
  describe("already initialized (roadmap item 35 / issue #43)", () => {
    const existingProjectRow: ProjectRow = {
      id: 1,
      name: "existing-project",
      repo_url: "file:///existing",
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

    it("returns skippedExistingGraph:true and runs ensureGitBranchAndHooks but not discovery/parse/persist/pack when a project row and a populated L2 graph already exist", async () => {
      (store.projects.getFirst as any).mockReturnValue(existingProjectRow);
      (store.graph.count as any).mockReturnValue({ l2Nodes: 42, l3Nodes: 10 });

      const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
        logger: createMockLogger(),
      });
      const fileDiscovery = docuviaFactory.resolve(TOKENS.FileDiscovery, {
        logger: createMockLogger(),
      });
      const configScanner = docuviaFactory.resolve(TOKENS.ConfigScanner, {
        logger: createMockLogger(),
      });
      const vcsScanner = docuviaFactory.resolve(TOKENS.VcsScanner, {
        logger: createMockLogger(),
      });
      const astProcessor = docuviaFactory.resolve(TOKENS.AstProcessor, {
        logger: createMockLogger(),
      });
      const graphPersister = docuviaFactory.resolve(TOKENS.GraphPersister);
      const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, {
        logger: createMockLogger(),
      });
      const buildTempFileManager = docuviaFactory.resolve(
        TOKENS.TempFileManager,
      );
      const tempFileManager = buildTempFileManager(tmpDir, createMockLogger());

      const result = await new InitWorkflow(
        tmpDir,
        createMockLogger(),
      ).execute();

      // Result shape: the light-path builder, not the full-ingestion one.
      expect(result).toEqual({
        success: true,
        partialFailure: false,
        message: expect.stringContaining("already initialized"),
        filesRequested: 0,
        filesParsed: 0,
        filesFailed: 0,
        failures: [],
        filesSkippedOversized: 0,
        skippedExistingGraph: true,
      });

      // Still runs: branch/hook setup (cheap, idempotent -- see §2.3 of the plan this followed).
      expect(callOrder).toEqual([
        "ensureKnowledgeBranch",
        "installPostCommitHook",
      ]);
      expect(knowledgeGit.installPrePushHook).toHaveBeenCalledTimes(1);

      // Does NOT run: discovery, parse/persist, Tier B stamping, or the knowledge-branch pack.
      expect(configScanner.scanConfigs).not.toHaveBeenCalled();
      expect(vcsScanner.extractHotspotTags).not.toHaveBeenCalled();
      expect(fileDiscovery.discoverFiles).not.toHaveBeenCalled();
      expect(astProcessor.processFiles).not.toHaveBeenCalled();
      expect(graphPersister.persist).not.toHaveBeenCalled();
      expect(store.meta.set).not.toHaveBeenCalled();
      expect(knowledgeGit.packSnapshotToKnowledgeBranch).not.toHaveBeenCalled();
      expect(hydrationService.markSynced).not.toHaveBeenCalled();
      // initTempLifecycle is skipped entirely on the light path (§2.3) -- no construct/initialize.
      expect(tempFileManager.initialize).not.toHaveBeenCalled();

      // The store is still closed via the outer `finally` on this early-return path.
      expect(store.close).toHaveBeenCalledTimes(1);
    });

    it("does NOT take the light path when a project row exists but l2Nodes === 0 (matches dispatchAutoMode's !project || l2Nodes === 0 condition -- both must be satisfied to skip)", async () => {
      (store.projects.getFirst as any).mockReturnValue(existingProjectRow);
      (store.graph.count as any).mockReturnValue({ l2Nodes: 0, l3Nodes: 0 });

      const fileDiscovery = docuviaFactory.resolve(TOKENS.FileDiscovery, {
        logger: createMockLogger(),
      });
      const astProcessor = docuviaFactory.resolve(TOKENS.AstProcessor, {
        logger: createMockLogger(),
      });

      const result = await new InitWorkflow(
        tmpDir,
        createMockLogger(),
      ).execute();

      expect(result.skippedExistingGraph).toBe(false);
      expect(fileDiscovery.discoverFiles).toHaveBeenCalledTimes(1);
      expect(astProcessor.processFiles).toHaveBeenCalledTimes(1);
      expect(callOrder).toContain("discoverFiles");
      expect(callOrder).toContain("processFiles");
    });

    it("does NOT take the light path on a genuinely-empty repo (no project row, l2Nodes === 0) -- the pre-existing empty-graph tests above must keep passing unchanged", async () => {
      const result = await new InitWorkflow(
        tmpDir,
        createMockLogger(),
      ).execute();

      expect(result.skippedExistingGraph).toBe(false);
      expect(result.success).toBe(true);
    });
  });
});
