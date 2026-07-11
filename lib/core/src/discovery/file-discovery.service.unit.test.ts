import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { FileHashLookup, IGitProvider } from "@workspace/contracts";
import { FileDiscoveryService } from "./file-discovery.service.js";

function makeMockGitProvider(overrides: Partial<IGitProvider> = {}): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(false),
    branchExists: vi.fn().mockResolvedValue(false),
    commitEmptyTree: vi.fn().mockResolvedValue("sha"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(false),
    readHookFile: vi.fn().mockResolvedValue(undefined),
    appendHookFile: vi.fn().mockResolvedValue(undefined),
    makeHookExecutable: vi.fn().mockResolvedValue(undefined),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    packDirectoryToBranch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Mocks the narrow `FileHashLookup` dependency `FileDiscoveryService` takes instead of a raw
 *  `dbPath`. Defaults to "no existing hashes" — equivalent to a fresh workspace. */
function makeMockFilesRepo(
  hashes: Array<{ filePath: string; contentHash: string | null }> = []
): FileHashLookup {
  return { getAllHashes: vi.fn().mockReturnValue(hashes) };
}

describe("FileDiscoveryService", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-file-discovery-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("git-backed path only discovers registry-supported extensions (injects a mocked IGitProvider)", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpDir, "b.exe"), "binary-not-source");

    const mockGit = makeMockGitProvider({
      isGitRepository: vi.fn().mockResolvedValue(true),
      listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(
        new Map([
          ["a.ts", "sha-a"],
          ["b.exe", "sha-b"],
        ])
      ),
    });

    const service = new FileDiscoveryService(mockGit);
    const { filesToParse } = await service.discoverFiles(tmpDir, makeMockFilesRepo());

    const discoveredFiles = filesToParse.map((f) => f.file);
    expect(discoveredFiles).toContain("a.ts");
    expect(discoveredFiles).not.toContain("b.exe");
  });

  it("falls back to fast-glob + registry extensions when not a git repository", async () => {
    fs.writeFileSync(path.join(tmpDir, "x.py"), "a = 1\n");
    fs.writeFileSync(path.join(tmpDir, "y.exe"), "binary-not-source");
    fs.mkdirSync(path.join(tmpDir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "node_modules", "skip.ts"), "export const skip = 1;\n");

    const mockGit = makeMockGitProvider({ isGitRepository: vi.fn().mockResolvedValue(false) });

    const service = new FileDiscoveryService(mockGit);
    const { filesToParse } = await service.discoverFiles(tmpDir, makeMockFilesRepo());

    const discoveredFiles = filesToParse.map((f) => f.file);
    expect(discoveredFiles.some((f) => f.endsWith("x.py"))).toBe(true);
    expect(discoveredFiles.some((f) => f.endsWith("y.exe"))).toBe(false);
    expect(discoveredFiles.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("discovers extensionless Ruby convention files (e.g. Gemfile) in the non-git fallback", async () => {
    fs.writeFileSync(path.join(tmpDir, "Gemfile"), "source 'https://rubygems.org'\n");
    fs.writeFileSync(path.join(tmpDir, "Rakefile"), "task :default\n");
    fs.writeFileSync(path.join(tmpDir, "README"), "not a source file\n");

    const mockGit = makeMockGitProvider({ isGitRepository: vi.fn().mockResolvedValue(false) });

    const service = new FileDiscoveryService(mockGit);
    const { filesToParse } = await service.discoverFiles(tmpDir, makeMockFilesRepo());

    const discoveredFiles = filesToParse.map((f) => f.file);
    expect(discoveredFiles).toContain("Gemfile");
    expect(discoveredFiles).toContain("Rakefile");
    expect(discoveredFiles).not.toContain("README");
  });

  it("skips files over the oversized-file threshold and reports them in skippedOversized instead of silently dropping or fully parsing them", async () => {
    const oversizedContent = "x".repeat(512_001);
    fs.writeFileSync(path.join(tmpDir, "huge.ts"), oversizedContent);
    fs.writeFileSync(path.join(tmpDir, "small.ts"), "export const a = 1;\n");

    const mockGit = makeMockGitProvider({ isGitRepository: vi.fn().mockResolvedValue(false) });

    const service = new FileDiscoveryService(mockGit);
    const { filesToParse, skippedOversized } = await service.discoverFiles(
      tmpDir,
      makeMockFilesRepo()
    );

    const discoveredFiles = filesToParse.map((f) => f.file);
    expect(discoveredFiles.some((f) => f.endsWith("huge.ts"))).toBe(false);
    expect(discoveredFiles.some((f) => f.endsWith("small.ts"))).toBe(true);

    expect(skippedOversized).toHaveLength(1);
    expect(skippedOversized[0].file).toBe("huge.ts");
    expect(skippedOversized[0].sizeBytes).toBeGreaterThan(512_000);
  });

  it("does not re-parse a file whose hash matches the repo's existing hash", async () => {
    fs.writeFileSync(path.join(tmpDir, "unchanged.ts"), "export const a = 1;\n");

    const mockGit = makeMockGitProvider({
      isGitRepository: vi.fn().mockResolvedValue(true),
      listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map([["unchanged.ts", "sha-1"]])),
    });

    const service = new FileDiscoveryService(mockGit);
    const filesRepo = makeMockFilesRepo([{ filePath: "unchanged.ts", contentHash: "sha-1" }]);
    const { filesToParse, skippedCount } = await service.discoverFiles(tmpDir, filesRepo);

    expect(filesToParse.map((f) => f.file)).not.toContain("unchanged.ts");
    expect(skippedCount).toBe(1);
    expect(filesRepo.getAllHashes).toHaveBeenCalled();
  });
});
