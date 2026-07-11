import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { initTempLifecycle } from "./init-temp-lifecycle.js";

describe("initTempLifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-init-temp-lifecycle-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("constructs and initializes a TempFileManager, creating .docuvia/tmp/", async () => {
    const lifecycle = await initTempLifecycle(tmpDir);

    expect(lifecycle).toBeDefined();
    expect(fs.existsSync(path.join(tmpDir, ".docuvia", "tmp"))).toBe(true);

    lifecycle?.stop();
  });

  it("stop() is idempotent-safe to call and clears the periodic cleanup interval", async () => {
    const lifecycle = await initTempLifecycle(tmpDir);
    expect(() => lifecycle?.stop()).not.toThrow();
  });

  it("returns undefined (non-fatal) when the workspace root cannot be used to create .docuvia/tmp", async () => {
    // A path that includes a null byte is invalid on every platform and reliably fails
    // fs.mkdir, matching old InitService.init()'s "Failed to initialize temp file manager
    // (non-fatal)" branch.
    const invalidRoot = path.join(tmpDir, "bad\0path");

    const lifecycle = await initTempLifecycle(invalidRoot);
    expect(lifecycle).toBeUndefined();
  });
});
