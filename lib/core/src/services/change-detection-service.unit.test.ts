import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";
import { ChangeDetectionService, computeImpactRiskLevel } from "./change-detection-service.js";
import { QueryService } from "./query-service.js";
import { LOCAL_DB_NOT_FOUND_MESSAGE } from "./status-service.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function initRepo(cwd: string): void {
  git(cwd, ["init", "-q"]);
  git(cwd, ["config", "user.email", "test@docuvia.dev"]);
  git(cwd, ["config", "user.name", "Docuvia Test"]);
  // .docuvia holds this test's local.db fixture; it must not itself show up as an
  // "untracked file" in the diff being asserted on.
  fs.writeFileSync(path.join(cwd, ".gitignore"), ".docuvia/\n");
}

function createEmptyLocalDb(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE l2_nodes (id INTEGER PRIMARY KEY, name TEXT, type TEXT);
    CREATE TABLE node_links (source_node_id INTEGER, target_node_id INTEGER, link_type TEXT);
  `);
  db.close();
}

describe("ChangeDetectionService.detectChanges", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-change-detection-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws LOCAL_DB_NOT_FOUND_MESSAGE when no local.db exists", async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-q", "-m", "initial"]);

    const service = new ChangeDetectionService(tmpDir);
    await expect(service.detectChanges()).rejects.toThrow(LOCAL_DB_NOT_FOUND_MESSAGE);
  });

  it("reflects the real git diff (modified + untracked) and reports LOW risk with no matching graph nodes", async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-q", "-m", "initial"]);

    // Modify a tracked file.
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 2;\n");
    // Add an untracked file.
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "export const b = 1;\n");

    createEmptyLocalDb(path.join(tmpDir, ".docuvia", "local.db"));

    const service = new ChangeDetectionService(tmpDir);
    const result = await service.detectChanges();

    expect(result.baseRef).toBeNull();
    const files = result.filesChanged.map((f) => f.file).sort();
    expect(files).toEqual(["a.ts", "b.ts"]);
    expect(result.filesChanged.find((f) => f.file === "a.ts")?.status).toBe("modified");
    expect(result.filesChanged.find((f) => f.file === "b.ts")?.status).toBe("added");

    expect(result.riskLevel).toBe("LOW");
    expect(result.affectedNodes).toEqual([]);
    expect(result.analysis).toContain("Risk level: LOW");
  });

  it("throws LOCAL_DB_NOT_FOUND_MESSAGE when baseRef is given but no local.db exists", async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-q", "-m", "initial"]);

    const service = new ChangeDetectionService(tmpDir);
    await expect(service.detectChanges("HEAD")).rejects.toThrow(LOCAL_DB_NOT_FOUND_MESSAGE);
  });

  it("escalates risk to MEDIUM when a changed file has a small blast radius (mocked QueryService)", async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-q", "-m", "initial"]);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 2;\n");

    // The db file just needs to exist for the existence check; QueryService is mocked below.
    fs.mkdirSync(path.join(tmpDir, ".docuvia"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".docuvia", "local.db"), "");

    const mockQueryService = {
      getImpact: vi.fn().mockResolvedValue({
        blastRadius: [
          { name: "callerA", type: "function" },
          { name: "callerB", type: "function" },
        ],
      }),
    } as unknown as QueryService;

    const service = new ChangeDetectionService(tmpDir, undefined, mockQueryService);
    const result = await service.detectChanges();

    expect(mockQueryService.getImpact).toHaveBeenCalledWith("a.ts");
    expect(result.riskLevel).toBe("MEDIUM");
    expect(result.affectedNodes).toHaveLength(1);
    expect(result.affectedNodes[0].impactedBy).toHaveLength(2);
  });

  it("logs a review.start and review.summary JSONL event to .docuvia/logs/review.log", async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-q", "-m", "initial"]);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 2;\n");

    createEmptyLocalDb(path.join(tmpDir, ".docuvia", "local.db"));

    const service = new ChangeDetectionService(tmpDir);
    const result = await service.detectChanges();

    const logPath = path.join(tmpDir, ".docuvia", "logs", "review.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines.some((l) => l.event === "review.start")).toBe(true);
    const summary = lines.find((l) => l.event === "review.summary");
    expect(summary).toBeDefined();
    expect(summary.riskLevel).toBe(result.riskLevel);
    expect(summary.filesChanged).toBe(result.filesChanged.length);
  });

  it("logs a review.error JSONL event when the local database is missing", async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-q", "-m", "initial"]);

    const service = new ChangeDetectionService(tmpDir);
    await expect(service.detectChanges()).rejects.toThrow(LOCAL_DB_NOT_FOUND_MESSAGE);

    const logPath = path.join(tmpDir, ".docuvia", "logs", "review.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines.some((l) => l.event === "review.error")).toBe(true);
  });

  it("escalates risk to HIGH when total impacted nodes crosses the HIGH threshold (mocked QueryService)", async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-q", "-m", "initial"]);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 2;\n");

    fs.mkdirSync(path.join(tmpDir, ".docuvia"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".docuvia", "local.db"), "");

    const blastRadius = Array.from({ length: 7 }, (_, i) => ({
      name: `caller${i}`,
      type: "function",
    }));
    const mockQueryService = {
      getImpact: vi.fn().mockResolvedValue({ blastRadius }),
    } as unknown as QueryService;

    const service = new ChangeDetectionService(tmpDir, undefined, mockQueryService);
    const result = await service.detectChanges();

    expect(result.riskLevel).toBe("HIGH");
  });

  it("bumps LOW to MEDIUM when the diff spans more than the large-diff file floor, even with zero impacted nodes (large-diff floor is review-specific, not part of computeImpactRiskLevel)", async () => {
    initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-q", "-m", "initial"]);

    // 11 untracked files > LARGE_DIFF_FILE_FLOOR (10), none of which resolve to any graph node.
    for (let i = 0; i < 11; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.ts`), `export const v${i} = ${i};\n`);
    }

    createEmptyLocalDb(path.join(tmpDir, ".docuvia", "local.db"));

    const service = new ChangeDetectionService(tmpDir);
    const result = await service.detectChanges();

    expect(result.filesChanged.length).toBeGreaterThan(10);
    expect(result.affectedNodes).toEqual([]);
    expect(result.riskLevel).toBe("MEDIUM");
  });
});

describe("computeImpactRiskLevel (shared by review's detectChanges() and the standalone impact command)", () => {
  it("returns LOW for zero impacted nodes", () => {
    expect(computeImpactRiskLevel(0)).toBe("LOW");
  });

  it("returns MEDIUM just below the HIGH threshold", () => {
    expect(computeImpactRiskLevel(1)).toBe("MEDIUM");
    expect(computeImpactRiskLevel(5)).toBe("MEDIUM");
  });

  it("returns HIGH at and above the HIGH threshold, below CRITICAL", () => {
    expect(computeImpactRiskLevel(6)).toBe("HIGH");
    expect(computeImpactRiskLevel(20)).toBe("HIGH");
  });

  it("returns CRITICAL at and above the CRITICAL threshold", () => {
    expect(computeImpactRiskLevel(21)).toBe("CRITICAL");
    expect(computeImpactRiskLevel(100)).toBe("CRITICAL");
  });

  it("does not apply review's large-diff floor bump (that's applied separately in detectChanges())", () => {
    // computeImpactRiskLevel is a pure function of the impacted count alone — it has no
    // knowledge of filesChanged.length, so a count of 0 is always LOW regardless of diff size.
    expect(computeImpactRiskLevel(0)).toBe("LOW");
  });
});
