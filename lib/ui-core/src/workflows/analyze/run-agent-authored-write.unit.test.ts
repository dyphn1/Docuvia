import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type GraphStoreOpenOptions,
  type IGitProvider,
  type IGraphStore,
} from "@workspace/contracts";
import { runAgentAuthoredWrite } from "./run-agent-authored-write.js";
import type { ExtractedDecision } from "./analyze-result.js";

/** Mirrors `run-full-ingestion.unit.test.ts`'s/`analyze-workflow.unit.test.ts`'s mocking style. */
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

function makeMockStore(overrides: Partial<IGraphStore> = {}): IGraphStore {
  return {
    projects: {
      getFirst: vi.fn().mockReturnValue({ id: 7 }),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn(),
    },
    files: {
      getAllHashes: vi.fn(),
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
      withFtsSyncSuspended: (fn: any) => fn(),
    },
    l3: {
      getById: vi.fn(),
      getAllExportable: vi.fn(),
      getByL2NodeId: vi.fn(),
      upsertDecision: vi.fn().mockReturnValue({ id: 1, deduped: false }),
      importCard: vi.fn(),
    },
    fts: { searchL2Nodes: vi.fn(), searchL3Nodes: vi.fn() },
    meta: { get: vi.fn(), set: vi.fn() },
    callSites: {
      deleteForFile: vi.fn(),
      insertMany: vi.fn(),
      getForFiles: vi.fn().mockReturnValue(new Map()),
    },
    withWriteLock: async (fn) => fn(),
    withTransaction: (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
    pruneMissingFiles: vi.fn(),
    ...overrides,
  };
}

function registerPersistenceMocks(store: IGraphStore) {
  const openStoreSpy = vi
    .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
    .mockResolvedValue(store);
  docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);
  docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
  return { openStoreSpy };
}

const oneDecision: ExtractedDecision[] = [
  {
    title: "Agent-authored decision",
    nodeType: "decision",
    content: "Written verbatim, no LLM call.",
    confidence: 0.9,
  },
];

describe("runAgentAuthoredWrite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-agent-authored-write-test-"),
    );
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws FS_READ_FAILED when the target path does not exist", async () => {
    docuviaFactory.lock();

    await expect(
      runAgentAuthoredWrite({
        workspaceRoot: tmpDir,
        logger: createMockLogger(),
        targetPath: "does/not/exist.ts",
        decisions: oneDecision,
      }),
    ).rejects.toThrow("Path does not exist: does/not/exist.ts");
  });

  it("throws INVALID_INPUT for a single non-source file that can never anchor (roadmap item 37)", async () => {
    fs.writeFileSync(path.join(tmpDir, "notes.md"), "# a note\n");
    docuviaFactory.lock();

    await expect(
      runAgentAuthoredWrite({
        workspaceRoot: tmpDir,
        logger: createMockLogger(),
        targetPath: "notes.md",
        decisions: oneDecision,
      }),
    ).rejects.toThrow("cannot anchor a decision to notes.md");
  });

  it("empty decisions array short-circuits before collectSourceFiles/store is ever opened", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    const openStoreSpy = vi.fn();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);
    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    docuviaFactory.lock();

    const result = await runAgentAuthoredWrite({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      targetPath: "sample.ts",
      decisions: [],
    });

    expect(result).toEqual({
      kind: "decisionExtraction",
      targetPath: "sample.ts",
      decisions: [],
      persisted: 0,
      deduped: 0,
    });
    expect(openStoreSpy).not.toHaveBeenCalled();
  });

  it("resolves the anchor via an exact node_key match and persists with source: 'agent-authored'", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    const store = makeMockStore();
    (
      store.graph.findNodeIdByNodeKey as ReturnType<typeof vi.fn>
    ).mockImplementation((nodeKey: string) =>
      nodeKey === "sample.ts" ? 42 : undefined,
    );
    registerPersistenceMocks(store);
    docuviaFactory.lock();

    const result = await runAgentAuthoredWrite({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      targetPath: "sample.ts",
      decisions: oneDecision,
    });

    expect(store.l3.upsertDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        l2NodeId: 42,
        source: "agent-authored",
        title: "Agent-authored decision",
      }),
    );
    expect(result).toMatchObject({
      kind: "decisionExtraction",
      persisted: 1,
      deduped: 0,
    });
    expect(store.close).toHaveBeenCalled();
  });

  it("resolves the anchor via the first collected source file's L2 node when there is no exact node_key match", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    const store = makeMockStore();
    (
      store.graph.findNodeIdByNodeKey as ReturnType<typeof vi.fn>
    ).mockImplementation((nodeKey: string) =>
      nodeKey === "src/a.ts" ? 99 : undefined,
    );
    registerPersistenceMocks(store);
    docuviaFactory.lock();

    const result = await runAgentAuthoredWrite({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      targetPath: "src",
      decisions: oneDecision,
    });

    expect(store.l3.upsertDecision).toHaveBeenCalledWith(
      expect.objectContaining({ l2NodeId: 99, source: "agent-authored" }),
    );
    expect(result).toMatchObject({ persisted: 1, deduped: 0 });
  });

  it("warns and persists 0 (no throw) when the anchor is unresolvable", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    const store = makeMockStore();
    // findNodeIdByNodeKey always undefined -- no anchor resolves.
    registerPersistenceMocks(store);
    docuviaFactory.lock();

    const logger = createMockLogger();
    const result = await runAgentAuthoredWrite({
      workspaceRoot: tmpDir,
      logger,
      targetPath: "sample.ts",
      decisions: oneDecision,
    });

    expect(result).toMatchObject({ persisted: 0, deduped: 0 });
    expect(store.l3.upsertDecision).not.toHaveBeenCalled();
    expect(
      logger.events.some(
        (e) => e.level === "warn" && e.message.includes("docuvia init"),
      ),
    ).toBe(true);
  });

  it("aggregates persisted/deduped counts independently across multiple decisions in one call", async () => {
    fs.writeFileSync(path.join(tmpDir, "sample.ts"), "export const x = 1;\n");
    const store = makeMockStore();
    (
      store.graph.findNodeIdByNodeKey as ReturnType<typeof vi.fn>
    ).mockReturnValue(1);
    (store.l3.upsertDecision as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ id: 1, deduped: false })
      .mockReturnValueOnce({ id: 2, deduped: true });
    registerPersistenceMocks(store);
    docuviaFactory.lock();

    const twoDecisions: ExtractedDecision[] = [
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
    ];

    const result = await runAgentAuthoredWrite({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      targetPath: "sample.ts",
      decisions: twoDecisions,
    });

    expect(store.l3.upsertDecision).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ persisted: 1, deduped: 1 });
  });
});
