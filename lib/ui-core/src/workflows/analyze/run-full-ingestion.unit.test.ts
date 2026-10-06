import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX,
  SnapshotCallSiteAvailabilityStates,
  type AstProcessResult,
  type IAstProcessor,
  type IConfigScanner,
  type IFileDiscovery,
  type IGraphPersister,
  type IGraphStore,
  type IHydrationService,
  type IVcsScanner,
  type ProjectRow,
} from "@workspace/contracts";
import { GitConstants, TierCCandidateKinds } from "@workspace/contracts";
import {
  makeMockStore,
  makeMockGitProvider,
  makeMockKnowledgeGit,
} from "@workspace/contracts/testing";
import { runFullIngestion } from "./run-full-ingestion.js";
import { readTierBQueue } from "./tier-b-queue.js";
import { readTierCQueue } from "./tier-c-queue.js";

// Mirrors init-workflow.unit.test.ts's mocking pattern (Factory Lock, pure orchestration unit
// test) -- runFullIngestion reuses init's own seedProjectRow/runDiscoveryPipeline/
// runParseAndPersist phase helpers verbatim, so this test focuses on the wiring around them
// (headSha meta write, markSynced, JSONL events, result shape) rather than re-testing those
// helpers' own already-covered behavior.

function makeFullIngestionStore(): IGraphStore {
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
  return makeMockStore({
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
    meta: {
      get: vi.fn((key: string) => meta.get(key)),
      set: vi.fn((key: string, value: string) => {
        meta.set(key, value);
      }),
    },
  });
}

interface SemanticGraphState {
  files: Map<string, string>;
  nodeKeys: Set<string>;
  links: Set<string>;
  callSites: Set<string>;
}

function makeSemanticGraphStore(): {
  store: IGraphStore;
  state: SemanticGraphState;
  events: string[];
  metadata: Map<string, string>;
} {
  const store = makeFullIngestionStore();
  const state: SemanticGraphState = {
    files: new Map(),
    nodeKeys: new Set(),
    links: new Set(),
    callSites: new Set(),
  };
  const events: string[] = [];
  const metadata = new Map<string, string>();

  store.files.getAllHashes = vi.fn(() =>
    Array.from(state.files, ([filePath, contentHash]) => ({
      filePath,
      contentHash,
    })),
  );
  store.files.deleteFile = vi.fn((_projectId, filePath) => {
    events.push(`deleteFile:${filePath}`);
    state.files.delete(filePath);
  });
  store.files.upsertFile = vi.fn(({ filePath, contentHash }) => {
    state.files.set(filePath, contentHash ?? "");
  });
  store.graph.deleteNodesForPath = vi.fn((filePath) => {
    events.push(`deleteNodes:${filePath}`);
    const prefix = `${filePath}#`;
    for (const nodeKey of state.nodeKeys) {
      if (nodeKey.startsWith(prefix)) state.nodeKeys.delete(nodeKey);
    }
    for (const link of state.links) {
      if (link.includes(prefix)) state.links.delete(link);
    }
    return [];
  });
  store.callSites.deleteForFile = vi.fn((_projectId, filePath) => {
    events.push(`deleteCallSites:${filePath}`);
    const prefix = `${filePath}:`;
    for (const callSite of state.callSites) {
      if (callSite.startsWith(prefix)) state.callSites.delete(callSite);
    }
  });
  store.meta.get = vi.fn((key) => metadata.get(key));
  store.meta.set = vi.fn((key, value) => {
    if (key === GitConstants.META_KEY_CALL_RESOLUTION_STATS) {
      events.push("callResolution");
    }
    if (key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA) {
      events.push("sourceSha");
    }
    metadata.set(key, value);
  });

  return { store, state, events, metadata };
}

function semanticGraphSnapshot(state: SemanticGraphState) {
  return {
    files: Array.from(state.files.keys()).sort(),
    nodeKeys: Array.from(state.nodeKeys).sort(),
    links: Array.from(state.links).sort(),
    callSites: Array.from(state.callSites).sort(),
  };
}

describe("runFullIngestion()", () => {
  let tmpDir: string;
  let store: IGraphStore;
  let fileDiscovery: IFileDiscovery;
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
    store = makeFullIngestionStore();

    resetFactoryForTests();

    fileDiscovery = {
      discoverFiles: vi.fn().mockImplementation(async () => {
        callOrder.push("discoverFiles");
        return Object.assign(
          {
            filesToParse,
            existingHashes: new Map(),
            skippedCount: 0,
            skippedOversized: [],
          },
          { candidateFileCount: filesToParse.length },
        );
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
      importL3Cards: vi.fn().mockResolvedValue({ cardsFound: 0, imported: 0 }),
    };
    const knowledgeGit = makeMockKnowledgeGit({
      packSnapshotToKnowledgeBranch: vi.fn().mockImplementation(async () => {
        callOrder.push("packSnapshotToKnowledgeBranch");
      }),
    });

    docuviaFactory.register(TOKENS.FileDiscovery, () => fileDiscovery);
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.register(TOKENS.VcsScanner, () => vcsScanner);
    docuviaFactory.register(TOKENS.AstProcessor, () => astProcessor);
    docuviaFactory.register(TOKENS.GraphPersister, () => graphPersister);
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.register(TOKENS.KnowledgeGitService, () => knowledgeGit);
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn().mockResolvedValue({
        nodesWritten: 0,
        edgesWritten: 0,
        markdownFilesWritten: 0,
      }),
    }));
    docuviaFactory.lock();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("[happy][state-diff] invalidates prior proof state before full discovery and persistence", async () => {
    const git = makeMockGitProvider();
    const invalidation = vi.fn(() => {
      callOrder.push("invalidateAll");
      return { invalidatedCount: 2, affectedFilePaths: ["src/caller.ts"] };
    });
    Object.defineProperty(store, "callSiteResolutions", {
      configurable: true,
      value: { invalidateAll: invalidation },
    });

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    expect(callOrder).toEqual([
      "invalidateAll",
      "discoverFiles",
      "processFiles",
      "packSnapshotToKnowledgeBranch",
      "markSynced",
    ]);
    expect(invalidation).toHaveBeenCalledWith(1);
    expect(store.projects.getOrInsert).toHaveBeenCalled();
  });

  it("[invalid-input][error-handling] stops before discovery when full invalidation rejects", async () => {
    Object.defineProperty(store, "callSiteResolutions", {
      configurable: true,
      value: {
        invalidateAll: vi.fn(() => {
          throw new Error("invalid project metadata");
        }),
      },
    });

    await expect(
      runFullIngestion({
        workspaceRoot: tmpDir,
        logger: createMockLogger(),
        store,
        git: makeMockGitProvider(),
      }),
    ).rejects.toThrowError("invalid project metadata");
    expect(fileDiscovery.discoverFiles).toHaveBeenCalledTimes(0);
  });

  it("[state-diff] restores unavailable call-site evidence after a complete full ingestion", async () => {
    const markerKey = `${SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX}1`;
    store.meta.set(markerKey, SnapshotCallSiteAvailabilityStates.UNAVAILABLE);
    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git: makeMockGitProvider(),
    });

    expect(store.meta.get(markerKey)).toBe(
      SnapshotCallSiteAvailabilityStates.AVAILABLE,
    );
  });

  it("[state-diff] restores call-site evidence when every candidate was attempted, even with an oversized file", async () => {
    const markerKey = `${SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX}1`;
    store.meta.set(markerKey, SnapshotCallSiteAvailabilityStates.UNAVAILABLE);
    vi.mocked(fileDiscovery.discoverFiles).mockResolvedValue(
      Object.assign(
        {
          filesToParse,
          existingHashes: new Map(),
          skippedCount: 0,
          skippedOversized: [{ file: "src/huge.ts", sizeBytes: 600_000 }],
        },
        { candidateFileCount: filesToParse.length + 1 },
      ),
    );

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git: makeMockGitProvider(),
    });

    // Same call-site table a fresh init would build: the oversized file is a coverage gap.
    expect(store.meta.get(markerKey)).toBe(
      SnapshotCallSiteAvailabilityStates.AVAILABLE,
    );
  });

  it("[state-diff] keeps call-site evidence unavailable when full discovery skips an unchanged file", async () => {
    const markerKey = `${SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX}1`;
    store.meta.set(markerKey, SnapshotCallSiteAvailabilityStates.UNAVAILABLE);
    vi.mocked(fileDiscovery.discoverFiles).mockResolvedValue(
      Object.assign(
        {
          filesToParse,
          existingHashes: new Map(),
          skippedCount: 1,
          skippedOversized: [],
        },
        { candidateFileCount: filesToParse.length + 1 },
      ),
    );

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git: makeMockGitProvider(),
    });

    expect(store.meta.get(markerKey)).toBe(
      SnapshotCallSiteAvailabilityStates.UNAVAILABLE,
    );
  });

  it("still returns a successful result when packing the knowledge-graph snapshot fails (non-fatal)", async () => {
    const git = makeMockGitProvider();
    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger: createMockLogger(),
    });
    (knowledgeGit.packSnapshotToKnowledgeBranch as any).mockRejectedValueOnce(
      new Error("git fast-import failed"),
    );

    const result = await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    expect(result).toMatchObject({ kind: "autoFullIngestion", filesParsed: 1 });
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

  it("queues every successfully-parsed file into the Tier B queue on first ingestion", async () => {
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

    expect(readTierBQueue(store)).toEqual([
      {
        file: "src/a.ts",
        commitSha: "cafebabecafebabecafebabecafebabecafebabe",
      },
    ]);
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

    expect(store.meta.set).not.toHaveBeenCalledWith(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      expect.anything(),
    );
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

  it("logs a full-ingestion parse failure to analyze.log as analyze.full.parse_failure, not init.log", async () => {
    const git = makeMockGitProvider();
    docuviaFactory.reset();
    resetFactoryForTests();
    const fileDiscovery: IFileDiscovery = {
      discoverFiles: vi.fn().mockResolvedValue({
        filesToParse,
        existingHashes: new Map(),
        skippedCount: 0,
        skippedOversized: [],
      }),
    };
    const astProcessor: IAstProcessor = {
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
      persist: vi.fn().mockResolvedValue({ updatedCount: 0 }),
    };
    docuviaFactory.register(TOKENS.FileDiscovery, () => fileDiscovery);
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.register(TOKENS.VcsScanner, () => vcsScanner);
    docuviaFactory.register(TOKENS.AstProcessor, () => astProcessor);
    docuviaFactory.register(TOKENS.GraphPersister, () => graphPersister);
    docuviaFactory.register(TOKENS.HydrationService, () => hydrationService);
    docuviaFactory.register(TOKENS.KnowledgeGitService, () =>
      makeMockKnowledgeGit(),
    );
    docuviaFactory.register(TOKENS.SnapshotRenderer, () => ({
      render: vi.fn().mockResolvedValue({
        nodesWritten: 0,
        edgesWritten: 0,
        markdownFilesWritten: 0,
      }),
    }));
    docuviaFactory.lock();

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git,
    });

    const analyzeLogPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const analyzeLines = fs
      .readFileSync(analyzeLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const failureLine = analyzeLines.find(
      (l) => l.event === "analyze.full.parse_failure",
    );
    expect(failureLine).toBeDefined();
    expect(failureLine.file).toBe("src/broken.ts");

    const initLogPath = path.join(tmpDir, ".docuvia", "logs", "init.log");
    expect(fs.existsSync(initLogPath)).toBe(false);
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

  it("[state-diff] rebuilds a rewound graph to the fresh current-tree state and is idempotent", async () => {
    const currentFiles = [
      {
        file: "src/target.ts",
        hash: "hash-target",
        code: "export function evalP3Target() {}",
      },
      {
        file: "src/user-a.ts",
        hash: "hash-user-a",
        code: "evalP3Target();",
      },
    ];
    const parsedProjection = {
      "src/target.ts": {
        nodeKeys: ["src/target.ts#evalP3Target"],
        links: [],
        callSites: [],
      },
      "src/user-a.ts": {
        nodeKeys: ["src/user-a.ts#evalP3UserA"],
        links: ["src/user-a.ts#evalP3UserA->src/target.ts#evalP3Target"],
        callSites: ["src/user-a.ts:1:0:evalP3Target"],
      },
    };
    const oldCallStats = {
      total: 1,
      resolved: 0,
      selfDiscarded: 0,
      unresolved: 1,
    };
    const currentCallStats = {
      total: 1,
      resolved: 1,
      selfDiscarded: 0,
      unresolved: 0,
    };
    const rewound = makeSemanticGraphStore();
    const fresh = makeSemanticGraphStore();
    const contexts = new WeakMap<
      IGraphStore,
      ReturnType<typeof makeSemanticGraphStore>
    >();
    contexts.set(rewound.store, rewound);
    contexts.set(fresh.store, fresh);

    rewound.state.files.set("src/target.ts", "hash-target");
    rewound.state.files.set("src/user-a.ts", "hash-user-a");
    rewound.state.files.set("src/user-b.ts", "hash-user-b");
    rewound.state.files.set("src/target-moved.ts", "hash-moved");
    rewound.state.nodeKeys.add("src/target.ts#evalP3Target");
    rewound.state.nodeKeys.add("src/user-a.ts#evalP3UserA");
    rewound.state.nodeKeys.add("src/user-b.ts#evalP3UserB");
    rewound.state.nodeKeys.add("src/target-moved.ts#evalP3Target");
    rewound.state.links.add(
      "src/user-a.ts#evalP3UserA->src/target-moved.ts#evalP3Target",
    );
    rewound.state.links.add(
      "src/user-b.ts#evalP3UserB->src/target.ts#evalP3Target",
    );
    rewound.state.callSites.add("src/user-a.ts:1:0:evalP3Target");
    rewound.state.callSites.add("src/user-b.ts:1:0:evalP3Target");
    rewound.metadata.set(
      GitConstants.META_KEY_CALL_RESOLUTION_STATS,
      JSON.stringify({ byFile: { "src/user-b.ts": oldCallStats } }),
    );

    const fileDiscovery = docuviaFactory.resolve(TOKENS.FileDiscovery, {
      logger: createMockLogger(),
    });
    vi.mocked(fileDiscovery.discoverFiles).mockImplementation(
      async (_root, filesRepo) => {
        const existingHashes = new Map(
          filesRepo
            .getAllHashes()
            .flatMap(({ filePath, contentHash }) =>
              contentHash === null ? [] : [[filePath, contentHash] as const],
            ),
        );
        const filesToParse = currentFiles.filter(
          ({ file, hash }) => existingHashes.get(file) !== hash,
        );
        return {
          filesToParse,
          existingHashes,
          skippedCount: currentFiles.length - filesToParse.length,
          skippedOversized: [],
        };
      },
    );

    let activeContext = rewound;
    const astProcessor = docuviaFactory.resolve(TOKENS.AstProcessor, {
      logger: createMockLogger(),
    });
    vi.mocked(astProcessor.processFiles).mockImplementation(
      async (_root, files) => {
        activeContext.events.push("processFiles");
        return {
          parsed: files.map(({ file, hash }) => ({
            file,
            hash,
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
        };
      },
    );

    const graphPersister = docuviaFactory.resolve(TOKENS.GraphPersister);
    vi.mocked(graphPersister.persist).mockImplementation(
      async ({ store: persistedStore, parsedResults }) => {
        const context = contexts.get(persistedStore)!;
        context.events.push("persist");
        for (const result of parsedResults) {
          persistedStore.graph.deleteNodesForPath(result.file);
          persistedStore.callSites.deleteForFile(1, result.file);
          persistedStore.files.upsertFile({
            projectId: 1,
            filePath: result.file,
            contentHash: result.hash,
          });
          const projection =
            parsedProjection[result.file as keyof typeof parsedProjection];
          for (const nodeKey of projection.nodeKeys) {
            context.state.nodeKeys.add(nodeKey);
          }
          for (const link of projection.links) context.state.links.add(link);
          for (const callSite of projection.callSites) {
            context.state.callSites.add(callSite);
          }
        }
        const callResolutionByFile = parsedResults.some(
          (result) => result.file === "src/user-a.ts",
        )
          ? { "src/user-a.ts": currentCallStats }
          : undefined;
        return {
          updatedCount: parsedResults.length,
          callResolutionByFile,
        };
      },
    );

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store: rewound.store,
      git: makeMockGitProvider(),
    });
    const firstRebuild = semanticGraphSnapshot(rewound.state);

    activeContext = fresh;
    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store: fresh.store,
      git: makeMockGitProvider(),
    });
    expect(firstRebuild).toEqual(semanticGraphSnapshot(fresh.state));

    activeContext = rewound;
    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store: rewound.store,
      git: makeMockGitProvider(),
    });
    expect(semanticGraphSnapshot(rewound.state)).toEqual(firstRebuild);
    expect(firstRebuild).toEqual({
      files: ["src/target.ts", "src/user-a.ts"],
      nodeKeys: ["src/target.ts#evalP3Target", "src/user-a.ts#evalP3UserA"],
      links: ["src/user-a.ts#evalP3UserA->src/target.ts#evalP3Target"],
      callSites: ["src/user-a.ts:1:0:evalP3Target"],
    });
    for (const vanishedPath of ["src/user-b.ts", "src/target-moved.ts"]) {
      expect(firstRebuild.files).not.toContain(vanishedPath);
      expect(
        firstRebuild.nodeKeys.some((key) => key.startsWith(`${vanishedPath}#`)),
      ).toBe(false);
      expect(
        firstRebuild.links.some((link) => link.includes(`${vanishedPath}#`)),
      ).toBe(false);
      expect(
        firstRebuild.callSites.some((callSite) =>
          callSite.startsWith(`${vanishedPath}:`),
        ),
      ).toBe(false);
    }
    expect(firstRebuild.links).toContain(
      "src/user-a.ts#evalP3UserA->src/target.ts#evalP3Target",
    );
    expect(
      vi
        .mocked(fileDiscovery.discoverFiles)
        .mock.calls.every(
          ([, filesRepo]) => filesRepo.getAllHashes().length === 0,
        ),
    ).toBe(true);
    expect(rewound.events.indexOf("deleteFile:src/user-b.ts")).toBeLessThan(
      rewound.events.indexOf("processFiles"),
    );
    expect(rewound.events.indexOf("persist")).toBeLessThan(
      rewound.events.indexOf("sourceSha"),
    );
    expect(
      JSON.parse(
        rewound.metadata.get(GitConstants.META_KEY_CALL_RESOLUTION_STATS)!,
      ),
    ).toEqual({ byFile: { "src/user-a.ts": currentCallStats } });
  });

  it("[state-diff] clears stale call-resolution state and refreshes evidence on an empty full pass", async () => {
    const { store, state, events, metadata } = makeSemanticGraphStore();
    const vanishedPath = "src/vanished.ts";
    state.files.set(vanishedPath, "old-hash");
    state.nodeKeys.add(`${vanishedPath}#oldSymbol`);
    state.callSites.add(`${vanishedPath}:1:0:oldCall`);
    metadata.set(
      GitConstants.META_KEY_CALL_RESOLUTION_STATS,
      JSON.stringify({
        byFile: {
          [vanishedPath]: {
            total: 1,
            resolved: 0,
            selfDiscarded: 0,
            unresolved: 1,
          },
        },
      }),
    );

    const fileDiscovery = docuviaFactory.resolve(TOKENS.FileDiscovery, {
      logger: createMockLogger(),
    });
    vi.mocked(fileDiscovery.discoverFiles).mockResolvedValue({
      filesToParse: [],
      existingHashes: new Map(),
      skippedCount: 0,
      skippedOversized: [],
    });
    const astProcessor = docuviaFactory.resolve(TOKENS.AstProcessor, {
      logger: createMockLogger(),
    });
    vi.mocked(astProcessor.processFiles).mockResolvedValue({
      parsed: [],
      failures: [],
    });
    const graphPersister = docuviaFactory.resolve(TOKENS.GraphPersister);
    vi.mocked(graphPersister.persist).mockImplementation(async () => {
      events.push("persist");
      return { updatedCount: 0 };
    });

    await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git: makeMockGitProvider(),
    });

    expect(semanticGraphSnapshot(state)).toEqual({
      files: [],
      nodeKeys: [],
      links: [],
      callSites: [],
    });
    expect(
      JSON.parse(metadata.get(GitConstants.META_KEY_CALL_RESOLUTION_STATS)!),
    ).toEqual({ byFile: {} });
    expect(graphPersister.persist).toHaveBeenCalledWith(
      expect.objectContaining({ parsedResults: [] }),
    );
    expect(events.indexOf("deleteFile:src/vanished.ts")).toBeLessThan(
      events.indexOf("persist"),
    );
    expect(events.indexOf("persist")).toBeLessThan(events.indexOf("sourceSha"));
  });

  it("[state-diff] retires current paths that fail parsing and preserves successful files", async () => {
    const failedFile = "src/broken.ts";
    const successfulFile = "src/healthy.ts";
    const headSha = "full-head-sha";
    const oldCallStats = {
      total: 1,
      resolved: 0,
      selfDiscarded: 0,
      unresolved: 1,
    };
    const currentCallStats = {
      total: 1,
      resolved: 1,
      selfDiscarded: 0,
      unresolved: 0,
    };
    const { store, state, events, metadata } = makeSemanticGraphStore();
    state.files.set(failedFile, "old-broken-hash");
    state.files.set(successfulFile, "old-healthy-hash");
    state.nodeKeys.add(`${failedFile}#oldBroken`);
    state.nodeKeys.add(`${successfulFile}#oldHealthy`);
    state.links.add(`${failedFile}#oldBroken->${successfulFile}#oldHealthy`);
    state.callSites.add(`${failedFile}:1:0:oldBrokenCall`);
    state.callSites.add(`${successfulFile}:1:0:oldHealthyCall`);
    metadata.set(
      GitConstants.META_KEY_CALL_RESOLUTION_STATS,
      JSON.stringify({ byFile: { [failedFile]: oldCallStats } }),
    );
    const callSitesAvailabilityKey = `${SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX}1`;
    metadata.set(
      callSitesAvailabilityKey,
      SnapshotCallSiteAvailabilityStates.AVAILABLE,
    );
    metadata.set(
      GitConstants.META_KEY_TIER_B_QUEUE,
      JSON.stringify([{ file: failedFile, commitSha: "old-sha" }]),
    );
    metadata.set(
      GitConstants.META_KEY_TIER_B_BATCH_PENDING,
      JSON.stringify({
        headSha: "old-sha",
        remainingQueue: [{ file: failedFile, commitSha: "old-sha" }],
      }),
    );
    metadata.set(
      GitConstants.META_KEY_TIER_C_QUEUE,
      JSON.stringify([
        {
          kind: TierCCandidateKinds.CONTRACT_SYMBOL,
          target: `${failedFile}#oldBroken`,
          commitSha: "old-sha",
          file: failedFile,
        },
      ]),
    );

    const currentFiles = [
      { file: failedFile, hash: "new-broken-hash", code: "invalid source" },
      {
        file: successfulFile,
        hash: "new-healthy-hash",
        code: "export const healthy = true;",
      },
    ];
    const fileDiscovery = docuviaFactory.resolve(TOKENS.FileDiscovery, {
      logger: createMockLogger(),
    });
    vi.mocked(fileDiscovery.discoverFiles).mockResolvedValue({
      filesToParse: currentFiles,
      existingHashes: new Map(),
      skippedCount: 0,
      skippedOversized: [],
      candidateFileCount: currentFiles.length,
    });

    const astProcessor = docuviaFactory.resolve(TOKENS.AstProcessor, {
      logger: createMockLogger(),
    });
    vi.mocked(astProcessor.processFiles).mockResolvedValue({
      parsed: [
        {
          file: successfulFile,
          hash: "new-healthy-hash",
          data: {
            imports: [],
            exports: [],
            functions: [],
            classes: [],
            calls: [],
          },
          language: "typescript",
        },
      ],
      failures: [
        {
          file: failedFile,
          hash: "new-broken-hash",
          error: "parse failed",
        },
      ],
    });

    const graphPersister = docuviaFactory.resolve(TOKENS.GraphPersister);
    vi.mocked(graphPersister.persist).mockImplementation(
      async ({ parsedResults }) => {
        for (const result of parsedResults) {
          store.graph.deleteNodesForPath(result.file);
          store.callSites.deleteForFile(1, result.file);
          store.files.upsertFile({
            projectId: 1,
            filePath: result.file,
            contentHash: result.hash,
          });
          state.nodeKeys.add(`${successfulFile}#currentHealthy`);
          state.callSites.add(`${successfulFile}:1:0:healthyCall`);
        }
        return {
          updatedCount: parsedResults.length,
          callResolutionByFile: { [successfulFile]: currentCallStats },
        };
      },
    );

    const result = await runFullIngestion({
      workspaceRoot: tmpDir,
      logger: createMockLogger(),
      store,
      git: makeMockGitProvider({
        getHeadSha: vi.fn().mockResolvedValue(headSha),
      }),
    });

    expect(result.kind).toBe("autoFullIngestion");
    if (result.kind === "autoFullIngestion") {
      expect(result.filesFailed).toBe(1);
    }
    expect(semanticGraphSnapshot(state)).toEqual({
      files: [successfulFile],
      nodeKeys: [`${successfulFile}#currentHealthy`],
      links: [],
      callSites: [`${successfulFile}:1:0:healthyCall`],
    });
    expect(
      JSON.parse(metadata.get(GitConstants.META_KEY_CALL_RESOLUTION_STATS)!),
    ).toEqual({ byFile: { [successfulFile]: currentCallStats } });
    // Every candidate was attempted, so the call-site table equals a fresh init's: the failed
    // file's gap is a per-file coverage gap, not snapshot-lost evidence (#516).
    expect(metadata.get(callSitesAvailabilityKey)).toBe(
      SnapshotCallSiteAvailabilityStates.AVAILABLE,
    );
    expect(readTierBQueue(store)).toEqual([
      { file: successfulFile, commitSha: headSha },
    ]);
    expect(
      JSON.parse(metadata.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!),
    ).toEqual({ headSha: "old-sha", remainingQueue: [] });
    expect(readTierCQueue(store)).toEqual([]);
    expect(events.indexOf(`deleteFile:${failedFile}`)).toBeLessThan(
      events.indexOf("sourceSha"),
    );
  });
});
