import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { resolveTierBCoverageHint } from "./tier-b-coverage.js";

interface MockStore {
  files: {
    getAllHashes: ReturnType<typeof vi.fn>;
    upsertFile: ReturnType<typeof vi.fn>;
    markTierBProcessed: ReturnType<typeof vi.fn>;
    getTierBFileStatus: ReturnType<typeof vi.fn>;
    getTierBCoverage: ReturnType<typeof vi.fn>;
  };
}

function makeMockStore(overrides: {
  fileStatus?:
    | { lastProcessedAt: string | null; lastProcessedCommitSha: string | null }
    | undefined;
  coverage?: { totalFiles: number; processedFiles: number };
}): MockStore {
  return {
    files: {
      getAllHashes: vi.fn(),
      upsertFile: vi.fn(),
      markTierBProcessed: vi.fn(),
      getTierBFileStatus: vi.fn().mockReturnValue(overrides.fileStatus),
      getTierBCoverage: vi
        .fn()
        .mockReturnValue(
          overrides.coverage ?? { totalFiles: 1, processedFiles: 1 },
        ),
    },
  };
}

describe("resolveTierBCoverageHint()", () => {
  it("returns undefined when neither direction is empty (short-circuits before touching the store)", () => {
    const store = makeMockStore({});

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      "src/a.ts",
      false,
      false,
    );

    expect(result).toBe(undefined);
    expect(store.files.getTierBFileStatus.mock.calls).toHaveLength(0);
    expect(store.files.getTierBCoverage.mock.calls).toHaveLength(0);
  });

  it("outgoing empty + own file never processed -> hint attached (needsOutgoingHint quadrant)", () => {
    const store = makeMockStore({
      fileStatus: { lastProcessedAt: null, lastProcessedCommitSha: null },
      coverage: { totalFiles: 5, processedFiles: 5 },
    });

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      "src/a.ts",
      false,
      true,
    );

    expect(result).toEqual({
      ownFileLastProcessedAt: null,
      workspaceFilesProcessed: 5,
      workspaceFilesTotal: 5,
    });
  });

  it("outgoing empty + own file already processed + coverage complete -> no hint (confirmed zero)", () => {
    const store = makeMockStore({
      fileStatus: {
        lastProcessedAt: "2026-01-01",
        lastProcessedCommitSha: "abc",
      },
      coverage: { totalFiles: 5, processedFiles: 5 },
    });

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      "src/a.ts",
      false,
      true,
    );

    expect(result).toBe(undefined);
  });

  it("incoming empty + workspace coverage incomplete -> hint attached (needsIncomingHint quadrant)", () => {
    const store = makeMockStore({
      fileStatus: {
        lastProcessedAt: "2026-01-01",
        lastProcessedCommitSha: "abc",
      },
      coverage: { totalFiles: 10, processedFiles: 3 },
    });

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      "src/a.ts",
      true,
      false,
    );

    expect(result).toEqual({
      ownFileLastProcessedAt: "2026-01-01",
      workspaceFilesProcessed: 3,
      workspaceFilesTotal: 10,
    });
  });

  it("incoming empty + workspace coverage complete -> no hint (confirmed zero)", () => {
    const store = makeMockStore({
      fileStatus: {
        lastProcessedAt: "2026-01-01",
        lastProcessedCommitSha: "abc",
      },
      coverage: { totalFiles: 10, processedFiles: 10 },
    });

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      "src/a.ts",
      true,
      false,
    );

    expect(result).toBe(undefined);
  });

  it("both empty: only the applicable quadrant(s) drive the hint -- own file unprocessed AND coverage incomplete", () => {
    const store = makeMockStore({
      fileStatus: undefined,
      coverage: { totalFiles: 4, processedFiles: 1 },
    });

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      "src/a.ts",
      true,
      true,
    );

    expect(result).toEqual({
      ownFileLastProcessedAt: null,
      workspaceFilesProcessed: 1,
      workspaceFilesTotal: 4,
    });
  });

  it("both empty, both quadrants confirmed (own file processed, coverage complete) -> no hint", () => {
    const store = makeMockStore({
      fileStatus: {
        lastProcessedAt: "2026-01-01",
        lastProcessedCommitSha: "abc",
      },
      coverage: { totalFiles: 4, processedFiles: 4 },
    });

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      "src/a.ts",
      true,
      true,
    );

    expect(result).toBe(undefined);
  });

  it("treats a missing project_files row for the own file (undefined status) the same as never-processed", () => {
    const store = makeMockStore({
      fileStatus: undefined,
      coverage: { totalFiles: 2, processedFiles: 2 },
    });

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      "src/never-parsed.ts",
      false,
      true,
    );

    expect(result).toEqual({
      ownFileLastProcessedAt: null,
      workspaceFilesProcessed: 2,
      workspaceFilesTotal: 2,
    });
  });

  it("treats an undefined ownFilePath (unresolved node) as never-processed for the outgoing-hint check", () => {
    const store = makeMockStore({
      coverage: { totalFiles: 2, processedFiles: 2 },
    });

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      undefined,
      false,
      true,
    );

    expect(result?.ownFileLastProcessedAt).toBe(null);
    expect(store.files.getTierBFileStatus.mock.calls).toHaveLength(0);
  });

  it("workspaceFilesTotal === 0 edge case: processedFiles(0) < totalFiles(0) is false, so no incoming hint", () => {
    const store = makeMockStore({
      fileStatus: {
        lastProcessedAt: "2026-01-01",
        lastProcessedCommitSha: "abc",
      },
      coverage: { totalFiles: 0, processedFiles: 0 },
    });

    const result = resolveTierBCoverageHint(
      store as unknown as IGraphStore,
      "src/a.ts",
      true,
      false,
    );

    expect(result).toBe(undefined);
  });
});
