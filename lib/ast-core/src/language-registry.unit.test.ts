import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { LanguageRegistry } from "./language-registry.js";
import { UTF8_ENCODING } from "@workspace/contracts";

describe("LanguageRegistry.load() graceful fallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-language-registry-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("gracefully falls back to defaults when languages.toml is missing", async () => {
    const registry = await LanguageRegistry.load(tmpDir);
    expect(registry).toBeDefined();
    expect(registry.getConfig()).toEqual({ languages: {} });
  });

  it("gracefully falls back to defaults when languages.toml is invalid", async () => {
    const invalidTomlPath = path.join(tmpDir, "languages.toml");
    fs.writeFileSync(invalidTomlPath, "invalid = toml [ [ [", UTF8_ENCODING);

    const registry = await LanguageRegistry.load(tmpDir);
    expect(registry).toBeDefined();
    expect(registry.getConfig()).toEqual({ languages: {} });
  });
});
