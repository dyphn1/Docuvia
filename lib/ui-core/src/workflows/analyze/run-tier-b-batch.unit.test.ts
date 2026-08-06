import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type IGitProvider,
  type IGraphStore,
  type IKnowledgeGitService,
  type IEdgeResolutionProvider,
  type EdgeResolutionOutcome,
  type NodeLinkRow,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import { runTierBBatch } from "./run-tier-b-batch.js";
import { appendTierBQueueEntries } from "./tier-b-queue.js";

const HEAD_SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

function makeGit(overrides: Partial<IGitProvider> = {}): IGitProvider {
  return {
    getHeadSha: vi.fn().mockResolvedValue(HEAD_SHA),
    getCommitAncestry: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IGitProvider;
}

function makeKnowledgeGit(): IKnowledgeGitService {
  return {
    runUnderKnowledgeLock: vi.fn().mockImplementation((_cwd, fn) => fn()),
    hasSourceCommitInHistory: vi.fn().mockResolvedValue(false),
  } as unknown as IKnowledgeGitService;
}

interface FakeStore {
  meta: Map<string, string>;
  links: NodeLinkRow[];
  nodeKeyToId: Map<string, number>;
  projectFileHashes: Array<{ filePath: string; contentHash: string | null }>;
  tierBProcessed: Array<{
    projectId: number;
    filePath: string;
    commitSha: string | null;
  }>;
}

function makeStore(
  nodeKeys: string[] = [],
  projectFileHashes: Array<{
    filePath: string;
    contentHash: string | null;
  }> = [],
): {
  store: IGraphStore;
  fake: FakeStore;
} {
  const fake: FakeStore = {
    meta: new Map(),
    links: [],
    nodeKeyToId: new Map(nodeKeys.map((key, i) => [key, i + 1])),
    projectFileHashes,
    tierBProcessed: [],
  };
  let nextLinkId = 1;

  const store = {
    projects: {
      getFirst: () => ({ id: 1 }),
    },
    files: {
      getAllHashes: () => fake.projectFileHashes,
      markTierBProcessed: (input: {
        projectId: number;
        filePath: string;
        commitSha: string | null;
      }) => {
        fake.tierBProcessed.push(input);
      },
    },
    meta: {
      get: (key: string) => fake.meta.get(key),
      set: (key: string, value: string) => {
        fake.meta.set(key, value);
      },
    },
    graph: {
      getAllLinks: () => fake.links,
      findNodeIdByNodeKey: (key: string) => fake.nodeKeyToId.get(key),
      insertLink: (input: {
        sourceNodeId: number;
        targetNodeId: number;
        linkType: string;
      }) => {
        fake.links.push({
          id: nextLinkId++,
          source_node_id: input.sourceNodeId,
          target_node_id: input.targetNodeId,
          link_type: input.linkType as NodeLinkRow["link_type"],
          commit_sha: null,
          diff_summary: null,
          created_at: "",
        });
      },
      pruneOrphanedLinks: vi.fn().mockReturnValue(0),
    },
    withWriteLock: async (fn: () => unknown) => fn(),
    withTransaction: (fn: () => unknown) => fn(),
  } as unknown as IGraphStore;

  return { store, fake };
}

function makeProvider(
  checkAvailability: () => Promise<{ available: boolean; reason?: string }>,
  resolveEdges: (files: string[]) => Promise<EdgeResolutionOutcome>,
  name = "fake-provider",
): IEdgeResolutionProvider {
  return {
    name,
    configure: vi.fn(),
    checkAvailability,
    resolveEdges: (req) => resolveEdges(req.files),
  };
}

/** Registers `provider` as the sole `typescript` entry in the `EdgeResolutionProviders` registry
 *  (multi-language-lsp-support plan, Finding A) -- the shape every other test in this file that
 *  only cares about TS/JS's own behavior expects. */
function registerProvider(provider: IEdgeResolutionProvider): void {
  docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
    typescript: () => provider,
  }));
}

beforeEach(() => {
  resetFactoryForTests();
});

describe("runTierBBatch() (§8, D1-D6)", () => {
  it("no-ops on an empty queue without touching the provider", async () => {
    const providerFactory = vi.fn();
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: providerFactory,
    }));
    const { store } = makeStore();
    const git = makeGit();
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-test-"),
    );
    try {
      const result = await runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git,
        knowledgeGit: makeKnowledgeGit(),
      });

      expect(result.kind).toBe("tierBBatch");
      expect(result.filesQueued).toBe(0);
      expect(providerFactory).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("runTierBBatch() -- language dispatch and deleted-file drop (§8e, §8g)", () => {
  it("drops a deleted-at-HEAD entry and skips an unsupported-language entry, both logged, leaving nothing to process", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-test-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "present.swift"),
      "import Foundation\n",
    );

    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "deleted.ts", commitSha: HEAD_SHA },
      { file: "present.swift", commitSha: HEAD_SHA },
    ]);

    const providerFactory = vi.fn();
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: providerFactory,
    }));

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesQueued).toBe(2);
    expect(result.filesDroppedDeleted).toBe(1);
    expect(result.filesSkippedLanguage).toBe(1);
    expect(result.filesProcessed).toBe(0);
    expect(providerFactory).not.toHaveBeenCalled();

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
});

describe("runTierBBatch() -- edge application, pending finalize staging (§8d, §8f, §8g)", () => {
  async function makeWorkspace(): Promise<string> {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-tierb-test-"));
    fs.writeFileSync(path.join(dir, "a.ts"), "export function foo() {}\n");
    return dir;
  }

  it("applies resolved edges (existing node_keys only), prunes orphans, and stages a pending record with an empty remaining queue on full success", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["b.ts#bar", "a.ts#foo"]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [
            {
              sourceNodeKey: "b.ts#bar",
              targetNodeKey: "a.ts#foo",
              source: "lsp",
            },
          ],
          filesProcessed: ["a.ts"],
          filesFailed: [],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.edgesApplied).toBe(1);
    expect(result.filesProcessed).toBe(1);
    expect(result.filesFailed).toBe(0);
    expect(result.degraded).toBe(false);
    expect(fake.links).toHaveLength(1);
    expect(store.graph.pruneOrphanedLinks).toHaveBeenCalledTimes(1);

    const pendingRaw = fake.meta.get(
      GitConstants.META_KEY_TIER_B_BATCH_PENDING,
    );
    expect(pendingRaw).toBeTruthy();
    const pending = JSON.parse(pendingRaw!);
    expect(pending).toEqual({ headSha: HEAD_SHA, remainingQueue: [] });

    // The queue itself is untouched by analyze -- only SnapshotWorkflow's finalize drains it.
    const { readTierBQueue } = await import("./tier-b-queue.js");
    expect(readTierBQueue(store)).toHaveLength(1);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("drops an edge whose node_key does not resolve to an existing L2 node -- never invents one", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo"]); // "b.ts#bar" deliberately absent
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [
            {
              sourceNodeKey: "b.ts#bar",
              targetNodeKey: "a.ts#foo",
              source: "lsp",
            },
          ],
          filesProcessed: ["a.ts"],
          filesFailed: [],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.edgesApplied).toBe(0);
    expect(fake.links).toHaveLength(0);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("keeps a per-file LSP failure in the pending remaining queue for the next batch (§8g)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore([]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [{ file: "a.ts", reason: "server choked" }],
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesFailed).toBe(1);
    const pending = JSON.parse(
      store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([
      { file: "a.ts", commitSha: HEAD_SHA },
    ]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("degrades honestly when the provider is unavailable: no edges applied, whole toProcess set stays queued", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo"]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    registerProvider(
      makeProvider(
        async () => ({ available: false, reason: "binary not resolvable" }),
        async () => ({
          edges: [],
          filesProcessed: [],
          filesFailed: [],
          unavailableReason: "binary not resolvable",
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("binary not resolvable");
    expect(result.edgesApplied).toBe(0);
    expect(fake.links).toHaveLength(0);

    const pending = JSON.parse(
      fake.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    expect(pending.remainingQueue).toEqual([
      { file: "a.ts", commitSha: HEAD_SHA },
    ]);

    // Regression: `doctor`'s LOGS diagnostic scans `.docuvia/logs/*.log` for `entry.level >= 50`
    // to decide whether a past run had a real failure -- every event this workflow wrote was
    // missing `level` entirely, so a degraded batch could never trip that check (doctor kept
    // reporting the LOGS category healthy right after a run that produced zero edges; live-
    // reproduced against nestjs/nest in the 2026-07 CLI benchmark). Assert the actual JSONL file
    // on disk, not just the in-memory `result` -- that's what doctor reads.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const logLines = fs
      .readFileSync(
        path.join(workspaceRoot, ".docuvia", "logs", "analyze.log"),
        "utf8",
      )
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const degradedLine = logLines.find(
      (line) => line.event === "analyze.tierB.degraded",
    );
    expect(degradedLine?.level).toBeGreaterThanOrEqual(50);
    const summaryLine = logLines.find(
      (line) => line.event === "analyze.tierB.summary",
    );
    expect(summaryLine?.level).toBeGreaterThanOrEqual(50);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("preserves partial progress on a whole-batch timeout: applies edges/counts filesProcessed for files completed before the deadline, only restages the unreached file", async () => {
    // Models what lsp-edge-provider-base.ts's processAllFiles now actually returns on a timeout
    // that hit partway through: unavailableReason set (still degraded overall -- exit code/log
    // level), but filesProcessed/edges reflect real completed work, and only the unreached file
    // lands in filesFailed. Before the run-tier-b-batch.ts fix, any unavailableReason at all threw
    // away edges/filesProcessed and restaged the WHOLE original toProcess set, not just what
    // never got reached (2026-07 CLI benchmark finding, C# Tier B against a large Orleans
    // solution -- "do first, regardless of direction").
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["b.ts#bar", "a.ts#foo"]);
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "c.ts", commitSha: HEAD_SHA },
    ]);
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.writeFileSync(
      path.join(workspaceRoot, "c.ts"),
      "export function baz() {}\n",
    );

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [
            {
              sourceNodeKey: "b.ts#bar",
              targetNodeKey: "a.ts#foo",
              source: "lsp",
            },
          ],
          filesProcessed: ["a.ts"],
          filesFailed: [
            {
              file: "c.ts",
              reason:
                "Tier B LSP batch exceeded its 100ms timeout and was aborted",
            },
          ],
          unavailableReason:
            "Tier B LSP batch exceeded its 100ms timeout and was aborted",
        }),
      ),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toMatch(/exceeded its 100ms timeout/);
    expect(result.filesProcessed).toBe(1);
    expect(result.filesFailed).toBe(1);
    expect(result.edgesApplied).toBe(1);
    expect(fake.links).toHaveLength(1);

    const pending = JSON.parse(
      fake.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING)!,
    );
    // Only the unreached file gets restaged -- "a.ts" already succeeded and must not be
    // re-processed on the next run.
    expect(pending.remainingQueue).toEqual([
      { file: "c.ts", commitSha: HEAD_SHA },
    ]);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("idempotency (gating test 2): a crash mid-LSP never touches tierBQueue -- a re-run converges", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore([]);
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);
    const queueBefore = fake.meta.get(GitConstants.META_KEY_TIER_B_QUEUE);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => {
          throw new Error("LSP process crashed mid-batch");
        },
      ),
    );

    await expect(
      runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git: makeGit(),
        knowledgeGit: makeKnowledgeGit(),
      }),
    ).rejects.toThrow("LSP process crashed mid-batch");

    expect(fake.meta.get(GitConstants.META_KEY_TIER_B_QUEUE)).toBe(queueBefore);
    expect(
      fake.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING),
    ).toBeUndefined();

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
});

describe("runTierBBatch() -- full-resync flag and Tier B processed-at stamping (typescript-cli-benchmark.md §5.3/§5.7 items 1-2)", () => {
  async function makeWorkspace(): Promise<string> {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-full-test-"),
    );
    fs.writeFileSync(path.join(dir, "a.ts"), "export function foo() {}\n");
    fs.writeFileSync(path.join(dir, "b.ts"), "export function bar() {}\n");
    fs.writeFileSync(path.join(dir, "c.ts"), "export function baz() {}\n");
    return dir;
  }

  it("full: true dispatches every store.files.getAllHashes() file, not just the pre-queued ones", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore(
      [],
      [
        { filePath: "a.ts", contentHash: "hash-a" },
        { filePath: "b.ts", contentHash: "hash-b" },
        { filePath: "c.ts", contentHash: "hash-c" },
      ],
    );
    // Only "a.ts" is pre-queued -- "full: true" must still dispatch "b.ts"/"c.ts" too.
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    const resolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["a.ts", "b.ts", "c.ts"],
      filesFailed: [],
    });
    registerProvider(
      makeProvider(async () => ({ available: true }), resolveEdges),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
      full: true,
    });

    expect(result.filesQueued).toBe(3);
    expect(resolveEdges).toHaveBeenCalledTimes(1);
    expect(resolveEdges.mock.calls[0][0].sort()).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("full: false/undefined is byte-identical to today's behavior -- only pre-queued files are dispatched (regression guard)", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store } = makeStore(
      [],
      [
        { filePath: "a.ts", contentHash: "hash-a" },
        { filePath: "b.ts", contentHash: "hash-b" },
        { filePath: "c.ts", contentHash: "hash-c" },
      ],
    );
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: HEAD_SHA }]);

    const resolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["a.ts"],
      filesFailed: [],
    });
    registerProvider(
      makeProvider(async () => ({ available: true }), resolveEdges),
    );

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesQueued).toBe(1);
    expect(resolveEdges).toHaveBeenCalledTimes(1);
    expect(resolveEdges.mock.calls[0][0]).toEqual(["a.ts"]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("markTierBProcessed is called once per outcome.filesProcessed entry, with the batch's resolved headSha -- never for a failed/timed-out file", async () => {
    const workspaceRoot = await makeWorkspace();
    const { store, fake } = makeStore(["a.ts#foo", "b.ts#bar"], []);
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "b.ts", commitSha: HEAD_SHA },
    ]);

    registerProvider(
      makeProvider(
        async () => ({ available: true }),
        async () => ({
          edges: [],
          filesProcessed: ["a.ts"],
          filesFailed: [{ file: "b.ts", reason: "server choked" }],
        }),
      ),
    );

    await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(fake.tierBProcessed).toEqual([
      { projectId: 1, filePath: "a.ts", commitSha: HEAD_SHA },
    ]);

    const fs = await import("node:fs");
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("does not call markTierBProcessed for any file when nothing was actually processed (e.g. the empty-queue no-op path)", async () => {
    const { store, fake } = makeStore([], []);
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-test-"),
    );
    try {
      await runTierBBatch({
        workspaceRoot,
        logger: createMockLogger(),
        store,
        git: makeGit(),
        knowledgeGit: makeKnowledgeGit(),
      });

      expect(fake.tierBProcessed).toEqual([]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("runTierBBatch() -- multi-language registry dispatch (multi-language-lsp-support plan, Finding A)", () => {
  it("dispatches a queued file to the provider registered for its language, never touching a different language's registered provider, and honestly skips an extension with no dispatch entry", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-multilang-test-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "a.ts"),
      "export function foo() {}\n",
    );
    fs.writeFileSync(path.join(workspaceRoot, "b.py"), "def foo(): pass\n");

    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "b.py", commitSha: HEAD_SHA },
    ]);

    const tsResolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["a.ts"],
      filesFailed: [],
    });
    const tsProvider = makeProvider(
      async () => ({ available: true }),
      tsResolveEdges,
      "typescript-language-server",
    );

    const pyResolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["b.py"],
      filesFailed: [],
    });
    const pyProvider = makeProvider(
      async () => ({ available: true }),
      pyResolveEdges,
      "pyright",
    );

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => tsProvider,
      python: () => pyProvider,
    }));

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesQueued).toBe(2);
    // Slice 1 added a `.py` dispatch entry -- both files are now routed to their own registered
    // provider (never the other language's), proving dispatch is by the language-dispatch table
    // in combination with the registry, not a hardcoded single-language path.
    expect(result.filesSkippedLanguage).toBe(0);
    expect(result.filesProcessed).toBe(2);
    expect(result.degraded).toBe(false);
    expect(tsResolveEdges).toHaveBeenCalledTimes(1);
    expect(tsResolveEdges.mock.calls[0][0]).toEqual(["a.ts"]);
    expect(pyResolveEdges).toHaveBeenCalledTimes(1);
    expect(pyResolveEdges.mock.calls[0][0]).toEqual(["b.py"]);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("honestly skips an extension with no dispatch entry at all (e.g. Swift, still unshipped)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-tierb-multilang-test-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "a.ts"),
      "export function foo() {}\n",
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "b.swift"),
      "import Foundation\n",
    );

    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "b.swift", commitSha: HEAD_SHA },
    ]);

    const tsResolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: ["a.ts"],
      filesFailed: [],
    });
    const tsProvider = makeProvider(
      async () => ({ available: true }),
      tsResolveEdges,
      "typescript-language-server",
    );

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => tsProvider,
    }));

    const result = await runTierBBatch({
      workspaceRoot,
      logger: createMockLogger(),
      store,
      git: makeGit(),
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.filesQueued).toBe(2);
    expect(result.filesSkippedLanguage).toBe(1);
    expect(result.filesProcessed).toBe(1);
    expect(result.degraded).toBe(false);
    expect(tsResolveEdges).toHaveBeenCalledTimes(1);
    expect(tsResolveEdges.mock.calls[0][0]).toEqual(["a.ts"]);

    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
});
