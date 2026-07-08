import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { snapshotCommand } from "../../../src/commands/snapshot.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, DI_KEYS, container } from "@workspace/core";
import fs from "fs/promises";

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
      processFiles: vi.fn().mockResolvedValue([]),
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
});
