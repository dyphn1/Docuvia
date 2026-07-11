import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { snapshotCommand } from "../../../src/commands/snapshot.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, DI_KEYS, container } from "@workspace/core";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";

// Ensure DI mapping exists
const mockWriter = { packDirectoryToBranch: vi.fn() };
container.register(DI_TOKENS.LocalOrphanBranchWriter, mockWriter);

vi.mock("@workspace/core", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    FileDiscoveryService: vi.fn().mockImplementation(() => ({
      discoverFiles: vi.fn().mockResolvedValue({ filesToParse: ["test.ts"] }),
    })),
    AstProcessingService: vi.fn().mockImplementation(() => ({
      processFiles: vi.fn().mockResolvedValue({ parsed: [], failures: [] }),
    })),
    mapAstToEvents: vi.fn().mockReturnValue([]),
    GitNativePersistenceService: vi.fn().mockImplementation(() => ({
      processEvents: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
  },
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    mkdtemp: vi.fn().mockResolvedValue("/tmp/docuvia-sync-123"),
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

describe("snapshotCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockWriter.packDirectoryToBranch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully create a snapshot", async () => {
    mockWriter.packDirectoryToBranch.mockResolvedValue(undefined);
    await snapshotCommand();
    expect(mockWriter.packDirectoryToBranch).toHaveBeenCalledWith(
      "/tmp/docuvia-sync-123",
      "docuvia-knowledge"
    );
    expect(fs.rm).toHaveBeenCalled();
  });

  it("logs a snapshot.start and snapshot.summary JSONL event to .docuvia/logs/snapshot.log", async () => {
    mockWriter.packDirectoryToBranch.mockResolvedValue(undefined);
    const workspaceRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "docuvia-snapshot-cmd-test-"));

    try {
      await snapshotCommand(workspaceRoot);

      const logPath = path.join(workspaceRoot, ".docuvia", "logs", "snapshot.log");
      const lines = fsSync
        .readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      expect(lines.some((l) => l.event === "snapshot.start")).toBe(true);
      const summary = lines.find((l) => l.event === "snapshot.summary");
      expect(summary).toBeDefined();
      expect(summary.filesFailed).toBe(0);
    } finally {
      fsSync.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
