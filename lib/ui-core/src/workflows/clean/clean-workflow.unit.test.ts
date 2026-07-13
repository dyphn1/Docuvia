import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockLogger } from "@workspace/contracts";
import { CleanWorkflow } from "./clean-workflow.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";

describe("CleanWorkflow.execute()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-clean-workflow-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("deletes .docuvia/local.db when it exists", async () => {
    const dbPath = resolveDbPath(tmpDir);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "fake-db-contents");

    const result = await new CleanWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(result).toEqual({
      deleted: true,
      message: "Cleaned .docuvia/local.db database.",
    });
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("reports deleted:false when no database exists", async () => {
    const result = await new CleanWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(result).toEqual({
      deleted: false,
      message: "No local database found to clean.",
    });
  });

  it("logs a clean.start and clean.summary JSONL event to .docuvia/logs/clean.log", async () => {
    await new CleanWorkflow(tmpDir, createMockLogger()).execute();

    const logPath = path.join(tmpDir, ".docuvia", "logs", "clean.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines.some((l) => l.event === "clean.start")).toBe(true);
    const summary = lines.find((l) => l.event === "clean.summary");
    expect(summary).toBeDefined();
    expect(summary.deleted).toBe(false);
  });
});
