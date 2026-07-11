import { describe, it, expect, vi } from "vitest";
import { runDiscoveryPipeline } from "./run-discovery-pipeline.js";
import { IConfigScanner, IFileDiscovery, IVcsScanner } from "../../interfaces/analyzer.interfaces.js";
import type { ProjectFilesRepo } from "../../memory/repos/files-repo.js";

function makeMockFilesRepo(): ProjectFilesRepo {
  return { getAllHashes: vi.fn().mockReturnValue([]), upsertFile: vi.fn() } as unknown as ProjectFilesRepo;
}

describe("runDiscoveryPipeline", () => {
  it("runs configScanner/vcsScanner/fileDiscovery in parallel and merges config + hotspot tags", async () => {
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
    const filesToParse = [{ file: "src/a.ts", hash: "hash-a", code: "export const a = 1;" }];
    const fileDiscovery: IFileDiscovery = {
      discoverFiles: vi.fn().mockImplementation(async () => {
        callOrder.push("discoverFiles");
        return { filesToParse, existingHashes: new Map(), skippedCount: 0, skippedOversized: [] };
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
    expect(callOrder.sort()).toEqual(["discoverFiles", "extractHotspotTags", "scanConfigs"]);
    expect(result.filesToParse).toEqual(filesToParse);
    expect(Array.from(result.tags).sort()).toEqual(["backend", "domain:core", "typescript"]);
    expect(result.projectType).toBe("typescript");
  });

  it("threads skippedOversized through from discovery untouched", async () => {
    const configScanner: IConfigScanner = {
      scanConfigs: vi.fn().mockResolvedValue({ projectType: "generic", tags: [] }),
    };
    const vcsScanner: IVcsScanner = { extractHotspotTags: vi.fn().mockResolvedValue([]) };
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

    expect(result.skippedOversized).toEqual([{ file: "src/huge.ts", sizeBytes: 600_000 }]);
  });
});
