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
    // touching TS's outcome.
    expect(result.degradedLanguages).toEqual([
      { languageId: "python", reason: "pyright binary not resolvable" },
    ]);
    expect(result.unavailableReason).toBe("pyright binary not resolvable");
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
