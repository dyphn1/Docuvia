import { vi } from "vitest";
import type { IGraphStore } from "../interfaces/graph-store.interfaces.js";
import type { IGitProvider } from "../interfaces/git.interfaces.js";
import type { IKnowledgeGitService } from "../interfaces/knowledge-git.interfaces.js";

/**
 * Shared IGraphStore mock factory — eliminates the ~30 duplicate `makeMockStore()` helpers
 * scattered across unit test files. Every property is a `vi.fn()` with a sensible default;
 * callers override specific methods via `Partial<IGraphStore>` spread.
 *
 * ```ts
 * const store = makeMockStore({
 *   meta: { get: vi.fn().mockReturnValue("42"), set: vi.fn() },
 * });
 * ```
 */
export function makeMockStore(
  overrides: Partial<IGraphStore> = {},
): IGraphStore {
  return {
    projects: {
      getFirst: vi.fn(),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn(),
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
      findNodeIdByName: vi.fn(),
      findNodeIdByNodeKey: vi.fn(),
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
    meta: { get: vi.fn(), set: vi.fn() },
    callSites: {
      deleteForFile: vi.fn(),
      insertMany: vi.fn(),
      getForFiles: vi.fn().mockReturnValue(new Map()),
      getByTargetFunctions: vi.fn().mockReturnValue(new Map()),
    },
    withWriteLock: async (fn: any) => fn(),
    withTransaction: (fn: any) => fn(),
    withReadLock: async (fn: any) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi
      .fn()
      .mockReturnValue({ prunedFiles: 0, prunedNodes: 0 }),
    ...overrides,
  };
}

/**
 * Shared IGitProvider mock factory. Returns a minimal mock where every method resolves to a
 * sensible default; callers override specific methods via `Partial<IGitProvider>` spread.
 */
export function makeMockGitProvider(
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
  } as IGitProvider;
}

/**
 * Shared IKnowledgeGitService mock factory. Every method resolves to a sensible default;
 * callers override specific methods via `Partial<IKnowledgeGitService>` spread.
 */
export function makeMockKnowledgeGit(
  overrides: Partial<IKnowledgeGitService> = {},
): IKnowledgeGitService {
  return {
    ensureKnowledgeBranch: vi.fn().mockResolvedValue({ created: false }),
    installPostCommitHook: vi.fn().mockResolvedValue({ installed: false }),
    installPrePushHook: vi.fn().mockResolvedValue({ installed: false }),
    removePostCommitHook: vi.fn().mockResolvedValue({ removed: false }),
    removePrePushHook: vi.fn().mockResolvedValue({ removed: false }),
    deleteKnowledgeBranch: vi.fn().mockResolvedValue({ deleted: false }),
    repairDuplicatePostCommitHook: vi
      .fn()
      .mockResolvedValue({ repaired: false }),
    packSnapshotToKnowledgeBranch: vi.fn().mockResolvedValue(undefined),
    syncKnowledgeBranch: vi.fn().mockResolvedValue({ status: "no-remote" }),
    resolveNewestSourceTrailerSha: vi.fn().mockResolvedValue(undefined),
    runUnderKnowledgeLock: vi
      .fn()
      .mockImplementation((_cwd: string, fn: () => Promise<unknown>) => fn()),
    ...overrides,
  };
}
