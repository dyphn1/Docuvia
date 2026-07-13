import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { LanguageRegistry } from "./language-registry.js";

describe("LanguageRegistry.load() console.debug gating", () => {
  let tmpDir: string;
  const ORIGINAL_LOG_LEVEL = process.env.LOG_LEVEL;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-language-registry-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (ORIGINAL_LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = ORIGINAL_LOG_LEVEL;
    vi.restoreAllMocks();
  });

  it("does not call console.debug when LOG_LEVEL is not 'debug'", async () => {
    delete process.env.LOG_LEVEL;
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    // tmpDir has no languages.toml, forcing the fs.access() catch branch that used to
    // unconditionally call console.debug.
    await LanguageRegistry.load(tmpDir);

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("calls console.debug when LOG_LEVEL is 'debug'", async () => {
    process.env.LOG_LEVEL = "debug";
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    await LanguageRegistry.load(tmpDir);

    expect(debugSpy).toHaveBeenCalled();
  });
});
