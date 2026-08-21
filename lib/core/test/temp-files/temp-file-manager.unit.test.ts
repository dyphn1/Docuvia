import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TempFileManager } from "../../src/temp-files/temp-file-manager.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

vi.mock("node:fs/promises");

describe("TempFileManager", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    flush: vi.fn(),
  };
  let manager: TempFileManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default realpath mock: return the path as-is (no symlinks)
    vi.mocked(fs.realpath).mockImplementation(async (p) => String(p));
    manager = new TempFileManager("/workspace", logger, 1024, 1000, 500);
  });

  afterEach(() => {
    manager.stopCleanup();
  });

  it("initializes successfully", async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    await manager.initialize();
    expect(fs.mkdir).toHaveBeenCalledWith(
      path.join(path.resolve("/workspace"), ".docuvia", "tmp"),
      { recursive: true },
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("initialized"),
      expect.anything(),
    );
  });

  it("fails to initialize on mkdir error", async () => {
    vi.mocked(fs.mkdir).mockRejectedValue(new Error("mkdir fail"));
    await expect(manager.initialize()).rejects.toThrow("mkdir fail");
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to initialize TempFileManager",
      expect.anything(),
    );
  });

  it("tracks file and gets sizes", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);
    await manager.trackFile("/tmp/file1");

    expect(manager.getCacheSize()).toBe(1);
    expect(manager.getTotalSize()).toBe(100);
    expect(logger.debug).toHaveBeenCalledWith(
      "File tracked",
      expect.anything(),
    );
  });

  it("fails to track file silently", async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error("stat fail"));
    await manager.trackFile("/tmp/file2");

    expect(manager.getCacheSize()).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to track file",
      expect.anything(),
    );
  });

  it("accesses file and updates LRU", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);
    await manager.trackFile("/tmp/file3");

    vi.mocked(fs.readFile).mockResolvedValue("content");
    const content = await manager.accessFile("/tmp/file3");
    expect(content).toBe("content");
  });

  it("fails to access file", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("read fail"));
    const content = await manager.accessFile("/tmp/file4");
    expect(content).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to access file",
      expect.anything(),
    );
  });

  it("cleans up stale files", async () => {
    vi.useFakeTimers();
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
    await manager.trackFile("/tmp/stale");

    vi.advanceTimersByTime(2000); // Exceeds TTL

    await manager.cleanup();
    expect(fs.unlink).toHaveBeenCalledWith("/tmp/stale");
    expect(manager.getCacheSize()).toBe(0);
    vi.useRealTimers();
  });

  it("cleanup handles unlink error gracefully", async () => {
    vi.useFakeTimers();
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);
    const err = new Error("unlink fail");
    (err as any).code = "EACCES";
    vi.mocked(fs.unlink).mockRejectedValue(err);
    await manager.trackFile("/tmp/stale3");

    vi.advanceTimersByTime(2000);
    await manager.cleanup();
    expect(logger.error).toHaveBeenCalledWith(
      "Cleanup error",
      expect.anything(),
    );
    vi.useRealTimers();
  });

  it("getTempDirPath returns correct path", () => {
    expect(manager.getTempDirPath()).toBe(
      path.join(path.resolve("/workspace"), ".docuvia", "tmp"),
    );
  });

  it("stops cleanup if no interval", () => {
    const mgr = new TempFileManager("/workspace", logger);
    mgr.stopCleanup();
    expect(mgr.getCacheSize()).toBe(0);
  });
});
