import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { AnalyzeService } from "./analyze-service.js";
import type { IConfigScanner } from "../interfaces/analyzer.interfaces.js";

function readLogLines(workspaceRoot: string, fileName: string): Array<Record<string, unknown>> {
  const logPath = path.join(workspaceRoot, ".docuvia", "logs", fileName);
  return fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("AnalyzeService.analyzeProject", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-analyze-service-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeService(deep = false) {
    const configScanner: IConfigScanner = {
      scanConfigs: vi.fn().mockResolvedValue({ projectType: "node", tags: ["typescript"] }),
    };
    const service = new AnalyzeService(tmpDir, () => {}, configScanner);
    return { service, configScanner };
  }

  it("returns the project type and suggested tags from the config scanner", async () => {
    const { service } = makeService();
    const result = await service.analyzeProject({ deep: true });

    expect(result).toEqual({ projectType: "node", suggestedTags: ["typescript"] });
  });

  it("logs an analyze.start and analyze.summary JSONL event to .docuvia/logs/analyze.log", async () => {
    const { service } = makeService();
    const result = await service.analyzeProject({ deep: true });

    const lines = readLogLines(tmpDir, "analyze.log");
    const start = lines.find((l) => l.event === "analyze.start");
    expect(start).toBeDefined();
    expect(start!.deep).toBe(true);

    const summary = lines.find((l) => l.event === "analyze.summary");
    expect(summary).toBeDefined();
    expect(summary!.projectType).toBe(result.projectType);
    expect(summary!.suggestedTags).toEqual(result.suggestedTags);
  });
});
