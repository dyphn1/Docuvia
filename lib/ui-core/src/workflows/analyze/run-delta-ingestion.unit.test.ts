import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type ChangedFileEntry,
  type DiscoveredFile,
  type IAstProcessor,
  type IGitProvider,
  type IGraphPersister,
  type IGraphStore,
  type IKnowledgeGitService,
  type ISemanticDiffAnalyzer,
} from "@workspace/contracts";
import { CURRENT_NODE_KEY_FORMAT_VERSION, GitConstants } from "@workspace/core";
import { runDeltaIngestion } from "./run-delta-ingestion.js";
import { runFullIngestion } from "./run-full-ingestion.js";
import { readTierBQueue } from "./tier-b-queue.js";

// Mirrors run-full-ingestion.unit.test.ts / init-workflow.unit.test.ts's mocking pattern
// (Factory Lock, pure orchestration unit test). runDeltaIngestion's own
// store.graph.deleteNodesForPath() calls for deleted files are asserted directly; the
// "modified file re-parsed, old rows replaced" half of that guarantee for *reparsed* files
// lives inside GraphPersisterService.persist() itself (already covered by
// lib/core/src/graph/persist-ast-graph.unit.test.ts) -- here we assert the delta wiring feeds
// the right file list into that persist step.

// GRPH-006's node-key-format-stale delegation (§Step 7) is a dispatch decision, not
// runFullIngestion's own behavior -- that's covered by run-full-ingestion.unit.test.ts. Mocking
// the module here isolates runDeltaIngestion's guard from runFullIngestion's real (heavier)
// implementation, mirroring analyze-workflow.unit.test.ts's identical precedent for the same
// two modules.
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

function makeMockStore(): IGraphStore {
  // GRPH-006: seeded to the current format version by default, matching a graph produced by a
  // full ingestion that already ran under this codebase -- keeps every pre-existing test below
  // exercising the ordinary delta path rather than the new stale-format guard (§Step 7's own
  // tests seed this key explicitly to cover the guard itself).
  const meta = new Map<string, string>([
    [
      GitConstants.META_KEY_NODE_KEY_FORMAT_VERSION,
      CURRENT_NODE_KEY_FORMAT_VERSION,
    ],
  ]);
  return {
    projects: {
      getFirst: vi.fn(),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn(),
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
      count: vi.fn().mockReturnValue({ l2Nodes: 3, l3Nodes: 0 }),
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
      getByL2NodeId: vi.fn(),
      upsertDecision: vi.fn(),
      importCard: vi.fn(),
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

const FROM_SHA = "1111111111111111111111111111111111111a";
const HEAD_SHA = "2222222222222222222222222222222222222b";

describe("runDeltaIngestion()", () => {
  let tmpDir: string;
  let store: IGraphStore;
  let astProcessor: IAstProcessor;
  let graphPersister: IGraphPersister & { persist: ReturnType<typeof vi.fn> };
  let semanticDiffAnalyzer: ISemanticDiffAnalyzer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-run-delta-ingestion-"),
    );
    store = makeMockStore();
    vi.mocked(runFullIngestion).mockClear();

    resetFactoryForTests();

    astProcessor = {
      processFiles: vi
        .fn()
        .mockImplementation(async (_root: string, files: DiscoveredFile[]) => ({
          parsed: files.map((f) => ({
            file: f.file,
            hash: f.hash,
            data: {
              imports: [],
              exports: [],
              functions: [],
              classes: [],
              calls: [],
            },
            language: "typescript",
          })),
          failures: [],
        })),
    };
    graphPersister = {
      persist: vi.fn().mockResolvedValue({ updatedCount: 1 }),
    };
    semanticDiffAnalyzer = { analyzeFile: vi.fn().mockResolvedValue([]) };

    docuviaFactory.register(TOKENS.AstProcessor, () => astProcessor);
    docuviaFactory.register(TOKENS.GraphPersister, () => graphPersister);
    docuviaFactory.register(
      TOKENS.SemanticDiffAnalyzer,
      () => semanticDiffAnalyzer,
    );
    docuviaFactory.lock();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("re-parses a modified file through astProcessor/graphPersister", async () => {
    const entries: ChangedFileEntry[] = [
      { file: "src/a.ts", status: "modified" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef: vi
        .fn()
        .mockImplementation(async (_root, ref) =>
          ref === HEAD_SHA ? "new content" : "old content",
        ),
    });

    const result = await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(astProcessor.processFiles).toHaveBeenCalledWith(
      tmpDir,
      expect.arrayContaining([expect.objectContaining({ file: "src/a.ts" })]),
    );
    expect(graphPersister.persist).toHaveBeenCalled();
    expect(result.kind).toBe("autoDelta");
    if (result.kind === "autoDelta") {
      expect(result.filesReparsed).toBe(1);
      expect(result.filesDeleted).toBe(0);
    }
  });

  it("drops a deleted file's L2 rows via store.graph.deleteNodesForPath without re-parsing it", async () => {
    const entries: ChangedFileEntry[] = [
      { file: "src/gone.ts", status: "deleted" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
    });

    const result = await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(store.graph.deleteNodesForPath).toHaveBeenCalledWith("src/gone.ts");
    expect(astProcessor.processFiles).not.toHaveBeenCalled();
    expect(result.kind).toBe("autoDelta");
    if (result.kind === "autoDelta") expect(result.filesDeleted).toBe(1);
  });

  it("treats a renamed file as delete (old path) plus add (new path), skipping detector classification", async () => {
    const entries: ChangedFileEntry[] = [
      {
        file: "src/new-name.ts",
        status: "renamed",
        oldFile: "src/old-name.ts",
      },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef: vi.fn().mockResolvedValue("renamed content"),
    });

    const result = await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(store.graph.deleteNodesForPath).toHaveBeenCalledWith(
      "src/old-name.ts",
    );
    expect(astProcessor.processFiles).toHaveBeenCalledWith(
      tmpDir,
      expect.arrayContaining([
        expect.objectContaining({ file: "src/new-name.ts" }),
      ]),
    );
    expect(semanticDiffAnalyzer.analyzeFile).not.toHaveBeenCalled();
    expect(result.kind).toBe("autoDelta");
    if (result.kind === "autoDelta") expect(result.filesDeleted).toBe(1);
  });

  it("filters changed files by the discovery ignore rule (non-source file is dropped)", async () => {
    const entries: ChangedFileEntry[] = [
      { file: "README.md", status: "modified" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
    });

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(astProcessor.processFiles).not.toHaveBeenCalled();
  });

  it("enqueues a CONTRACT_CHANGED-classified modified file into the Tier B queue", async () => {
    const entries: ChangedFileEntry[] = [
      { file: "src/a.ts", status: "modified" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef: vi
        .fn()
        .mockImplementation(async (_root, ref) =>
          ref === HEAD_SHA ? "new content" : "old content",
        ),
      getChangedLineRanges: vi
        .fn()
        .mockResolvedValue([{ startRow: 0, endRow: 1 }]),
    });
    semanticDiffAnalyzer.analyzeFile = vi.fn().mockResolvedValue([
      {
        nodeId: "foo",
        nodeType: "function_declaration",
        pruningLevel: 1,
        newRange: { startRow: 0, endRow: 1 },
      },
    ]);

    const result = await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(readTierBQueue(store)).toEqual([
      { file: "src/a.ts", commitSha: HEAD_SHA },
    ]);
    expect(result.kind).toBe("autoDelta");
    if (result.kind === "autoDelta") expect(result.tierBQueued).toBe(1);
  });

  it("classifies and enqueues an added file into the Tier B queue without reading its old content from git", async () => {
    const entries: ChangedFileEntry[] = [
      { file: "src/new.ts", status: "added" },
    ];
    const readFileAtRef = vi
      .fn()
      .mockImplementation(async (_root, ref) =>
        ref === HEAD_SHA ? "new content" : undefined,
      );
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef,
      getChangedLineRanges: vi
        .fn()
        .mockResolvedValue([{ startRow: 0, endRow: 1 }]),
    });
    semanticDiffAnalyzer.analyzeFile = vi.fn().mockResolvedValue([
      {
        nodeId: "foo",
        nodeType: "function_declaration",
        pruningLevel: 1,
        newRange: { startRow: 0, endRow: 1 },
      },
    ]);

    const result = await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(readTierBQueue(store)).toEqual([
      { file: "src/new.ts", commitSha: HEAD_SHA },
    ]);
    expect(result.kind).toBe("autoDelta");
    if (result.kind === "autoDelta") expect(result.tierBQueued).toBe(1);
    expect(semanticDiffAnalyzer.analyzeFile).toHaveBeenCalledWith(
      expect.objectContaining({ oldContent: "" }),
    );
    expect(readFileAtRef).not.toHaveBeenCalledWith(
      tmpDir,
      FROM_SHA,
      "src/new.ts",
    );
  });

  it("does not enqueue a modified file classified as INTERNAL_LOGIC only", async () => {
    const entries: ChangedFileEntry[] = [
      { file: "src/a.ts", status: "modified" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef: vi
        .fn()
        .mockImplementation(async (_root, ref) =>
          ref === HEAD_SHA ? "new content" : "old content",
        ),
      getChangedLineRanges: vi
        .fn()
        .mockResolvedValue([{ startRow: 0, endRow: 1 }]),
    });
    semanticDiffAnalyzer.analyzeFile = vi.fn().mockResolvedValue([
      {
        nodeId: "foo",
        nodeType: "function_declaration",
        pruningLevel: 0,
        newRange: { startRow: 0, endRow: 1 },
      },
    ]);

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(readTierBQueue(store)).toEqual([]);
  });

  it("runs the persist step under the knowledge-branch lock", async () => {
    const entries: ChangedFileEntry[] = [
      { file: "src/a.ts", status: "modified" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef: vi.fn().mockResolvedValue("content"),
    });
    const knowledgeGit = makeMockKnowledgeGit();

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit,
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(knowledgeGit.runUnderKnowledgeLock).toHaveBeenCalledWith(
      tmpDir,
      expect.any(Function),
    );
  });

  it("writes the last-ingested-source-sha meta key to headSha even when nothing needed re-parsing", async () => {
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue([]),
    });

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(store.meta.set).toHaveBeenCalledWith(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      HEAD_SHA,
    );
  });

  it("§9m item 1: accumulates tierBChangedBytes by the re-parsed file's content byte length, adding to any prior total", async () => {
    store.meta.set(GitConstants.META_KEY_TIER_B_CHANGED_BYTES, "100");
    const content = "x".repeat(50);
    const entries: ChangedFileEntry[] = [
      { file: "src/a.ts", status: "modified" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef: vi.fn().mockResolvedValue(content),
    });

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(store.meta.get(GitConstants.META_KEY_TIER_B_CHANGED_BYTES)).toBe(
      String(100 + Buffer.byteLength(content, "utf8")),
    );
  });

  it("§9m item 1: does not write tierBChangedBytes when nothing needed re-parsing", async () => {
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue([]),
    });

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(
      store.meta.get(GitConstants.META_KEY_TIER_B_CHANGED_BYTES),
    ).toBeUndefined();
  });

  it("logs analyze.delta.start and analyze.delta.summary JSONL lines", async () => {
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue([]),
    });

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.event === "analyze.delta.start")).toBe(true);
    expect(lines.some((l) => l.event === "analyze.delta.summary")).toBe(true);
  });

  it("enqueues a filtered commit message into the Tier C queue (§9b/§9e)", async () => {
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue([]),
      getCommitLog: vi.fn().mockResolvedValue([
        {
          sha: HEAD_SHA,
          message: "feat: add a substantive delta-ingestion change",
        },
        { sha: "middle-sha", message: "chore: bump a dependency" },
        { sha: FROM_SHA, message: "feat: an older, already-ingested commit" },
      ]),
    });

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    const { readTierCQueue } = await import("./tier-c-queue.js");
    const queue = readTierCQueue(store);
    expect(queue).toEqual([
      {
        kind: "commitMessage",
        target: HEAD_SHA,
        commitSha: HEAD_SHA,
        message: "feat: add a substantive delta-ingestion change",
      },
    ]);
  });

  it("logs an oversized skip exactly once, to analyze.log (never duplicated into init.log)", async () => {
    const entries: ChangedFileEntry[] = [
      { file: "src/huge.ts", status: "modified" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef: vi.fn().mockResolvedValue("x".repeat(600_000)),
    });

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    const analyzeLogPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const analyzeLines = fs
      .readFileSync(analyzeLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const skippedLines = analyzeLines.filter(
      (l) => l.event === "analyze.delta.file_skipped_oversized",
    );
    expect(skippedLines).toHaveLength(1);
    expect(skippedLines[0].file).toBe("src/huge.ts");

    const initLogPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    expect(fs.existsSync(initLogPath)).toBe(false);
  });

  it("logs a delta parse failure to analyze.log as analyze.delta.parse_failure, not init.log", async () => {
    astProcessor.processFiles = vi.fn().mockResolvedValue({
      parsed: [],
      failures: [
        {
          file: "src/broken.ts",
          hash: "h",
          error: "Worker exited with code 1",
        },
      ],
    });
    const entries: ChangedFileEntry[] = [
      { file: "src/broken.ts", status: "modified" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef: vi.fn().mockResolvedValue("content"),
    });

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    const analyzeLogPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const analyzeLines = fs
      .readFileSync(analyzeLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const failureLine = analyzeLines.find(
      (l) => l.event === "analyze.delta.parse_failure",
    );
    expect(failureLine).toBeDefined();
    expect(failureLine.file).toBe("src/broken.ts");

    const initLogPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    expect(fs.existsSync(initLogPath)).toBe(false);
  });

  it("enqueues a CONTRACT_CHANGED symbol into the Tier C queue, keyed by node_key", async () => {
    const entries: ChangedFileEntry[] = [
      { file: "src/a.ts", status: "modified" },
    ];
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue(entries),
      readFileAtRef: vi
        .fn()
        .mockImplementation(async (_root, ref) =>
          ref === HEAD_SHA ? "new content" : "old content",
        ),
      getChangedLineRanges: vi
        .fn()
        .mockResolvedValue([{ startRow: 0, endRow: 1 }]),
    });
    semanticDiffAnalyzer.analyzeFile = vi.fn().mockResolvedValue([
      {
        nodeId: "foo",
        nodeType: "function_declaration",
        pruningLevel: 1,
        newRange: { startRow: 0, endRow: 1 },
      },
    ]);

    await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    const { readTierCQueue } = await import("./tier-c-queue.js");
    expect(readTierCQueue(store)).toEqual([
      {
        kind: "contractSymbol",
        target: "src/a.ts#foo",
        commitSha: HEAD_SHA,
        file: "src/a.ts",
      },
    ]);
  });

  it("GRPH-006: delegates to runFullIngestion instead of delta-ingesting when the node_key format stamp is stale/missing", async () => {
    store.meta.set(GitConstants.META_KEY_NODE_KEY_FORMAT_VERSION, "1");
    const git = makeMockGitProvider({
      getChangedFilesSince: vi.fn().mockResolvedValue([]),
    });

    const result = await runDeltaIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeMockKnowledgeGit(),
      projectId: 1,
      fromSha: FROM_SHA,
      headSha: HEAD_SHA,
    });

    expect(runFullIngestion).toHaveBeenCalledWith({
      workspaceRoot: tmpDir,
      logger: expect.anything(),
      store,
      git,
    });
    expect(astProcessor.processFiles).not.toHaveBeenCalled();
    expect(result.kind).toBe("autoFullIngestion");

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(
      lines.some((l) => l.event === "analyze.delta.node_key_format_stale"),
    ).toBe(true);
  });
});
