import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGitProvider,
  type IGraphStore,
  type IHydrationService,
  type IKnowledgeGitService,
  type ILlmClient,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import { AnalyzeWorkflow, stripMarkdownCodeFence } from "./analyze-workflow.js";
import {
  ANALYZE_MESSAGES,
  DECISION_EXTRACTION_SYSTEM_PROMPT,
} from "./analyze-messages.js";
import { MAX_ANALYZE_FILES } from "./decision-extraction.js";
import { runFullIngestion } from "./run-full-ingestion.js";
import { runDeltaIngestion } from "./run-delta-ingestion.js";

// The dispatcher logic (fast-path / empty-graph / fallback-resolution-order) is
// AnalyzeWorkflow.executeAutoMode()'s own responsibility; runFullIngestion/runDeltaIngestion's
// internal behavior is covered by their own dedicated unit tests
// (run-full-ingestion.unit.test.ts / run-delta-ingestion.unit.test.ts). Mocking both modules
// here isolates the dispatch decision under test from their real (heavier) implementations.
vi.mock("./run-full-ingestion.js", () => ({
  runFullIngestion: vi.fn().mockResolvedValue({
    kind: "autoFullIngestion",
    projectType: "typescript",
    suggestedTags: [],
    filesRequested: 0,
    filesParsed: 0,
    filesFailed: 0,
    filesSkippedOversized: 0,
  }),
}));
vi.mock("./run-delta-ingestion.js", () => ({
  runDeltaIngestion: vi.fn().mockResolvedValue({
    kind: "autoDelta",
    fromSha: "from",
    headSha: "head",
    filesReparsed: 0,
    filesDeleted: 0,
    filesFailed: 0,
    filesSkippedOversized: 0,
    tierBQueued: 0,
  }),
}));

/** Same shape as `lib/ui-core/src/workflows/init/init-workflow.unit.test.ts`'s helper. */
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
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getChangedLineRanges: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    getHeadSha: vi
      .fn()
      .mockResolvedValue("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
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

/** Empty-graph default: no project row, so decision-extraction tests that don't care about
 *  persistence get a deterministic persisted:0/deduped:0 result plus a warn log, without each
 *  test having to register its own store. */
function makeMockStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
  return {
    projects: {
      getFirst: vi.fn().mockReturnValue(undefined),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn(),
    },
    files: { getAllHashes: vi.fn(), upsertFile: vi.fn() },
    tags: {
      upsertTag: vi.fn(),
      getIdByName: vi.fn(),
      linkNodeToTag: vi.fn(),
      getAllTagLinks: vi.fn(),
    },
    graph: {
      deleteNodesForPath: vi.fn(),
      insertNode: vi.fn(),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn(),
      findNodeIdByNodeKey: vi.fn().mockReturnValue(undefined),
      count: vi.fn(),
      findNodesForChangedFiles: vi.fn(),
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
      upsertDecision: vi.fn().mockReturnValue({ id: 1, deduped: false }),
      importCard: vi.fn(),
    },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    meta: { get: vi.fn(), set: vi.fn() },
    withWriteLock: async (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi.fn(),
    ...overrides,
  };
}

/** Default: nothing to hydrate from yet, matching every pre-existing empty-graph test's implicit
 *  expectation (`tryHydrateThenDelta` short-circuits to `undefined` and the caller falls through
 *  to `runFullIngestion`, exactly as before this token existed). */
function makeMockHydrationService(
  overrides: Partial<IHydrationService> = {},
): IHydrationService {
  return {
    resolveHydrationCommit: vi.fn().mockResolvedValue(undefined),
    hydrate: vi.fn().mockResolvedValue({
      hydrated: false,
      nodesLoaded: 0,
      edgesLoaded: 0,
      edgesDropped: 0,
    }),
    isStale: vi.fn().mockResolvedValue(false),
    markSynced: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function registerDefaultPersistenceMocks(store: IGraphStore = makeMockStore()) {
  const openStoreSpy = vi
    .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
    .mockResolvedValue(store);
  docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);
  docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
  docuviaFactory.register(TOKENS.HydrationService, () =>
    makeMockHydrationService(),
  );
  return { store, openStoreSpy };
}

function makeMockKnowledgeGit(
  overrides: Partial<IKnowledgeGitService> = {},
): IKnowledgeGitService {
  return {
    ensureKnowledgeBranch: vi.fn(),
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
    ...overrides,
  };
}

/**
 * `AnalyzeWorkflow.execute()`'s no-arg branch — auto mode (PLAT-007 Tier A;
 * phase1-decision-integration.md §6). Tests here cover only the *dispatch* decision (fast-path /
 * empty-graph / fallback-resolution-order); `runFullIngestion`/`runDeltaIngestion` are mocked
 * (see the top-of-file `vi.mock` calls) and get their own dedicated behavior tests.
 */
describe("AnalyzeWorkflow.execute() — auto mode (no targetPath)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-analyze-workflow-test-"),
    );
    resetFactoryForTests();
    vi.mocked(runFullIngestion).mockClear();
    vi.mocked(runDeltaIngestion).mockClear();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fast-path noop: HEAD equal to the last-ingested-source-sha meta key exits immediately without dispatching full or delta ingestion", async () => {
    const store = makeMockStore({
      meta: {
        get: vi
          .fn()
          .mockImplementation((key: string) =>
            key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
              ? "same-sha"
              : undefined,
          ),
        set: vi.fn(),
      },
    });
    const { openStoreSpy } = registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        getHeadSha: vi.fn().mockResolvedValue("same-sha"),
      }),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(result).toEqual({
      kind: "autoDeltaNoop",
      headSha: "same-sha",
      dirtyWorktree: false,
    });
    expect(runFullIngestion).not.toHaveBeenCalled();
    expect(runDeltaIngestion).not.toHaveBeenCalled();
    expect(openStoreSpy).toHaveBeenCalledWith({
      dbPath: expect.stringContaining("local.db"),
      readonly: false,
    });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.some((l) => l.event === "analyze.delta.noop")).toBe(true);
    expect(lines.some((l) => l.event === "analyze.auto.tier_b_cap_nudge")).toBe(
      false,
    );
  });

  it("fast-path noop with a dirty working tree: reports dirtyWorktree=true and logs the UX-gap message/line, without changing the noop outcome (2026-07-24 C# benchmark follow-up)", async () => {
    const store = makeMockStore({
      meta: {
        get: vi
          .fn()
          .mockImplementation((key: string) =>
            key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
              ? "same-sha"
              : undefined,
          ),
        set: vi.fn(),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        getHeadSha: vi.fn().mockResolvedValue("same-sha"),
        hasUncommittedChanges: vi.fn().mockResolvedValue(true),
      }),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.lock();

    const logger = createMockLogger();
    const result = await new AnalyzeWorkflow(tmpDir, logger).execute();

    expect(result).toEqual({
      kind: "autoDeltaNoop",
      headSha: "same-sha",
      dirtyWorktree: true,
    });
    expect(runFullIngestion).not.toHaveBeenCalled();
    expect(runDeltaIngestion).not.toHaveBeenCalled();
    expect(
      logger.events.some(
        (e) => e.message === ANALYZE_MESSAGES.AUTO_NOOP_DIRTY_WORKTREE,
      ),
    ).toBe(true);

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const noopLine = lines.find((l) => l.event === "analyze.delta.noop");
    expect(noopLine?.dirtyWorktree).toBe(true);
  });

  it("§10c commit-time nudge: logs a one-line nudge (once) when the Tier B commit-cap is exceeded, without affecting the dispatch result", async () => {
    const store = makeMockStore({
      meta: {
        get: vi.fn().mockImplementation((key: string) => {
          if (key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA)
            return "same-sha";
          if (key === GitConstants.META_KEY_TIER_B_CHANGED_BYTES)
            return String(GitConstants.DEFAULT_TIER_B_COMMIT_CAP_BYTES);
          return undefined;
        }),
        set: vi.fn(),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        getHeadSha: vi.fn().mockResolvedValue("same-sha"),
      }),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.lock();

    const logger = createMockLogger();
    const result = await new AnalyzeWorkflow(tmpDir, logger).execute();

    expect(result).toEqual({
      kind: "autoDeltaNoop",
      headSha: "same-sha",
      dirtyWorktree: false,
    });
    expect(
      logger.events.filter(
        (e) => e.message === ANALYZE_MESSAGES.TIER_B_CAP_NUDGE,
      ).length,
    ).toBe(1);

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      lines.filter((l) => l.event === "analyze.auto.tier_b_cap_nudge").length,
    ).toBe(1);
  });

  it("§10c commit-time nudge: no nudge when the commit-cap key is absent (pre-Slice-3 workspace) -- matches isTierBCommitCapExceeded's inactive-when-absent contract", async () => {
    const store = makeMockStore({
      meta: {
        get: vi
          .fn()
          .mockImplementation((key: string) =>
            key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
              ? "same-sha"
              : undefined,
          ),
        set: vi.fn(),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        getHeadSha: vi.fn().mockResolvedValue("same-sha"),
      }),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.lock();

    const logger = createMockLogger();
    await new AnalyzeWorkflow(tmpDir, logger).execute();

    expect(
      logger.events.some(
        (e) => e.message === ANALYZE_MESSAGES.TIER_B_CAP_NUDGE,
      ),
    ).toBe(false);
  });

  it("dispatches to runFullIngestion when the graph has no project row", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue(undefined),
        insert: vi.fn(),
        getOrInsert: vi.fn(),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 5, l3Nodes: 0 }),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(runFullIngestion).toHaveBeenCalledTimes(1);
    expect(runDeltaIngestion).not.toHaveBeenCalled();
    expect(result.kind).toBe("autoFullIngestion");
  });

  it("dispatches to runFullIngestion when the graph has a project row but zero L2 nodes", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue({ id: 1 } as any),
        insert: vi.fn(),
        getOrInsert: vi.fn(),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.lock();

    await new AnalyzeWorkflow(tmpDir, createMockLogger()).execute();

    expect(runFullIngestion).toHaveBeenCalledTimes(1);
    expect(runDeltaIngestion).not.toHaveBeenCalled();
  });

  it("roadmap item #11 (hydrate-then-delta): hydrates from the already-populated knowledge branch and delta-ingests from its paired Docuvia-Source sha, instead of a full re-parse, when local.db's graph is empty", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue(undefined),
        insert: vi.fn(),
        getOrInsert: vi.fn().mockReturnValue({ id: 1 } as any),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        getHeadSha: vi.fn().mockResolvedValue("new-sha"),
        getCommitLog: vi.fn().mockResolvedValue([
          {
            sha: "knowledge-sha-1",
            message: `Snapshot [old-sha]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: old-sha`,
          },
        ]),
      }),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    const hydrationService = makeMockHydrationService({
      resolveHydrationCommit: vi.fn().mockResolvedValue("knowledge-sha-1"),
      hydrate: vi.fn().mockResolvedValue({
        hydrated: true,
        knowledgeSha: "knowledge-sha-1",
        nodesLoaded: 10,
        edgesLoaded: 4,
        edgesDropped: 0,
      }),
    });
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(hydrationService.hydrate).toHaveBeenCalledWith(tmpDir, store);
    expect(runFullIngestion).not.toHaveBeenCalled();
    expect(runDeltaIngestion).toHaveBeenCalledWith(
      expect.objectContaining({
        fromSha: "old-sha",
        headSha: "new-sha",
        projectId: 1,
      }),
    );
    expect(result.kind).toBe("autoDelta");
  });

  it("roadmap item #11 (hydrate-then-delta): falls back to runFullIngestion unchanged when the knowledge branch has nothing to hydrate from yet", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue(undefined),
        insert: vi.fn(),
        getOrInsert: vi.fn(),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({ getHeadSha: vi.fn().mockResolvedValue("new-sha") }),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    const hydrationService = makeMockHydrationService({
      resolveHydrationCommit: vi.fn().mockResolvedValue(undefined),
    });
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(hydrationService.resolveHydrationCommit).toHaveBeenCalled();
    expect(hydrationService.hydrate).not.toHaveBeenCalled();
    expect(runFullIngestion).toHaveBeenCalledTimes(1);
    expect(runDeltaIngestion).not.toHaveBeenCalled();
    expect(result.kind).toBe("autoFullIngestion");
  });

  it("roadmap item #11 (hydrate-then-delta): falls back to runFullIngestion unchanged when the resolved knowledge commit carries no Docuvia-Source trailer to pair it with", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue(undefined),
        insert: vi.fn(),
        getOrInsert: vi.fn(),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({
        getHeadSha: vi.fn().mockResolvedValue("new-sha"),
        getCommitLog: vi.fn().mockResolvedValue([]),
      }),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    const hydrationService = makeMockHydrationService({
      resolveHydrationCommit: vi
        .fn()
        .mockResolvedValue("knowledge-sha-unstamped"),
    });
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(hydrationService.hydrate).not.toHaveBeenCalled();
    expect(runFullIngestion).toHaveBeenCalledTimes(1);
    expect(runDeltaIngestion).not.toHaveBeenCalled();
    expect(result.kind).toBe("autoFullIngestion");
  });

  it("dispatches to runDeltaIngestion with the meta-key sha as the baseline when the graph is non-empty and HEAD has moved", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue({ id: 1 } as any),
        insert: vi.fn(),
        getOrInsert: vi.fn(),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 5, l3Nodes: 0 }),
      },
      meta: {
        get: vi
          .fn()
          .mockImplementation((key: string) =>
            key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
              ? "old-sha"
              : undefined,
          ),
        set: vi.fn(),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({ getHeadSha: vi.fn().mockResolvedValue("new-sha") }),
    );
    const knowledgeGit = makeMockKnowledgeGit();
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    await new AnalyzeWorkflow(tmpDir, createMockLogger()).execute();

    expect(knowledgeGit.resolveNewestSourceTrailerSha).not.toHaveBeenCalled();
    expect(runDeltaIngestion).toHaveBeenCalledWith(
      expect.objectContaining({ fromSha: "old-sha", headSha: "new-sha" }),
    );
    expect(runFullIngestion).not.toHaveBeenCalled();
  });

  it("fallback resolution order: falls back to the newest Docuvia-Source trailer when the meta key is absent (pre-Slice-2 workspace)", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue({ id: 1 } as any),
        insert: vi.fn(),
        getOrInsert: vi.fn(),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 5, l3Nodes: 0 }),
      },
      meta: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({ getHeadSha: vi.fn().mockResolvedValue("new-sha") }),
    );
    const knowledgeGit = makeMockKnowledgeGit({
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue("trailer-sha"),
    });
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    await new AnalyzeWorkflow(tmpDir, createMockLogger()).execute();

    expect(knowledgeGit.resolveNewestSourceTrailerSha).toHaveBeenCalled();
    expect(runDeltaIngestion).toHaveBeenCalledWith(
      expect.objectContaining({ fromSha: "trailer-sha", headSha: "new-sha" }),
    );
  });

  it("fallback resolution order: falls back to a one-time full re-ingest when neither the meta key nor a knowledge-branch trailer resolves", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue({ id: 1 } as any),
        insert: vi.fn(),
        getOrInsert: vi.fn(),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 5, l3Nodes: 0 }),
      },
      meta: { get: vi.fn().mockReturnValue(undefined), set: vi.fn() },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({ getHeadSha: vi.fn().mockResolvedValue("new-sha") }),
    );
    const knowledgeGit = makeMockKnowledgeGit({
      resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
    });
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(runFullIngestion).toHaveBeenCalledTimes(1);
    expect(runDeltaIngestion).not.toHaveBeenCalled();
    expect(result.kind).toBe("autoFullIngestion");
  });

  it("closes the store when execute() completes", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue(undefined),
        insert: vi.fn(),
        getOrInsert: vi.fn(),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 0, l3Nodes: 0 }),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.lock();

    await new AnalyzeWorkflow(tmpDir, createMockLogger()).execute();

    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("logs analyze.auto.error and rethrows when the run itself throws (run-level failure JSONL, phase1-decision-integration.md §6c)", async () => {
    const store = makeMockStore({
      projects: {
        getFirst: vi.fn().mockReturnValue({ id: 1 } as any),
        insert: vi.fn(),
        getOrInsert: vi.fn(),
        count: vi.fn(),
      },
      graph: {
        ...makeMockStore().graph,
        count: vi.fn().mockReturnValue({ l2Nodes: 5, l3Nodes: 0 }),
      },
      meta: {
        get: vi
          .fn()
          .mockImplementation((key: string) =>
            key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
              ? "old-sha"
              : undefined,
          ),
        set: vi.fn(),
      },
    });
    registerDefaultPersistenceMocks(store);
    docuviaFactory.register(TOKENS.GitProvider, () =>
      makeMockGitProvider({ getHeadSha: vi.fn().mockResolvedValue("new-sha") }),
    );
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.lock();

    vi.mocked(runDeltaIngestion).mockRejectedValueOnce(
      new Error("boom: delta ingestion exploded"),
    );

    await expect(
      new AnalyzeWorkflow(tmpDir, createMockLogger()).execute(),
    ).rejects.toThrow("boom: delta ingestion exploded");

    expect(store.close).toHaveBeenCalledTimes(1);

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const errorLine = lines.find((l) => l.event === "analyze.auto.error");
    expect(errorLine).toBeDefined();
    expect(errorLine!.message).toBe("boom: delta ingestion exploded");
  });

  it("logs analyze.auto.error and rethrows when the store open itself fails (DB_OPEN_FAILED — e.g. corrupted local.db in a background hook-fired run)", async () => {
    const openStoreSpy = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockRejectedValue(
        new DocuviaError(
          ErrorCodes.DB_OPEN_FAILED,
          "Failed to open the local database",
        ),
      );
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);
    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.lock();

    await expect(
      new AnalyzeWorkflow(tmpDir, createMockLogger()).execute(),
    ).rejects.toThrow("Failed to open the local database");

    expect(runFullIngestion).not.toHaveBeenCalled();
    expect(runDeltaIngestion).not.toHaveBeenCalled();

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const errorLine = lines.find((l) => l.event === "analyze.auto.error");
    expect(errorLine).toBeDefined();
    expect(errorLine!.message).toBe("Failed to open the local database");
  });
});

describe("AnalyzeWorkflow.execute() — decision extraction (targetPath set)", () => {
  let tmpDir: string;
  const llmOptions = {
    llmBaseUrl: "http://localhost:9999",
    llmApiKey: "test-key",
    llmModel: "test-model",
  };

  function readAnalyzeLog(): Array<Record<string, unknown>> {
    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    return fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-analyze-workflow-extraction-test-"),
    );
    resetFactoryForTests();
    // Default: empty graph (no project row) — persistDecisions() warns and skips rather than
    // throwing "no provider registered" for tests that don't care about persistence. Tests that
    // exercise the persistence path itself re-register a more specific store before locking.
    registerDefaultPersistenceMocks();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws DocuviaError and logs analyze.focused.error when the target path does not exist", async () => {
    docuviaFactory.lock();

    await expect(
      new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "does/not/exist.ts",
        ...llmOptions,
      }).execute(),
    ).rejects.toThrow("Path does not exist: does/not/exist.ts");

    const lines = readAnalyzeLog();
    const errorLine = lines.find((l) => l.event === "analyze.focused.error");
    expect(errorLine).toBeDefined();
    expect(errorLine?.message).toBe("Path does not exist: does/not/exist.ts");
  });

  it("returns an empty decisionExtraction result and never resolves TOKENS.LlmClient when no eligible files are found", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# no source files here");
    // README.md is not a supported source extension, so nothing is collected.

    const llmClientBuilderProvider = vi.fn(() => () => ({}) as ILlmClient);
    docuviaFactory.register(TOKENS.LlmClient, llmClientBuilderProvider);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "README.md",
      ...llmOptions,
    }).execute();

    expect(result).toEqual({
      kind: "decisionExtraction",
      targetPath: "README.md",
      decisions: [],
      persisted: 0,
      deduped: 0,
    });
    expect(llmClientBuilderProvider).not.toHaveBeenCalled();
  });

  it("happy path: resolves TOKENS.LlmClient, calls chatCompletion with the verbatim system prompt + collected file content, and maps the JSON response", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "sample.ts"),
      "export const x = 1; // a decision-worthy comment\n",
    );

    const mockLlmClient: ILlmClient = {
      initialize: vi.fn(),
      chatCompletion: vi.fn().mockResolvedValue({
        id: "chatcmpl-1",
        model: "test-model",
        choices: [
          {
            index: 0,
            finishReason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify([
                {
                  title: "Uses a const export",
                  nodeType: "decision",
                  content: "x is exported as a const.",
                  confidence: 0.9,
                },
              ]),
            },
          },
        ],
      }),
      streamChatCompletion: vi.fn(),
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
    };
    docuviaFactory.register(TOKENS.LlmClient, () => () => mockLlmClient);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "sample.ts",
      ...llmOptions,
    }).execute();

    expect(mockLlmClient.initialize).toHaveBeenCalledWith({
      baseUrl: llmOptions.llmBaseUrl,
      apiKey: llmOptions.llmApiKey,
    });

    expect(mockLlmClient.chatCompletion).toHaveBeenCalledTimes(1);
    const request = vi.mocked(mockLlmClient.chatCompletion).mock.calls[0][0];
    expect(request.model).toBe(llmOptions.llmModel);
    expect(request.temperature).toBe(0.2);
    expect(request.messages[0]).toEqual({
      role: "system",
      content: DECISION_EXTRACTION_SYSTEM_PROMPT,
    });
    expect(request.messages[1].role).toBe("user");
    expect(request.messages[1].content).toContain("--- sample.ts ---");
    expect(request.messages[1].content).toContain(
      "export const x = 1; // a decision-worthy comment",
    );

    expect(result).toEqual({
      kind: "decisionExtraction",
      targetPath: "sample.ts",
      decisions: [
        {
          title: "Uses a const export",
          nodeType: "decision",
          content: "x is exported as a const.",
          confidence: 0.9,
        },
      ],
      persisted: 0,
      deduped: 0,
    });

    const lines = readAnalyzeLog();
    expect(lines.some((l) => l.event === "analyze.focused.start")).toBe(true);
    const summary = lines.find((l) => l.event === "analyze.focused.summary");
    expect(summary?.decisionsCount).toBe(1);
  });

  it("strips a ```json ... ``` markdown fence before parsing (regression: live Mistral smoke test)", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    // Real shape observed from a live Mistral (CLIProxyAPI-compatible) backend: the model wraps
    // an otherwise well-formed JSON array response in a ```json fence even though the system
    // prompt asks it not to.
    registerLlmClientReturning(
      "```json\n" +
        JSON.stringify(
          [
            {
              title: "process.exitCode used instead of process.exit()",
              nodeType: "rule",
              content:
                "Both branches of analyzeCommand set process.exitCode = 1 rather than calling process.exit(1), avoiding a native crash while network handles are still closing.",
              confidence: 0.95,
            },
            {
              title: "LLM client resolved via TOKENS.LlmClient factory token",
              nodeType: "decision",
              content:
                "The decision-extraction path resolves TOKENS.LlmClient from docuviaFactory rather than importing a concrete client directly, matching the SyncWorkflow pattern for TOKENS.RemoteSyncClient.",
              confidence: 0.9,
            },
            {
              title: "Non-JSON LLM output is reported as LLM_INVALID_RESPONSE",
              nodeType: "context",
              content:
                "Any response body that fails JSON.parse or does not parse to an array is normalized into a single DocuviaError with code LLM_INVALID_RESPONSE.",
              confidence: 0.85,
            },
          ],
          null,
          2,
        ) +
        "\n```",
    );
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "sample.ts",
      ...llmOptions,
    }).execute();

    expect(result.kind).toBe("decisionExtraction");
    expect(
      (result as { decisions: Array<{ title: string }> }).decisions,
    ).toHaveLength(3);
    expect(
      (result as { decisions: Array<{ title: string }> }).decisions[0].title,
    ).toBe("process.exitCode used instead of process.exit()");
  });

  it("strips a bare ``` ... ``` markdown fence (no language tag) before parsing", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(
      "```\n" +
        JSON.stringify([
          {
            title: "Bare-fenced decision",
            nodeType: "decision",
            content: "Wrapped in a fence with no json language tag.",
            confidence: 0.7,
          },
        ]) +
        "\n```",
    );
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "sample.ts",
      ...llmOptions,
    }).execute();

    expect(result).toEqual({
      kind: "decisionExtraction",
      targetPath: "sample.ts",
      decisions: [
        {
          title: "Bare-fenced decision",
          nodeType: "decision",
          content: "Wrapped in a fence with no json language tag.",
          confidence: 0.7,
        },
      ],
      persisted: 0,
      deduped: 0,
    });
  });

  it("still throws LLM_INVALID_RESPONSE when fenced content isn't valid JSON (fence-stripping must not swallow real parse errors)", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(
      "```json\nthis is not json even after stripping\n```",
    );
    docuviaFactory.lock();

    let caught: unknown;
    try {
      await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocuviaError);
    expect((caught as DocuviaError).code).toBe("LLM_INVALID_RESPONSE");
  });

  function registerLlmClientReturning(content: string | null) {
    const mockLlmClient: ILlmClient = {
      initialize: vi.fn(),
      chatCompletion: vi.fn().mockResolvedValue({
        id: "chatcmpl-1",
        model: "test-model",
        choices: [
          {
            index: 0,
            finishReason: "stop",
            message: { role: "assistant", content },
          },
        ],
      }),
      streamChatCompletion: vi.fn(),
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
    };
    docuviaFactory.register(TOKENS.LlmClient, () => () => mockLlmClient);
  }

  it("throws DocuviaError with code LLM_INVALID_RESPONSE and logs analyze.focused.error on non-JSON response content", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning("this is not json");
    docuviaFactory.lock();

    let caught: unknown;
    try {
      await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocuviaError);
    expect((caught as DocuviaError).code).toBe("LLM_INVALID_RESPONSE");

    const lines = readAnalyzeLog();
    expect(lines.some((l) => l.event === "analyze.focused.error")).toBe(true);
  });

  it("§7d watchlist (T10): logs analyze.focused.error and rethrows when the chatCompletion call itself rejects (network/HTTP-level failure, not a parse failure)", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    const mockLlmClient: ILlmClient = {
      initialize: vi.fn(),
      chatCompletion: vi
        .fn()
        .mockRejectedValue(
          new DocuviaError(
            ErrorCodes.LLM_CHAT_COMPLETION_FAILED,
            "connection refused",
          ),
        ),
      streamChatCompletion: vi.fn(),
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
    };
    docuviaFactory.register(TOKENS.LlmClient, () => () => mockLlmClient);
    docuviaFactory.lock();

    let caught: unknown;
    try {
      await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocuviaError);
    expect((caught as DocuviaError).code).toBe("LLM_CHAT_COMPLETION_FAILED");

    const lines = readAnalyzeLog();
    const errorLine = lines.find((l) => l.event === "analyze.focused.error");
    expect(errorLine).toBeDefined();
    expect(errorLine!.message).toBe("connection refused");
  });

  it("throws DocuviaError with code LLM_INVALID_RESPONSE when the response content is null", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(null);
    docuviaFactory.lock();

    let caught: unknown;
    try {
      await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocuviaError);
    expect((caught as DocuviaError).code).toBe("LLM_INVALID_RESPONSE");
  });

  it("throws DocuviaError with code LLM_INVALID_RESPONSE when the parsed JSON is not an array", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(JSON.stringify({}));
    docuviaFactory.lock();

    let caught: unknown;
    try {
      await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DocuviaError);
    expect((caught as DocuviaError).code).toBe("LLM_INVALID_RESPONSE");
  });

  it("defensively coerces missing/wrong-typed fields in the LLM response", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    registerLlmClientReturning(
      JSON.stringify([
        { title: null, nodeType: "not-a-real-type", confidence: "high" },
      ]),
    );
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
      targetPath: "sample.ts",
      ...llmOptions,
    }).execute();

    expect(result).toEqual({
      kind: "decisionExtraction",
      targetPath: "sample.ts",
      decisions: [
        { title: "", nodeType: "context", content: "", confidence: 0 },
      ],
      persisted: 0,
      deduped: 0,
    });
  });

  it("logs a logger.warn referencing dropped files when the file-count cap is exceeded", async () => {
    for (let i = 0; i < MAX_ANALYZE_FILES + 1; i++) {
      fs.writeFileSync(path.join(tmpDir, `file-${i}.ts`), `// file ${i}\n`);
    }
    registerLlmClientReturning(JSON.stringify([]));
    docuviaFactory.lock();

    const logger = createMockLogger();
    await new AnalyzeWorkflow(tmpDir, logger, {
      targetPath: ".",
      ...llmOptions,
    }).execute();

    const warnEvent = logger.events.find(
      (e) =>
        e.level === "warn" &&
        Array.isArray(
          (e.context as { droppedFiles?: string[] })?.droppedFiles,
        ) &&
        (e.context as { droppedFiles: string[] }).droppedFiles.length === 1,
    );
    expect(warnEvent).toBeDefined();
  });

  describe("L3 persistence (phase1-decision-integration.md §3)", () => {
    it("persists each decision through store.l3.upsertDecision with full provenance when the target path resolves an exact node_key match", async () => {
      fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
      registerLlmClientReturning(
        JSON.stringify([
          {
            title: "Uses a const export",
            nodeType: "decision",
            content: "x is exported as a const.",
            confidence: 0.9,
          },
        ]),
      );
      const store = makeMockStore({
        projects: {
          getFirst: vi.fn().mockReturnValue({
            id: 7,
            name: "demo",
            repo_url: "file:///demo",
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
          }),
          insert: vi.fn(),
          getOrInsert: vi.fn(),
          count: vi.fn(),
        },
      });
      (
        store.graph.findNodeIdByNodeKey as ReturnType<typeof vi.fn>
      ).mockImplementation((nodeKey: string) =>
        nodeKey === "sample.ts" ? 42 : undefined,
      );
      registerDefaultPersistenceMocks(store);
      docuviaFactory.lock();

      const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();

      expect(store.l3.upsertDecision).toHaveBeenCalledTimes(1);
      expect(store.l3.upsertDecision).toHaveBeenCalledWith({
        projectId: 7,
        l2NodeId: 42,
        title: "Uses a const export",
        content: "x is exported as a const.",
        nodeType: "decision",
        confidence: 0.9,
        commitSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        extractionModel: llmOptions.llmModel,
        sourceFiles: ["sample.ts"],
      });
      expect(result).toMatchObject({ persisted: 1, deduped: 0 });
      expect(store.close).toHaveBeenCalled();

      const lines = readAnalyzeLog();
      const persistedLine = lines.find(
        (l) => l.event === "analyze.focused.persisted",
      );
      expect(persistedLine).toMatchObject({ persisted: 1, deduped: 0 });
    });

    it("counts persisted vs deduped independently based on each upsertDecision() call's return value", async () => {
      fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
      registerLlmClientReturning(
        JSON.stringify([
          {
            title: "Decision A",
            nodeType: "decision",
            content: "content A",
            confidence: 0.9,
          },
          {
            title: "Decision B",
            nodeType: "decision",
            content: "content B",
            confidence: 0.8,
          },
        ]),
      );
      const store = makeMockStore({
        projects: {
          getFirst: vi.fn().mockReturnValue({ id: 1 } as any),
          insert: vi.fn(),
          getOrInsert: vi.fn(),
          count: vi.fn(),
        },
      });
      (
        store.graph.findNodeIdByNodeKey as ReturnType<typeof vi.fn>
      ).mockReturnValue(1);
      (store.l3.upsertDecision as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ id: 1, deduped: false })
        .mockReturnValueOnce({ id: 2, deduped: true });
      registerDefaultPersistenceMocks(store);
      docuviaFactory.lock();

      const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();

      expect(result).toMatchObject({ persisted: 1, deduped: 1 });
    });

    it("warns and persists nothing (but still returns decisions) when the graph has no project row yet", async () => {
      fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
      registerLlmClientReturning(
        JSON.stringify([
          {
            title: "Some decision",
            nodeType: "decision",
            content: "content",
            confidence: 0.9,
          },
        ]),
      );
      // Default beforeEach store already has getFirst() -> undefined.
      docuviaFactory.lock();

      const logger = createMockLogger();
      const result = await new AnalyzeWorkflow(tmpDir, logger, {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();

      expect(result).toMatchObject({ persisted: 0, deduped: 0 });
      expect(
        result.kind === "decisionExtraction" && result.decisions,
      ).toHaveLength(1);
      expect(
        logger.events.some(
          (e) =>
            e.level === "warn" &&
            e.message === ANALYZE_MESSAGES.NO_GRAPH_TO_ATTACH,
        ),
      ).toBe(true);

      const lines = readAnalyzeLog();
      expect(
        lines.some((l) => l.event === "analyze.focused.persist_skipped"),
      ).toBe(true);
      expect(lines.some((l) => l.event === "analyze.focused.persisted")).toBe(
        false,
      );
    });

    it("warns and persists nothing (exits without throwing) when the local database doesn't exist yet", async () => {
      fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
      registerLlmClientReturning(
        JSON.stringify([
          {
            title: "Some decision",
            nodeType: "decision",
            content: "content",
            confidence: 0.9,
          },
        ]),
      );
      docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
        vi
          .fn()
          .mockRejectedValue(
            new DocuviaError("DB_OPEN_FAILED", "Failed to open database"),
          ),
      );
      docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
      docuviaFactory.lock();

      const logger = createMockLogger();
      const result = await new AnalyzeWorkflow(tmpDir, logger, {
        targetPath: "sample.ts",
        ...llmOptions,
      }).execute();

      expect(result).toMatchObject({ persisted: 0, deduped: 0 });
      expect(
        logger.events.some(
          (e) =>
            e.level === "warn" &&
            e.message === ANALYZE_MESSAGES.NO_GRAPH_TO_ATTACH,
        ),
      ).toBe(true);
    });

    it("resolves the anchor via the first collected source file's L2 node for a directory target with no exact node_key match", async () => {
      fs.mkdirSync(path.join(tmpDir, "src"));
      fs.writeFileSync(
        path.join(tmpDir, "src", "a.ts"),
        "export const a = 1;\n",
      );
      fs.writeFileSync(
        path.join(tmpDir, "src", "b.ts"),
        "export const b = 1;\n",
      );
      registerLlmClientReturning(
        JSON.stringify([
          {
            title: "Directory-level decision",
            nodeType: "decision",
            content: "content",
            confidence: 0.9,
          },
        ]),
      );
      const store = makeMockStore({
        projects: {
          getFirst: vi.fn().mockReturnValue({ id: 1 } as any),
          insert: vi.fn(),
          getOrInsert: vi.fn(),
          count: vi.fn(),
        },
      });
      // No exact match on the directory itself ("src"); only the second file resolves.
      (
        store.graph.findNodeIdByNodeKey as ReturnType<typeof vi.fn>
      ).mockImplementation((nodeKey: string) =>
        nodeKey === "src/b.ts" ? 99 : undefined,
      );
      registerDefaultPersistenceMocks(store);
      docuviaFactory.lock();

      const result = await new AnalyzeWorkflow(tmpDir, createMockLogger(), {
        targetPath: "src",
        ...llmOptions,
      }).execute();

      expect(store.l3.upsertDecision).toHaveBeenCalledWith(
        expect.objectContaining({ l2NodeId: 99 }),
      );
      expect(result).toMatchObject({ persisted: 1, deduped: 0 });
    });
  });
});

describe("stripMarkdownCodeFence()", () => {
  it("strips a ```json ... ``` fence and trims surrounding whitespace", () => {
    const input = "  \n```json\n[1,2,3]\n```\n  ";
    expect(stripMarkdownCodeFence(input)).toBe("[1,2,3]");
  });

  it("strips a bare ``` ... ``` fence with no language tag", () => {
    const input = "```\n[1,2,3]\n```";
    expect(stripMarkdownCodeFence(input)).toBe("[1,2,3]");
  });

  it("returns unfenced content unchanged", () => {
    const input = "[1,2,3]";
    expect(stripMarkdownCodeFence(input)).toBe(input);
  });

  it("returns content unchanged when only the start looks fenced but the end does not", () => {
    const input = "```json\n[1,2,3]";
    expect(stripMarkdownCodeFence(input)).toBe(input);
  });

  it("leaves multi-line, still-invalid-JSON fenced content stripped-but-unparsed (caller's JSON.parse must still fail)", () => {
    const input = "```json\nnot json\n```";
    expect(stripMarkdownCodeFence(input)).toBe("not json");
  });
});
