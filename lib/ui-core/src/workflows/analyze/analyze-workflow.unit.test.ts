import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type IConfigScanner,
} from "@workspace/contracts";
import { AnalyzeWorkflow } from "./analyze-workflow.js";

describe("AnalyzeWorkflow.execute()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-analyze-workflow-test-"),
    );
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves IConfigScanner from the factory and returns its scan result", async () => {
    const configScanner: IConfigScanner = {
      scanConfigs: vi.fn().mockResolvedValue({
        projectType: "typescript",
        tags: ["typescript", "react"],
      }),
    };
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.lock();

    const result = await new AnalyzeWorkflow(
      tmpDir,
      createMockLogger(),
    ).execute();

    expect(configScanner.scanConfigs).toHaveBeenCalledWith(tmpDir);
    expect(result).toEqual({
      projectType: "typescript",
      suggestedTags: ["typescript", "react"],
    });
  });

  it("logs an analyze.start and analyze.summary JSONL event to .docuvia/logs/analyze.log", async () => {
    const configScanner: IConfigScanner = {
      scanConfigs: vi
        .fn()
        .mockResolvedValue({ projectType: "generic", tags: ["general"] }),
    };
    docuviaFactory.register(TOKENS.ConfigScanner, () => configScanner);
    docuviaFactory.lock();

    await new AnalyzeWorkflow(tmpDir, createMockLogger()).execute();

    const logPath = path.join(tmpDir, ".docuvia", "logs", "analyze.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines.some((l) => l.event === "analyze.start")).toBe(true);
    const summary = lines.find((l) => l.event === "analyze.summary");
    expect(summary?.projectType).toBe("generic");
    expect(summary?.suggestedTags).toEqual(["general"]);
  });
});
