import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGraphStore,
  type IGitProvider,
  type IChangeDetectionService,
} from "@workspace/contracts";
import { ReviewWorkflow } from "./review-workflow.js";

function makeMockGitProvider(overrides: Partial<IGitProvider> = {}): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(false),
    commitEmptyTree: vi.fn().mockResolvedValue("sha"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(false),
    readHookFile: vi.fn().mockResolvedValue(undefined),
    appendHookFile: vi.fn().mockResolvedValue(undefined),
    makeHookExecutable: vi.fn().mockResolvedValue(undefined),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    packDirectoryToBranch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
  return {
    projects: { getFirst: vi.fn(), insert: vi.fn(), count: vi.fn() },
    files: { getAllHashes: vi.fn(), upsertFile: vi.fn() },
    tags: { upsertTag: vi.fn(), getIdByName: vi.fn(), linkNodeToTag: vi.fn(), getAllTagLinks: vi.fn() },
    graph: {
      deleteNodesForPath: vi.fn(),
      insertNode: vi.fn(),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn(),
      count: vi.fn(),
      findNodesForChangedFiles: vi.fn(),
      findNodeByName: vi.fn(),
      getIncomingEdges: vi.fn(),
      getOutgoingEdges: vi.fn(),
      getAllNodes: vi.fn(),
      getAllLinks: vi.fn(),
    },
    l3: { getById: vi.fn(), getAllExportable: vi.fn() },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    withWriteLock: async (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi.fn(),
    ...overrides,
  };
}

describe("ReviewWorkflow.execute()", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("fetches changed files, delegates to ChangeDetectionService, and closes the store", async () => {
    const gitProvider = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue([{ file: "src/a.ts", status: "modified" }]),
    });
    docuviaFactory.register(TOKENS.GitProvider, () => gitProvider);

    const store = makeMockStore();
    const openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);

    const detectChanges = vi.fn().mockReturnValue({
      baseRef: "main",
      filesChanged: [{ file: "src/a.ts", status: "modified" }],
      affectedNodes: [],
      riskLevel: "LOW",
      analysis: "Base: main\nFiles changed: 1\nRisk level: LOW",
    });
    const changeDetectionService: IChangeDetectionService = { detectChanges };
    docuviaFactory.register(TOKENS.ChangeDetectionService, () => changeDetectionService);
    docuviaFactory.lock();

    const result = await new ReviewWorkflow("/workspace/demo", createMockLogger()).execute("main");

    expect(gitProvider.getChangedFilesSince).toHaveBeenCalledWith("/workspace/demo", "main");
    expect(openStoreSpy).toHaveBeenCalledWith(expect.objectContaining({ readonly: true }));
    expect(detectChanges).toHaveBeenCalledWith({
      store,
      baseRef: "main",
      filesChanged: [{ file: "src/a.ts", status: "modified" }],
    });
    expect(result.riskLevel).toBe("LOW");
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('throws a DocuviaError with a "run docuvia init" message when the db is missing', async () => {
    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    const dbOpenError = new DocuviaError("DB_OPEN_FAILED", "Failed to open database at /x: ENOENT");
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => vi.fn().mockRejectedValue(dbOpenError));
    docuviaFactory.lock();

    await expect(
      new ReviewWorkflow("/workspace/demo", createMockLogger()).execute()
    ).rejects.toMatchObject({
      code: "DB_OPEN_FAILED",
      message: expect.stringContaining("docuvia init"),
    });
  });

  it("closes the store even when detectChanges() throws", async () => {
    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    const store = makeMockStore();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => vi.fn().mockResolvedValue(store));
    const changeDetectionService: IChangeDetectionService = {
      detectChanges: vi.fn().mockImplementation(() => {
        throw new Error("boom");
      }),
    };
    docuviaFactory.register(TOKENS.ChangeDetectionService, () => changeDetectionService);
    docuviaFactory.lock();

    await expect(
      new ReviewWorkflow("/workspace/demo", createMockLogger()).execute()
    ).rejects.toThrow("boom");
    expect(store.close).toHaveBeenCalledTimes(1);
  });
});
