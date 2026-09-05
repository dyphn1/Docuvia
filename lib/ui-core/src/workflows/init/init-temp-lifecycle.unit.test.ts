import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { ITempFileManager } from "@workspace/contracts";
import { createMockLogger } from "@workspace/contracts";
import { initTempLifecycle } from "./init-temp-lifecycle.js";

function makeFakeTempFileManager(tempDirPath: string): ITempFileManager {
  return {
    initialize: vi.fn().mockImplementation(async () => {
      fs.mkdirSync(tempDirPath, { recursive: true });
    }),
    cleanup: vi.fn().mockResolvedValue(undefined),
    stopCleanup: vi.fn(),
    getTempDirPath: vi.fn().mockReturnValue(tempDirPath),
  };
}

describe("initTempLifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-init-temp-lifecycle-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("constructs and initializes the injected temp-file manager, creating .docuvia/tmp/", async () => {
    const tempDirPath = path.join(tmpDir, ".docuvia", "tmp");
    const build = vi.fn().mockReturnValue(makeFakeTempFileManager(tempDirPath));

    const lifecycle = await initTempLifecycle(
      build,
      tmpDir,
      createMockLogger(),
    );

    expect(lifecycle?.tempFileManager.getTempDirPath()).toBe(tempDirPath);
    expect(fs.existsSync(tempDirPath)).toBe(true);
    expect(build).toHaveBeenCalledWith(tmpDir, expect.anything());

    lifecycle?.stop();
    expect(lifecycle?.tempFileManager.stopCleanup).toHaveBeenCalled();
  });

  it("stop() is safe to call and delegates to the manager's stopCleanup()", async () => {
    const tempDirPath = path.join(tmpDir, ".docuvia", "tmp");
    const build = vi.fn().mockReturnValue(makeFakeTempFileManager(tempDirPath));

    const lifecycle = await initTempLifecycle(
      build,
      tmpDir,
      createMockLogger(),
    );
    expect(() => lifecycle?.stop()).not.toThrow();
  });

  it("returns undefined (non-fatal) and logs a warning when initialize() throws", async () => {
    const failing: ITempFileManager = {
      initialize: vi.fn().mockRejectedValue(new Error("EACCES")),
      cleanup: vi.fn(),
      stopCleanup: vi.fn(),
      getTempDirPath: vi.fn().mockReturnValue(""),
    };
    const logger = createMockLogger();

    const lifecycle = await initTempLifecycle(() => failing, tmpDir, logger);

    expect(lifecycle).toBeUndefined();
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });
});
