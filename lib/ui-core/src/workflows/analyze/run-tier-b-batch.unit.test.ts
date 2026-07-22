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
  } as unknown as IKnowledgeGitService;
}

interface FakeStore {
  meta: Map<string, string>;
  links: NodeLinkRow[];
  nodeKeyToId: Map<string, number>;
}

function makeStore(nodeKeys: string[] = []): {
  store: IGraphStore;
  fake: FakeStore;
} {
  const fake: FakeStore = {
    meta: new Map(),
    links: [],
    nodeKeyToId: new Map(nodeKeys.map((key, i) => [key, i + 1])),
  };
  let nextLinkId = 1;

  const store = {
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

    const result = await runTierBBatch({
      workspaceRoot: "/workspace",
      logger: createMockLogger(),
      store,
      git,
      knowledgeGit: makeKnowledgeGit(),
    });

    expect(result.kind).toBe("tierBBatch");
    expect(result.filesQueued).toBe(0);
    expect(providerFactory).not.toHaveBeenCalled();
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
    fs.writeFileSync(path.join(workspaceRoot, "present.rs"), "fn main() {}\n");

    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "deleted.ts", commitSha: HEAD_SHA },
      { file: "present.rs", commitSha: HEAD_SHA },
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

    const fs = await import("node:fs");
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

  it("honestly skips an extension with no dispatch entry at all (e.g. Rust, still unshipped)", async () => {
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
    fs.writeFileSync(path.join(workspaceRoot, "b.rs"), "fn main() {}\n");

    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: HEAD_SHA },
      { file: "b.rs", commitSha: HEAD_SHA },
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
