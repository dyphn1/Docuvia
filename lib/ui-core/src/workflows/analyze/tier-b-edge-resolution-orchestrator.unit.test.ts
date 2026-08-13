import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type IEdgeResolutionProvider,
  type EdgeResolutionOutcome,
  type EdgeResolutionRequest,
  type IGraphStore,
  type IGitProvider,
} from "@workspace/contracts";
import { resolveEdgesForLanguageBuckets } from "./tier-b-edge-resolution-orchestrator.js";
import type { TierBQueueEntry } from "./tier-b-queue.js";

function makeProvider(
  resolveEdges: (req: EdgeResolutionRequest) => Promise<EdgeResolutionOutcome>,
  name: string,
): IEdgeResolutionProvider {
  return {
    name,
    configure: vi.fn(),
    checkAvailability: vi.fn().mockResolvedValue({ available: true }),
    resolveEdges,
  };
}

interface FakeCallSite {
  targetFunction: string;
  startLine: number;
  startColumn: number;
}

/**
 * Fake `IGraphStore` scoped to exactly what `buildCallsByFileForTypescript` reads (issue #11 plan
 * A, Slice 3) -- `getForFilesSpy` lets tests assert *which* files were even queried (D4: TS-only,
 * per-bucket, never the whole batch).
 */
function makeStore(opts?: {
  callSitesByFile?: Map<string, FakeCallSite[]>;
  projectFileHashes?: Array<{ filePath: string; contentHash: string | null }>;
}): { store: IGraphStore; getForFilesSpy: ReturnType<typeof vi.fn> } {
  const callSitesByFile = opts?.callSitesByFile ?? new Map();
  const getForFilesSpy = vi.fn(
    (_projectId: number, files: string[]): Map<string, FakeCallSite[]> => {
      const result = new Map<string, FakeCallSite[]>();
      for (const file of files) {
        const rows = callSitesByFile.get(file);
        if (rows) result.set(file, rows);
      }
      return result;
    },
  );

  const store = {
    projects: { getFirst: () => ({ id: 1 }) },
    callSites: { getForFiles: getForFilesSpy },
    files: { getAllHashes: () => opts?.projectFileHashes ?? [] },
  } as unknown as IGraphStore;

  return { store, getForFilesSpy };
}

/** Fake `IGitProvider` scoped to D5's staleness-guard reads. Defaults to "nothing tracked, nothing
 *  dirty" (every file falls through to the sha256-of-disk path) -- tests that want the git-blob-sha
 *  clean-file path pass `blobHashes` explicitly. */
function makeGit(opts?: {
  blobHashes?: Map<string, string>;
  untracked?: string[];
  modified?: string[];
}): IGitProvider {
  return {
    listTrackedFilesWithBlobHash: vi
      .fn()
      .mockResolvedValue(opts?.blobHashes ?? new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue(opts?.untracked ?? []),
    listModifiedFiles: vi.fn().mockResolvedValue(opts?.modified ?? []),
  } as unknown as IGitProvider;
}

let workspaceRoot: string;

beforeEach(() => {
  resetFactoryForTests();
  workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "docuvia-tierb-orchestrator-test-"),
  );
});

afterEach(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("resolveEdgesForLanguageBuckets() -- N>1 dispatch/merge (multi-language-lsp-support plan, Finding A/F)", () => {
  it("dispatches each language bucket to exactly its own registered provider with exactly its own files, and merges a mix of one degraded and one healthy provider into degradedLanguages", async () => {
    const tsFiles: TierBQueueEntry[] = [
      { file: "a.ts", commitSha: "sha1" },
      { file: "b.ts", commitSha: "sha1" },
    ];
    const pyFiles: TierBQueueEntry[] = [{ file: "c.py", commitSha: "sha1" }];

    const tsResolveEdges = vi.fn().mockResolvedValue({
      edges: [
        {
          sourceNodeKey: "a.ts#foo",
          targetNodeKey: "b.ts#bar",
          source: "lsp",
        },
      ],
      filesProcessed: ["a.ts", "b.ts"],
      filesFailed: [],
    });
    const tsProvider = makeProvider(
      tsResolveEdges,
      "typescript-language-server",
    );

    const pyResolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: [],
      filesFailed: [],
      unavailableReason: "pyright binary not resolvable",
    });
    const pyProvider = makeProvider(pyResolveEdges, "pyright");

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => tsProvider,
      python: () => pyProvider,
    }));

    const { store } = makeStore();
    const git = makeGit();

    const result = await resolveEdgesForLanguageBuckets(
      { typescript: tsFiles, python: pyFiles },
      { workspaceRoot, logger: createMockLogger(), store, git },
    );

    // Each provider is invoked with exactly its own bucket's files -- not the other language's
    // files, not the full queue.
    expect(tsResolveEdges).toHaveBeenCalledTimes(1);
    expect(tsResolveEdges.mock.calls[0][0].files).toEqual(["a.ts", "b.ts"]);
    expect(pyResolveEdges).toHaveBeenCalledTimes(1);
    expect(pyResolveEdges.mock.calls[0][0].files).toEqual(["c.py"]);

    // TS's edges/filesProcessed made it into the merged outcome.
    expect(result.edges).toEqual([
      { sourceNodeKey: "a.ts#foo", targetNodeKey: "b.ts#bar", source: "lsp" },
    ]);
    expect(result.filesProcessed).toEqual(["a.ts", "b.ts"]);
    expect(result.filesFailed).toEqual([]);

    // Python's unavailability merges into degradedLanguages, keyed by its own language id, without
    // touching TS's outcome. TS ran fine (issue #33), so this is a *stray* degradation: the
    // aggregate unavailableReason is deliberately absent (the run as a whole made progress) and
    // the shape is flagged explicitly -- a 100-file-healthy run must not read "degraded" over one
    // unrelated stray bucket.
    expect(result.degradedLanguages).toEqual([
      { languageId: "python", reason: "pyright binary not resolvable" },
    ]);
    expect(result.unavailableReason).toBeUndefined();
    expect(result.strayLanguageDegraded).toBe(true);
    expect(result.fullyDegraded).toBe(false);
  });

  it("keeps aggregate unavailableReason byte-identical when every language bucket degraded (fullyDegraded) -- single degraded language stays verbatim", async () => {
    const tsFiles: TierBQueueEntry[] = [
      { file: "a.ts", commitSha: "sha1" },
      { file: "b.ts", commitSha: "sha1" },
    ];

    const tsResolveEdges = vi.fn().mockResolvedValue({
      edges: [],
      filesProcessed: [],
      filesFailed: [],
      unavailableReason: "typescript-language-server not resolvable",
    });
    const tsProvider = makeProvider(
      tsResolveEdges,
      "typescript-language-server",
    );

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => tsProvider,
    }));

    const { store } = makeStore();
    const git = makeGit();

    const result = await resolveEdgesForLanguageBuckets(
      { typescript: tsFiles },
      { workspaceRoot, logger: createMockLogger(), store, git },
    );

    expect(result.degradedLanguages).toEqual([
      {
        languageId: "typescript",
        reason: "typescript-language-server not resolvable",
      },
    ]);
    // The sole degraded language keeps its own reason verbatim (Finding F) -- the aggregate shape
    // a single-language slice has always seen, byte-identical to before issue #33.
    expect(result.unavailableReason).toBe(
      "typescript-language-server not resolvable",
    );
    expect(result.strayLanguageDegraded).toBe(false);
    expect(result.fullyDegraded).toBe(true);
  });

  it("joins per-language reasons when every language bucket degraded (fullyDegraded, >1 language)", async () => {
    const tsFiles: TierBQueueEntry[] = [{ file: "a.ts", commitSha: "sha1" }];
    const pyFiles: TierBQueueEntry[] = [{ file: "c.py", commitSha: "sha1" }];

    const degradedProvider = (name: string, reason: string) =>
      makeProvider(
        vi.fn().mockResolvedValue({
          edges: [],
          filesProcessed: [],
          filesFailed: [],
          unavailableReason: reason,
        }),
        name,
      );

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () =>
        degradedProvider(
          "typescript-language-server",
          "typescript-language-server not resolvable",
        ),
      python: () =>
        degradedProvider("pyright", "pyright binary not resolvable"),
    }));

    const { store } = makeStore();
    const git = makeGit();

    const result = await resolveEdgesForLanguageBuckets(
      { typescript: tsFiles, python: pyFiles },
      { workspaceRoot, logger: createMockLogger(), store, git },
    );

    expect(result.degradedLanguages).toEqual([
      {
        languageId: "typescript",
        reason: "typescript-language-server not resolvable",
      },
      { languageId: "python", reason: "pyright binary not resolvable" },
    ]);
    expect(result.unavailableReason).toBe(
      "typescript: typescript-language-server not resolvable; python: pyright binary not resolvable",
    );
    expect(result.strayLanguageDegraded).toBe(false);
    expect(result.fullyDegraded).toBe(true);
  });

  it("reports neither flag on a fully healthy batch (no degraded buckets)", async () => {
    const tsFiles: TierBQueueEntry[] = [{ file: "a.ts", commitSha: "sha1" }];

    const tsResolveEdges = vi.fn().mockResolvedValue({
      edges: [
        { sourceNodeKey: "a.ts#x", targetNodeKey: "b.ts#y", source: "lsp" },
      ],
      filesProcessed: ["a.ts"],
      filesFailed: [],
    });
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () =>
        makeProvider(tsResolveEdges, "typescript-language-server"),
    }));

    const { store } = makeStore();
    const git = makeGit();

    const result = await resolveEdgesForLanguageBuckets(
      { typescript: tsFiles },
      { workspaceRoot, logger: createMockLogger(), store, git },
    );

    expect(result.degradedLanguages).toEqual([]);
    expect(result.unavailableReason).toBeUndefined();
    expect(result.strayLanguageDegraded).toBe(false);
    expect(result.fullyDegraded).toBe(false);
  });

  it("merges a provider outcome whose edges array exceeds the call-stack spread limit without RangeError (uncapped --lsp-timeout=0 batch regression)", async () => {
    // V8 throws `RangeError: Maximum call stack size exceeded` when a >~125k-element array is
    // spread into a `push(...)` call -- an uncapped `--lsp-timeout=0` full-repo batch can resolve
    // that many edges in one bucket, so the orchestrator must merge with a bounded loop, not a
    // spread. This test feeds one such giant array through the real merge path and asserts the
    // outcome comes back intact.
    const files: TierBQueueEntry[] = [
      { file: "a.ts", commitSha: "sha1" },
      { file: "b.ts", commitSha: "sha1" },
    ];
    const hugeEdges: EdgeResolutionOutcome["edges"] = Array.from(
      { length: 200_000 },
      (_, i) => ({
        sourceNodeKey: `a.ts#caller${i}`,
        targetNodeKey: "b.ts#callee",
        source: "lsp" as const,
      }),
    );
    const tsResolveEdges = vi.fn().mockResolvedValue({
      edges: hugeEdges,
      filesProcessed: ["a.ts", "b.ts"],
      filesFailed: [],
    });
    const tsProvider = makeProvider(
      tsResolveEdges,
      "typescript-language-server",
    );

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => tsProvider,
    }));

    const { store } = makeStore();
    const git = makeGit();

    const result = await resolveEdgesForLanguageBuckets(
      { typescript: files },
      { workspaceRoot, logger: createMockLogger(), store, git },
    );

    expect(result.edges).toHaveLength(200_000);
    expect(result.edges[0]).toEqual(hugeEdges[0]);
    expect(result.edges[199_999]).toEqual(hugeEdges[199_999]);
    expect(result.filesProcessed).toEqual(["a.ts", "b.ts"]);
  });
});

/**
 * Phase 2.2 (issue #11 plan A, Slice 3): `buildCallsByFileForTypescript`'s own producer-wiring
 * contract -- TS-only population, D5's staleness guard, and the D6 observability log line. All
 * three of the plan's own listed success-criterion cases.
 */
describe("resolveEdgesForLanguageBuckets() -- TypeScript-only callsByFile population (issue #11 plan A, Slice 3, Phase 2.2)", () => {
  it("populates callsByFile for the TypeScript bucket only -- the Python bucket gets callsByFile: undefined and store.callSites.getForFiles is never even queried with its files", async () => {
    const tsFiles: TierBQueueEntry[] = [
      { file: "a.ts", commitSha: "sha1" },
      { file: "b.ts", commitSha: "sha1" },
    ];
    const pyFiles: TierBQueueEntry[] = [{ file: "c.py", commitSha: "sha1" }];

    const { store, getForFilesSpy } = makeStore({
      callSitesByFile: new Map([
        ["a.ts", [{ targetFunction: "bar", startLine: 1, startColumn: 2 }]],
        ["b.ts", [{ targetFunction: "baz", startLine: 3, startColumn: 4 }]],
      ]),
      projectFileHashes: [
        { filePath: "a.ts", contentHash: "hashA" },
        { filePath: "b.ts", contentHash: "hashB" },
      ],
    });
    const git = makeGit({
      blobHashes: new Map([
        ["a.ts", "hashA"],
        ["b.ts", "hashB"],
      ]),
    });

    const tsResolveEdges = vi
      .fn()
      .mockResolvedValue({ edges: [], filesProcessed: [], filesFailed: [] });
    const pyResolveEdges = vi
      .fn()
      .mockResolvedValue({ edges: [], filesProcessed: [], filesFailed: [] });

    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () =>
        makeProvider(tsResolveEdges, "typescript-language-server"),
      python: () => makeProvider(pyResolveEdges, "pyright"),
    }));

    await resolveEdgesForLanguageBuckets(
      { typescript: tsFiles, python: pyFiles },
      { workspaceRoot, logger: createMockLogger(), store, git },
    );

    expect(tsResolveEdges.mock.calls[0][0].callsByFile).toEqual({
      "a.ts": [{ targetFunction: "bar", startLine: 1, startColumn: 2 }],
      "b.ts": [{ targetFunction: "baz", startLine: 3, startColumn: 4 }],
    });
    expect(pyResolveEdges.mock.calls[0][0].callsByFile).toBeUndefined();

    // store.callSites.getForFiles is called exactly once, for the TS bucket's own files only --
    // never for python's files, and never a second time for some other bucket.
    expect(getForFilesSpy).toHaveBeenCalledTimes(1);
    expect(getForFilesSpy.mock.calls[0][1]).toEqual(["a.ts", "b.ts"]);
  });

  it("D5 staleness guard: a TS file whose live content hash disagrees with the persisted project_files.content_hash is omitted from callsByFile (falls through to reverse for that file only)", async () => {
    const tsFiles: TierBQueueEntry[] = [
      { file: "a.ts", commitSha: "sha1" },
      { file: "b.ts", commitSha: "sha1" },
    ];

    const { store } = makeStore({
      callSitesByFile: new Map([
        ["a.ts", [{ targetFunction: "bar", startLine: 1, startColumn: 2 }]],
        ["b.ts", [{ targetFunction: "baz", startLine: 3, startColumn: 4 }]],
      ]),
      projectFileHashes: [
        { filePath: "a.ts", contentHash: "hashA-stored" },
        { filePath: "b.ts", contentHash: "hashB" },
      ],
    });
    // a.ts's live (git-index) blob hash disagrees with what Tier A persisted -- e.g. the working
    // tree changed since the last ingest. b.ts's matches, so it must still be seeded.
    const git = makeGit({
      blobHashes: new Map([
        ["a.ts", "hashA-live-and-different"],
        ["b.ts", "hashB"],
      ]),
    });

    const tsResolveEdges = vi
      .fn()
      .mockResolvedValue({ edges: [], filesProcessed: [], filesFailed: [] });
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () =>
        makeProvider(tsResolveEdges, "typescript-language-server"),
    }));

    await resolveEdgesForLanguageBuckets(
      { typescript: tsFiles },
      { workspaceRoot, logger: createMockLogger(), store, git },
    );

    const callsByFile = tsResolveEdges.mock.calls[0][0].callsByFile;
    expect(callsByFile).toEqual({
      "b.ts": [{ targetFunction: "baz", startLine: 3, startColumn: 4 }],
    });
    expect(callsByFile).not.toHaveProperty("a.ts");
  });

  it("D6: zero persisted call sites for the whole TS bucket (e.g. Tier A hasn't re-ingested since Phase 0's migration) yields callsByFile: undefined and logs a 0/N seeded line, not a silent success", async () => {
    const tsFiles: TierBQueueEntry[] = [{ file: "a.ts", commitSha: "sha1" }];

    const { store } = makeStore(); // no callSitesByFile entries at all
    const git = makeGit();
    const logger = createMockLogger();

    const tsResolveEdges = vi
      .fn()
      .mockResolvedValue({ edges: [], filesProcessed: [], filesFailed: [] });
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () =>
        makeProvider(tsResolveEdges, "typescript-language-server"),
    }));

    await resolveEdgesForLanguageBuckets(
      { typescript: tsFiles },
      { workspaceRoot, logger, store, git },
    );

    expect(tsResolveEdges.mock.calls[0][0].callsByFile).toBeUndefined();
    expect(
      logger.events.some(
        (e) => e.message.includes("0/1") && e.message.includes("typescript"),
      ),
    ).toBe(true);
  });
});
