import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockLogger } from "@workspace/contracts";
import { removeDocuviaDataDir } from "./remove-docuvia-dir.js";

describe("removeDocuviaDataDir()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-remove-dir-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes the whole .docuvia/ directory, not just local.db", async () => {
    const docuviaDir = path.join(tmpDir, ".docuvia");
    fs.mkdirSync(path.join(docuviaDir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(docuviaDir, "local.db"), "fake-db");
    fs.writeFileSync(path.join(docuviaDir, "logs", "clean.log"), "{}\n");
    fs.writeFileSync(path.join(docuviaDir, "topology.json"), "{}");

    const result = await removeDocuviaDataDir(tmpDir, createMockLogger());

    expect(result).toEqual({ removed: true });
    expect(fs.existsSync(docuviaDir)).toBe(false);
  });

  it("reports removed:false when .docuvia/ doesn't exist", async () => {
    const result = await removeDocuviaDataDir(tmpDir, createMockLogger());

    expect(result).toEqual({ removed: false });
  });
});
