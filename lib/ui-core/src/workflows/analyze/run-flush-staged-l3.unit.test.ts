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
import { runFlushStagedL3 } from "./run-flush-staged-l3.js";
import {
  stagePendingDecisions,
  readPendingDecisions,
} from "./pending-l3-decisions-store.js";
import type { ExtractedDecision } from "./analyze-result.js";

/** Mirrors `run-agent-authored-write.unit.test.ts`'s mocking style. */
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
      getSemanticCoverage: vi.fn(),
      insertNode: vi.fn(),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn(),
      // Every node_key resolves by default -- individual tests narrow this down.
      findNodeIdByNodeKey: vi.fn().mockReturnValue(1),
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
      // Contract: getByL2NodeId always returns an array (possibly empty) -- the default
      // reflects that instead of undefined, so code relying on the contract fails loudly
      // rather than being defensively papered over.
      getByL2NodeId: vi.fn().mockReturnValue([]),
      upsertDecision: vi.fn().mockReturnValue({ id: 1, deduped: false }),
      importCard: vi.fn(),
      updateValidityStatus: vi.fn(),
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

function registerPersistenceMocks(
  store: IGraphStore,
  gitOverrides: Partial<IGitProvider> = {},
) {
  const openStoreSpy = vi
    .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
    .mockResolvedValue(store);
  docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);
  docuviaFactory.register(TOKENS.GitProvider, () =>
    makeMockGitProvider(gitOverrides),
  );
  return { openStoreSpy };
}

const HEAD_SHA = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";

const oneDecision: ExtractedDecision[] = [
  {
    title: "Agent-authored decision",
    nodeType: "decision",
    content: "Written verbatim, no LLM call.",
    confidence: 0.9,
  },
];

function writeHooksConfig(tmpDir: string, commitL3Write: boolean): void {
  const dir = path.join(tmpDir, ".docuvia");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "hooks-config.json"),
    JSON.stringify({
      "context-injection": true,
      "commit-l3-write": commitL3Write,
      "tier-b-c-prepush": true,
    }),
  );
}

describe("runFlushStagedL3", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-flush-l3-test-"));
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("disabled toggle: no-op, nothing read/written -- staging file untouched, git/store never touched", async () => {
    writeHooksConfig(tmpDir, false);
    // Real file so stagePendingDecisions' roadmap-item-37 anchor-feasibility validation passes.
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    await stagePendingDecisions(
      tmpDir,
      "src/a.ts",
      oneDecision,
      createMockLogger(),
    );
    const beforeRaw = fs.readFileSync(
      path.join(tmpDir, ".docuvia", "pending-l3-decisions.json"),
      "utf-8",
    );
    // Deliberately no GitProvider/GraphStoreOpener registration -- an accidental resolve() call
    // inside the disabled branch would throw (token not registered), failing this test loudly
    // rather than silently passing.
    docuviaFactory.lock();

    const result = await runFlushStagedL3({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
    });

    expect(result).toMatchObject({
      kind: "flushStagedL3",
      skippedDisabled: true,
      flushed: 0,
      deduped: 0,
    });
    const afterRaw = fs.readFileSync(
      path.join(tmpDir, ".docuvia", "pending-l3-decisions.json"),
      "utf-8",
    );
    expect(afterRaw).toBe(beforeRaw);
  });

  it("empty staging file: no-op, nothing read/written", async () => {
    writeHooksConfig(tmpDir, true);
    // No pending-l3-decisions.json at all -- readPendingDecisions() returns [].
    docuviaFactory.lock();

    const result = await runFlushStagedL3({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
    });

    expect(result).toMatchObject({
      kind: "flushStagedL3",
      skippedDisabled: false,
      flushed: 0,
      deduped: 0,
      stillPending: 0,
    });
    expect(
      fs.existsSync(path.join(tmpDir, ".docuvia", "pending-l3-decisions.json")),
    ).toBe(false);
  });

  it("mixed staged entries: only the subset whose filePath is in this commit's diff is flushed and removed; the rest survives untouched", async () => {
    writeHooksConfig(tmpDir, true);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpDir, "src", "b.ts"), "export const b = 1;\n");
    await stagePendingDecisions(
      tmpDir,
      "src/a.ts",
      oneDecision,
      createMockLogger(),
    );
    await stagePendingDecisions(
      tmpDir,
      "src/b.ts",
      [{ ...oneDecision[0], title: "Not in this commit" }],
      createMockLogger(),
    );

    const store = makeMockStore();
    registerPersistenceMocks(store, {
      getHeadSha: vi.fn().mockResolvedValue(HEAD_SHA),
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    docuviaFactory.lock();

    const result = await runFlushStagedL3({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
    });

    expect(result).toMatchObject({
      flushed: 1,
      deduped: 0,
      stillPending: 1,
      commitSha: HEAD_SHA,
    });
    expect(store.l3.upsertDecision).toHaveBeenCalledTimes(1);
    expect(store.l3.upsertDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        commitSha: HEAD_SHA,
        source: "agent-authored",
      }),
    );

    const stillStaged = await readPendingDecisions(tmpDir, createMockLogger());
    expect(stillStaged).toHaveLength(1);
    expect(stillStaged[0]).toMatchObject({
      filePath: "src/b.ts",
      title: "Not in this commit",
    });
  });

  it("a persist failure mid-loop leaves the entire staging file unchanged (no partial-drop)", async () => {
    writeHooksConfig(tmpDir, true);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpDir, "src", "b.ts"), "export const b = 1;\n");
    await stagePendingDecisions(
      tmpDir,
      "src/a.ts",
      oneDecision,
      createMockLogger(),
    );
    await stagePendingDecisions(
      tmpDir,
      "src/b.ts",
      [{ ...oneDecision[0], title: "Second file" }],
      createMockLogger(),
    );

    const store = makeMockStore();
    (store.l3.upsertDecision as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ id: 1, deduped: false }) // src/a.ts succeeds
      .mockImplementationOnce(() => {
        throw new Error("simulated store failure");
      }); // src/b.ts throws
    registerPersistenceMocks(store, {
      getHeadSha: vi.fn().mockResolvedValue(HEAD_SHA),
      getFilesChangedByCommit: vi
        .fn()
        .mockResolvedValue(["src/a.ts", "src/b.ts"]),
    });
    docuviaFactory.lock();

    const beforeRaw = fs.readFileSync(
      path.join(tmpDir, ".docuvia", "pending-l3-decisions.json"),
      "utf-8",
    );

    const result = await runFlushStagedL3({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
    });

    // Never throws -- the caller (the post-commit hook) is a fire-and-forget background process.
    expect(result.kind).toBe("flushStagedL3");
    expect(store.l3.upsertDecision).toHaveBeenCalledTimes(2);

    const afterRaw = fs.readFileSync(
      path.join(tmpDir, ".docuvia", "pending-l3-decisions.json"),
      "utf-8",
    );
    expect(afterRaw).toBe(beforeRaw);
    const stillStaged = await readPendingDecisions(tmpDir, createMockLogger());
    expect(stillStaged.map((d) => d.filePath).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("drops (does not retry forever) a staged entry whose file was deleted by this commit", async () => {
    writeHooksConfig(tmpDir, true);
    // Staged against a real file so stagePendingDecisions' own node_key normalization runs
    // normally, then the file is deleted before the flush runs -- simulating "this commit
    // deleted the file the decision was staged against".
    fs.writeFileSync(path.join(tmpDir, "src-deleted.ts"), "export {};\n");
    await stagePendingDecisions(
      tmpDir,
      "src-deleted.ts",
      oneDecision,
      createMockLogger(),
    );
    fs.rmSync(path.join(tmpDir, "src-deleted.ts"));

    const store = makeMockStore();
    registerPersistenceMocks(store, {
      getHeadSha: vi.fn().mockResolvedValue(HEAD_SHA),
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src-deleted.ts"]),
    });
    docuviaFactory.lock();

    const logger = createMockLogger();
    const result = await runFlushStagedL3({
      workspaceRoot: tmpDir,
      logger,
    });

    expect(result).toMatchObject({ flushed: 0, deduped: 0, stillPending: 0 });
    expect(store.l3.upsertDecision).not.toHaveBeenCalled();
    expect(
      logger.events.some(
        (e) => e.level === "warn" && e.message.includes("src-deleted.ts"),
      ),
    ).toBe(true);
    const stillStaged = await readPendingDecisions(tmpDir, createMockLogger());
    expect(stillStaged).toEqual([]);
  });

  it("a swallowed skip (no graph to attach yet, {persisted:0, deduped:0} without throwing) leaves the entry staged for a future flush, not lost", async () => {
    writeHooksConfig(tmpDir, true);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    await stagePendingDecisions(
      tmpDir,
      "src/a.ts",
      oneDecision,
      createMockLogger(),
    );

    const store = makeMockStore({
      graph: {
        deleteNodesForPath: vi.fn(),
        getSemanticCoverage: vi.fn(),
        insertNode: vi.fn(),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        // No anchor resolves -- mirrors run-agent-authored-write's "unresolvable anchor" case.
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
    });
    registerPersistenceMocks(store, {
      getHeadSha: vi.fn().mockResolvedValue(HEAD_SHA),
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    docuviaFactory.lock();

    const result = await runFlushStagedL3({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
    });

    // issue #57: the result must tell the CLI *why* nothing flushed -- the no-graph-to-attach
    // state -- so it can print the "run docuvia init" nudge instead of an unexplained
    // "0 flushed, 1 left staged".
    expect(result).toMatchObject({
      flushed: 0,
      deduped: 0,
      stillPending: 1,
      noGraphToAttach: true,
    });
    expect(store.l3.upsertDecision).not.toHaveBeenCalled();

    const stillStaged = await readPendingDecisions(tmpDir, createMockLogger());
    expect(stillStaged).toHaveLength(1);
    expect(stillStaged[0].filePath).toBe("src/a.ts");
  });

  it("reports noGraphToAttach: false when the flush fully lands (mixed staging test's healthy counterpart -- issue #57 doesn't false-positive on a populated graph)", async () => {
    writeHooksConfig(tmpDir, true);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    await stagePendingDecisions(
      tmpDir,
      "src/a.ts",
      oneDecision,
      createMockLogger(),
    );

    const store = makeMockStore();
    registerPersistenceMocks(store, {
      getHeadSha: vi.fn().mockResolvedValue(HEAD_SHA),
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    docuviaFactory.lock();

    const result = await runFlushStagedL3({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
    });

    expect(result).toMatchObject({
      flushed: 1,
      deduped: 0,
      stillPending: 0,
      noGraphToAttach: false,
    });
  });

  it("warns on a same-anchor contradiction but still flushes (issue #68 -- warn, never block)", async () => {
    writeHooksConfig(tmpDir, true);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    await stagePendingDecisions(
      tmpDir,
      "src/a.ts",
      [
        {
          title: "Agent-authored decision",
          nodeType: "decision",
          content: "Divergent rewrite of the same claim.",
          confidence: 0.9,
        },
      ],
      createMockLogger(),
    );

    const store = makeMockStore();
    // An existing decision on the same anchor making the same titled claim with different
    // content -- exactly the deterministic contradiction rule's trigger shape.
    store.l3.getByL2NodeId = vi.fn().mockReturnValue([
      {
        id: 42,
        l2_node_id: 1,
        title: "agent-authored DECISION",
        content: "Original wording.",
        node_type: "decision",
        source_commits: "[]",
        commit_hash: "feed0000",
        ai_generated: 1,
        confidence: 0.9,
        noise_score: null,
        created_at: "2026-08-23 00:00:00",
        last_verified_at: null,
        occurrence_count: 1,
        introduced_in_commit: null,
        verified_until_commit: null,
        validity_status: "pending",
        source: "analyze",
        content_hash: null,
        extraction_model: null,
        source_files: null,
        initial_source_commits: null,
        anchor_ranges: null,
      },
    ]);
    registerPersistenceMocks(store, {
      getHeadSha: vi.fn().mockResolvedValue(HEAD_SHA),
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    docuviaFactory.lock();

    const logger = createMockLogger();
    const result = await runFlushStagedL3({ workspaceRoot: tmpDir, logger });

    // The write proceeds -- the warning never blocks the flush.
    expect(result).toMatchObject({ flushed: 1, deduped: 0 });
    expect(store.l3.upsertDecision).toHaveBeenCalledTimes(1);
    expect(
      logger.events.some(
        (e) =>
          e.level === "warn" &&
          e.message.includes("conflicts with an existing analyze decision"),
      ),
    ).toBe(true);
  });

  it("flushes silently when nothing on the anchor contradicts (issue #68 check is quiet on clean anchors)", async () => {
    writeHooksConfig(tmpDir, true);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
    await stagePendingDecisions(
      tmpDir,
      "src/a.ts",
      oneDecision,
      createMockLogger(),
    );

    const store = makeMockStore();
    store.l3.getByL2NodeId = vi.fn().mockReturnValue([]);
    registerPersistenceMocks(store, {
      getHeadSha: vi.fn().mockResolvedValue(HEAD_SHA),
      getFilesChangedByCommit: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    docuviaFactory.lock();

    const logger = createMockLogger();
    const result = await runFlushStagedL3({ workspaceRoot: tmpDir, logger });

    expect(result).toMatchObject({ flushed: 1 });
    expect(
      logger.events.some((e) => e.message.includes("conflicts with")),
    ).toBe(false);
  });
});
