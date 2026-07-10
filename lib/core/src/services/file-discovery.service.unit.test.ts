import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileDiscoveryService } from "./file-discovery.service.js";
import { IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";

function makeMockWorkspaceGit(overrides: Partial<IWorkspaceGitService> = {}): IWorkspaceGitService {
  return {
    isGitRepository: vi.fn().mockResolvedValue(false),
    ensureKnowledgeBranch: vi.fn().mockResolvedValue({ created: false }),
    installPostCommitHook: vi.fn().mockResolvedValue({ installed: false }),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
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

  it("git-backed path only discovers registry-supported extensions (injects a mocked IWorkspaceGitService)", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpDir, "b.exe"), "binary-not-source");

    const mockGit = makeMockWorkspaceGit({
      isGitRepository: vi.fn().mockResolvedValue(true),
      listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(
        new Map([
          ["a.ts", "sha-a"],
          ["b.exe", "sha-b"],
        ])
      ),
    });

    const service = new FileDiscoveryService(mockGit);
    const dbPath = path.join(tmpDir, ".docuvia", "local.db"); // does not exist -> no existing hashes
    const { filesToParse } = await service.discoverFiles(tmpDir, dbPath);

    const discoveredFiles = filesToParse.map((f) => f.file);
    expect(discoveredFiles).toContain("a.ts");
    expect(discoveredFiles).not.toContain("b.exe");
  });

  it("falls back to fast-glob + registry extensions when not a git repository", async () => {
    fs.writeFileSync(path.join(tmpDir, "x.py"), "a = 1\n");
    fs.writeFileSync(path.join(tmpDir, "y.exe"), "binary-not-source");
    fs.mkdirSync(path.join(tmpDir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "node_modules", "skip.ts"), "export const skip = 1;\n");

    const mockGit = makeMockWorkspaceGit({ isGitRepository: vi.fn().mockResolvedValue(false) });

    const service = new FileDiscoveryService(mockGit);
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    const { filesToParse } = await service.discoverFiles(tmpDir, dbPath);

    const discoveredFiles = filesToParse.map((f) => f.file);
    expect(discoveredFiles.some((f) => f.endsWith("x.py"))).toBe(true);
    expect(discoveredFiles.some((f) => f.endsWith("y.exe"))).toBe(false);
    expect(discoveredFiles.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("discovers extensionless Ruby convention files (e.g. Gemfile) in the non-git fallback", async () => {
    fs.writeFileSync(path.join(tmpDir, "Gemfile"), "source 'https://rubygems.org'\n");
    fs.writeFileSync(path.join(tmpDir, "Rakefile"), "task :default\n");
    fs.writeFileSync(path.join(tmpDir, "README"), "not a source file\n");

    const mockGit = makeMockWorkspaceGit({ isGitRepository: vi.fn().mockResolvedValue(false) });

    const service = new FileDiscoveryService(mockGit);
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    const { filesToParse } = await service.discoverFiles(tmpDir, dbPath);

    const discoveredFiles = filesToParse.map((f) => f.file);
    expect(discoveredFiles).toContain("Gemfile");
    expect(discoveredFiles).toContain("Rakefile");
    expect(discoveredFiles).not.toContain("README");
  });

  it("skips files over the oversized-file threshold and reports them in skippedOversized instead of silently dropping or fully parsing them", async () => {
    const oversizedContent = "x".repeat(512_001);
    fs.writeFileSync(path.join(tmpDir, "huge.ts"), oversizedContent);
    fs.writeFileSync(path.join(tmpDir, "small.ts"), "export const a = 1;\n");

    const mockGit = makeMockWorkspaceGit({ isGitRepository: vi.fn().mockResolvedValue(false) });

    const service = new FileDiscoveryService(mockGit);
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    const { filesToParse, skippedOversized } = await service.discoverFiles(tmpDir, dbPath);

    const discoveredFiles = filesToParse.map((f) => f.file);
    expect(discoveredFiles.some((f) => f.endsWith("huge.ts"))).toBe(false);
    expect(discoveredFiles.some((f) => f.endsWith("small.ts"))).toBe(true);

    expect(skippedOversized).toHaveLength(1);
    expect(skippedOversized[0].file).toBe("huge.ts");
    expect(skippedOversized[0].sizeBytes).toBeGreaterThan(512_000);
  });
});
