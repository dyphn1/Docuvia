import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { FileHashLookup, IGitProvider } from "@workspace/contracts";
import { ConfigScannerService } from "./config-scanner.service.js";
import { FileDiscoveryService } from "./file-discovery.service.js";
import { VcsScannerService } from "./vcs-scanner.service.js";

// TDD-SOURCE: lib/contracts/src/interfaces/discovery.interfaces.ts
// TDD-SOURCE: lib/contracts/src/interfaces/git.interfaces.ts
// Phase 2: #371 / #378

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(false),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IGitProvider;
}

const emptyHashes: FileHashLookup = {
  getAllHashes: () => [],
};

describe("Phase 2 discovery contract hardening", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-phase2-discovery-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("VCS hotspot discovery returns no tags outside a git repository without reading history", async () => {
    const getRecentChangedFilePaths = vi
      .fn()
      .mockResolvedValue(["src/auth/a.ts"]);
    const git = makeMockGitProvider({
      isGitRepository: vi.fn().mockResolvedValue(false),
      getRecentChangedFilePaths,
    });

    await expect(
      new VcsScannerService(git).extractHotspotTags(tmpDir),
    ).resolves.toEqual([]);
    expect(getRecentChangedFilePaths).not.toHaveBeenCalled();
  });

  it("VCS hotspot discovery derives nested workspace domains instead of structural container names", async () => {
    const git = makeMockGitProvider({
      isGitRepository: vi.fn().mockResolvedValue(true),
      getRecentChangedFilePaths: vi
        .fn()
        .mockResolvedValue([
          "src/auth/login.ts",
          "src/auth/session.ts",
          "packages/cli/src/main.ts",
          "packages/cli/src/run.ts",
          "artifacts/server/src/index.ts",
          "crates/parser/src/lib.rs",
          "docs/guide.md",
          ".github/workflows/ci.yml",
          "README.md",
        ]),
    });

    await expect(
      new VcsScannerService(git).extractHotspotTags(tmpDir),
    ).resolves.toEqual([
      "domain:auth",
      "domain:cli",
      "domain:server",
      "domain:parser",
    ]);
  });

  it("VCS hotspot discovery keeps only the five highest-frequency eligible domains", async () => {
    const changed = [
      ...Array(6).fill("src/alpha/a.ts"),
      ...Array(5).fill("src/bravo/a.ts"),
      ...Array(4).fill("src/charlie/a.ts"),
      ...Array(3).fill("src/delta/a.ts"),
      ...Array(2).fill("src/echo/a.ts"),
      "src/foxtrot/a.ts",
      "src/x/a.ts",
      "build/generated.ts",
    ];
    const git = makeMockGitProvider({
      isGitRepository: vi.fn().mockResolvedValue(true),
      getRecentChangedFilePaths: vi.fn().mockResolvedValue(changed),
    });

    await expect(
      new VcsScannerService(git).extractHotspotTags(tmpDir),
    ).resolves.toEqual([
      "domain:alpha",
      "domain:bravo",
      "domain:charlie",
      "domain:delta",
      "domain:echo",
    ]);
  });

  it("VCS hotspot discovery degrades to an empty result when git history access fails", async () => {
    const git = makeMockGitProvider({
      isGitRepository: vi.fn().mockResolvedValue(true),
      getRecentChangedFilePaths: vi
        .fn()
        .mockRejectedValue(new Error("git unavailable")),
    });

    await expect(
      new VcsScannerService(git).extractHotspotTags(tmpDir),
    ).resolves.toEqual([]);
  });

  it("VCS hotspot discovery is deterministic across repeated identical history", async () => {
    const changed = [
      "src/auth/a.ts",
      "src/auth/b.ts",
      "src/api/a.ts",
      "packages/cli/src/main.ts",
    ];
    const git = makeMockGitProvider({
      isGitRepository: vi.fn().mockResolvedValue(true),
      getRecentChangedFilePaths: vi.fn().mockResolvedValue(changed),
    });
    const service = new VcsScannerService(git);

    const first = await service.extractHotspotTags(tmpDir);
    const second = await service.extractHotspotTags(tmpDir);

    expect(first).toEqual(["domain:auth", "domain:api", "domain:cli"]);
    expect(second).toEqual(first);
  });

  it("file discovery falls back to filesystem acquisition when git candidate enumeration fails", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "fallback.ts"),
      "export const fallback = 1;\n",
    );
    const git = makeMockGitProvider({
      isGitRepository: vi.fn().mockResolvedValue(true),
      listTrackedFilesWithBlobHash: vi
        .fn()
        .mockRejectedValue(new Error("broken index")),
    });

    const result = await new FileDiscoveryService(git).discoverFiles(
      tmpDir,
      emptyHashes,
    );

    expect(result.filesToParse).toHaveLength(1);
    expect(result.filesToParse[0]).toMatchObject({
      file: "fallback.ts",
      code: "export const fallback = 1;\n",
    });
    expect(result.filesToParse[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.skippedCount).toBe(0);
    expect(result.skippedOversized).toEqual([]);
  });

  it("file discovery only-indexed mode excludes dirty and untracked paths from the output", async () => {
    const git = makeMockGitProvider({
      isGitRepository: vi.fn().mockResolvedValue(true),
      listTrackedFilesWithBlobHash: vi
        .fn()
        .mockResolvedValue(new Map([["tracked.ts", "blob-sha"]])),
      listUntrackedFiles: vi.fn().mockResolvedValue(["untracked.ts"]),
      listModifiedFiles: vi.fn().mockResolvedValue(["tracked.ts"]),
      readBlobContent: vi.fn().mockResolvedValue("export const tracked = 1;\n"),
    });

    const result = await new FileDiscoveryService(git).discoverFiles(
      tmpDir,
      emptyHashes,
      { onlyIndexed: true },
    );

    expect(result.filesToParse).toEqual([
      {
        file: "tracked.ts",
        hash: "blob-sha",
        code: "export const tracked = 1;\n",
      },
    ]);
  });

  it("file discovery is deterministic across repeated identical filesystem input", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpDir, "b.py"), "b = 2\n");
    const service = new FileDiscoveryService(makeMockGitProvider());

    const first = await service.discoverFiles(tmpDir, emptyHashes);
    const second = await service.discoverFiles(tmpDir, emptyHashes);

    expect(second).toEqual(first);
  });

  it("config discovery returns a complete deterministic result across repeated identical scans", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { react: "18.0.0", express: "4.0.0" },
        devDependencies: { typescript: "5.0.0" },
      }),
    );
    const service = new ConfigScannerService();

    const first = await service.scanConfigs(tmpDir);
    const second = await service.scanConfigs(tmpDir);

    expect(first.projectType).toBe("javascript");
    expect(new Set(first.tags)).toEqual(
      new Set(["typescript", "react", "frontend", "express", "backend"]),
    );
    expect(second).toEqual(first);
  });

  it("config discovery safely falls back to generic/general for a missing workspace", async () => {
    const missing = path.join(tmpDir, "does-not-exist");

    await expect(
      new ConfigScannerService().scanConfigs(missing),
    ).resolves.toEqual({
      projectType: "generic",
      tags: ["general"],
    });
  });
});
