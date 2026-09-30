import { describe, it, expect, vi } from "vitest";
import type {
  FileHashLookup,
  IConfigScanner,
  IFileDiscovery,
  IVcsScanner,
} from "@workspace/contracts";
import { runDiscoveryPipeline } from "./run-discovery-pipeline.js";

function makeMockFilesRepo(): FileHashLookup {
  return { getAllHashes: vi.fn().mockReturnValue([]) };
}

describe("runDiscoveryPipeline", () => {
  it("[happy] runs scanners in parallel and carries all discoverable candidates", async () => {
    const callOrder: string[] = [];
    const configScanner: IConfigScanner = {
      scanConfigs: vi.fn().mockImplementation(async () => {
        callOrder.push("scanConfigs");
        return { projectType: "typescript", tags: ["typescript", "backend"] };
      }),
    };
    const vcsScanner: IVcsScanner = {
      extractHotspotTags: vi.fn().mockImplementation(async () => {
        callOrder.push("extractHotspotTags");
        return ["domain:core"];
      }),
    };
    const filesToParse = [
      { file: "src/a.ts", hash: "hash-a", code: "export const a = 1;" },
    ];
    const fileDiscovery: IFileDiscovery = {
      discoverFiles: vi.fn().mockImplementation(async () => {
        callOrder.push("discoverFiles");
        return Object.assign(
          {
            filesToParse,
            existingHashes: new Map(),
            skippedCount: 0,
            skippedOversized: [],
          },
          { candidateFileCount: 3 },
        );
      }),
    };

    const result = await runDiscoveryPipeline({
      configScanner,
      vcsScanner,
      fileDiscovery,
      filesRepo: makeMockFilesRepo(),
      workspaceRoot: "/workspace",
    });

    // All three ran (order among themselves is not asserted — Promise.all — only that each ran).
    expect(callOrder.sort()).toEqual([
      "discoverFiles",
      "extractHotspotTags",
      "scanConfigs",
    ]);
    expect(result.filesToParse).toEqual(filesToParse);
    expect(result.candidateFileCount).toBe(3);
    expect(Array.from(result.tags).sort()).toEqual([
      "backend",
      "domain:core",
      "typescript",
    ]);
    expect(result.projectType).toBe("typescript");
  });

  it("threads skippedOversized through from discovery untouched", async () => {
    const configScanner: IConfigScanner = {
      scanConfigs: vi
        .fn()
        .mockResolvedValue({ projectType: "generic", tags: [] }),
    };
    const vcsScanner: IVcsScanner = {
      extractHotspotTags: vi.fn().mockResolvedValue([]),
    };
    const fileDiscovery: IFileDiscovery = {
      discoverFiles: vi.fn().mockResolvedValue({
        filesToParse: [],
        existingHashes: new Map(),
        skippedCount: 0,
        skippedOversized: [{ file: "src/huge.ts", sizeBytes: 600_000 }],
      }),
    };

    const result = await runDiscoveryPipeline({
      configScanner,
      vcsScanner,
      fileDiscovery,
      filesRepo: makeMockFilesRepo(),
      workspaceRoot: "/workspace",
    });

    expect(result.skippedOversized).toEqual([
      { file: "src/huge.ts", sizeBytes: 600_000 },
    ]);
  });
});
