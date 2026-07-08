import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { snapshotCommand } from "../../../src/commands/snapshot.js";
import { ui } from "../../../src/ui/wizard.js";
import {
  LocalOrphanBranchWriter,
  FileDiscoveryService,
  AstProcessingService,
  mapAstToEvents,
  GitNativePersistenceService,
} from "@workspace/core";
import process from "process";
import fs from "fs/promises";

vi.mock("fs/promises", () => ({
  default: {
    mkdtemp: vi.fn().mockResolvedValue("/tmp/test-dir"),
    rm: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
      text: "",
    })),
  },
}));

vi.mock("@workspace/core", () => {
  return {
    FileDiscoveryService: vi.fn().mockImplementation(() => ({
      discoverFiles: vi.fn().mockResolvedValue({ filesToParse: [] }),
    })),
    AstProcessingService: vi.fn().mockImplementation(() => ({
      processFiles: vi.fn().mockResolvedValue([]),
    })),
    mapAstToEvents: vi.fn().mockReturnValue([]),
    GitNativePersistenceService: vi.fn().mockImplementation(() => ({
      processEvents: vi.fn().mockResolvedValue(undefined),
    })),
    LocalOrphanBranchWriter: vi.fn().mockImplementation(() => ({
      packDirectoryToBranch: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("snapshotCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code) => {
      throw new Error(`Exit ${code}`);
    }) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully create a snapshot", async () => {
    await snapshotCommand();

    expect(FileDiscoveryService).toHaveBeenCalled();
    expect(LocalOrphanBranchWriter).toHaveBeenCalled();
  });

  it("should handle snapshot failure", async () => {
    vi.mocked(FileDiscoveryService).mockImplementationOnce(
      () =>
        ({
          discoverFiles: vi.fn().mockRejectedValue(new Error("Snapshot failed")),
        }) as any
    );

    await expect(snapshotCommand()).rejects.toThrow("Exit 1");
  });
});
