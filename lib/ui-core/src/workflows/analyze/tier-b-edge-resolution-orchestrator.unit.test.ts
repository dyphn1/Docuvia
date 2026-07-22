import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type IEdgeResolutionProvider,
  type EdgeResolutionOutcome,
} from "@workspace/contracts";
import { resolveEdgesForLanguageBuckets } from "./tier-b-edge-resolution-orchestrator.js";
import type { TierBQueueEntry } from "./tier-b-queue.js";

function makeProvider(
  resolveEdges: (files: string[]) => Promise<EdgeResolutionOutcome>,
  name: string,
): IEdgeResolutionProvider {
  return {
    name,
    configure: vi.fn(),
    checkAvailability: vi.fn().mockResolvedValue({ available: true }),
    resolveEdges: (req) => resolveEdges(req.files),
  };
}

beforeEach(() => {
  resetFactoryForTests();
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

    const result = await resolveEdgesForLanguageBuckets(
      { typescript: tsFiles, python: pyFiles },
      { workspaceRoot: "/workspace", logger: createMockLogger() },
    );

    // Each provider is invoked with exactly its own bucket's files -- not the other language's
    // files, not the full queue.
    expect(tsResolveEdges).toHaveBeenCalledTimes(1);
    expect(tsResolveEdges.mock.calls[0][0]).toEqual(["a.ts", "b.ts"]);
    expect(pyResolveEdges).toHaveBeenCalledTimes(1);
    expect(pyResolveEdges.mock.calls[0][0]).toEqual(["c.py"]);

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
