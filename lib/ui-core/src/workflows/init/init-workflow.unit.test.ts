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
  };
}

function makeMockStore(): IGraphStore {
  let projectRow: ProjectRow | undefined;
  return {
    projects: {
      getFirst: vi.fn().mockImplementation(() => projectRow),
      insert: vi.fn().mockImplementation((input: { name: string; repoUrl: string }) => {
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
      }),
    },
    files: { getAllHashes: vi.fn().mockReturnValue([]), upsertFile: vi.fn() },
    tags: { upsertTag: vi.fn(), getIdByName: vi.fn(), linkNodeToTag: vi.fn() },
    graph: {
      deleteNodesForPath: vi.fn().mockReturnValue([]),
      insertNode: vi.fn().mockReturnValue(1),
      insertLink: vi.fn(),
      findNodeIdByName: vi.fn().mockReturnValue(undefined),
    },
    fts: {},
    withWriteLock: async (fn) => fn(),
    withReadLock: async (fn) => fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("InitWorkflow.execute()", () => {
  let tmpDir: string;
  let callOrder: string[];
  let store: IGraphStore;
  let openStoreSpy: ReturnType<typeof vi.fn>;

  const filesToParse = [{ file: "src/a.ts", hash: "hash-a", code: "export const a = 1;" }];
  const parsedResults = [
    {
      file: "src/a.ts",
      hash: "hash-a",
      data: { imports: [], exports: [], functions: [], classes: [], calls: [] },
    },
  ];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-init-workflow-test-"));
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
    };
    const fileDiscovery: IFileDiscovery = {
      discoverFiles: vi.fn().mockImplementation(async () => {
        callOrder.push("discoverFiles");
        return { filesToParse, existingHashes: new Map(), skippedCount: 0, skippedOversized: [] };
      }),
    };
    const astProcessor: IAstProcessor = {
      processFiles: vi.fn().mockImplementation(async (): Promise<AstProcessResult> => {
        callOrder.push("processFiles");
        return { parsed: parsedResults, failures: [] };
      }),
    };
    const configScanner: IConfigScanner = {
      scanConfigs: vi.fn().mockResolvedValue({ projectType: "typescript", tags: ["typescript"] }),
    };
    const vcsScanner: IVcsScanner = { extractHotspotTags: vi.fn().mockResolvedValue([]) };
    const graphPersister: IGraphPersister = { persist: vi.fn().mockResolvedValue({ updatedCount: 1 }) };
    const tempFileManager: ITempFileManager = {
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      stopCleanup: vi.fn(),
      getTempDirPath: vi.fn().mockReturnValue(path.join(tmpDir, ".docuvia", "tmp")),
    };

    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.register(TOKENS.FileDiscovery, () => fileDiscovery);
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.register(TOKENS.VcsScanner, () => vcsScanner);
    docuviaFactory.register(TOKENS.AstProcessor, () => astProcessor);
    docuviaFactory.register(TOKENS.GraphPersister, () => graphPersister);
    docuviaFactory.register(TOKENS.TempFileManager, () => () => tempFileManager);
    openStoreSpy = vi.fn().mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStoreSpy);

    docuviaFactory.lock();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("opens the store at <workspaceRoot>/.docuvia/local.db and closes it when execute() completes", async () => {
    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(openStoreSpy).toHaveBeenCalledWith({ dbPath: resolveDbPath(tmpDir) });
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("closes the store even when a phase throws", async () => {
    docuviaFactory.reset();
    docuviaFactory.register(TOKENS.GitProvider, () => makeMockGitProvider());
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => ({
      ensureKnowledgeBranch: vi.fn().mockRejectedValue(new Error("boom")),
      installPostCommitHook: vi.fn(),
    }));
    docuviaFactory.register(TOKENS.FileDiscovery, () => ({ discoverFiles: vi.fn() }));
    docuviaFactory.register(TOKENS.ConfigScanner, () => ({ scanConfigs: vi.fn() }));
    docuviaFactory.register(TOKENS.VcsScanner, () => ({ extractHotspotTags: vi.fn() }));
    docuviaFactory.register(TOKENS.AstProcessor, () => ({ processFiles: vi.fn() }));
    docuviaFactory.register(TOKENS.GraphPersister, () => ({ persist: vi.fn() }));
    docuviaFactory.register(TOKENS.TempFileManager, () => () => ({}) as ITempFileManager);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => vi.fn().mockResolvedValue(store));
    docuviaFactory.lock();

    await expect(new InitWorkflow(tmpDir, createMockLogger()).execute()).rejects.toThrow("boom");
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("wires branch -> hook -> discovery -> AST parse in order", async () => {
    const result = await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect(result.success).toBe(true);
    expect(callOrder).toEqual([
      "ensureKnowledgeBranch",
      "installPostCommitHook",
      "discoverFiles",
      "processFiles",
    ]);
  });

  it("is idempotent: a second execute() run does not duplicate the projects row", async () => {
    await new InitWorkflow(tmpDir, createMockLogger()).execute();
    await new InitWorkflow(tmpDir, createMockLogger()).execute();

    expect((store.projects.insert as any).mock.calls.length).toBe(1);
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
    }));
    docuviaFactory.register(TOKENS.FileDiscovery, () => ({
      discoverFiles: vi
        .fn()
        .mockResolvedValue({ filesToParse, existingHashes: new Map(), skippedCount: 0, skippedOversized: [] }),
    }));
    docuviaFactory.register(TOKENS.ConfigScanner, () => ({
      scanConfigs: vi.fn().mockResolvedValue({ projectType: "generic", tags: [] }),
    }));
    docuviaFactory.register(TOKENS.VcsScanner, () => ({ extractHotspotTags: vi.fn().mockResolvedValue([]) }));
    docuviaFactory.register(TOKENS.AstProcessor, () => ({
      processFiles: vi.fn().mockResolvedValue({
        parsed: [],
        failures: [{ file: "src/broken.ts", hash: "h", error: "Worker exited with code 1" }],
      }),
    }));
    docuviaFactory.register(TOKENS.GraphPersister, () => ({ persist: vi.fn().mockResolvedValue({ updatedCount: 0 }) }));
    docuviaFactory.register(TOKENS.TempFileManager, () => () => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn(),
      stopCleanup: vi.fn(),
      getTempDirPath: vi.fn().mockReturnValue(""),
    }));
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => vi.fn().mockResolvedValue(makeMockStore()));
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
