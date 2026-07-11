import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { StatusService, LOCAL_DB_NOT_FOUND_MESSAGE } from "./status-service.js";

function seedLocalDb(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY);
    CREATE TABLE l2_nodes (id INTEGER PRIMARY KEY);
    CREATE TABLE l3_nodes (id INTEGER PRIMARY KEY);
  `);
  db.prepare("INSERT INTO projects DEFAULT VALUES").run();
  db.prepare("INSERT INTO l2_nodes DEFAULT VALUES").run();
  db.prepare("INSERT INTO l2_nodes DEFAULT VALUES").run();
  db.prepare("INSERT INTO l3_nodes DEFAULT VALUES").run();
  db.close();
}

function readLogLines(workspaceRoot: string, fileName: string): Array<Record<string, unknown>> {
  const logPath = path.join(workspaceRoot, ".docuvia", "logs", fileName);
  return fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("StatusService.getStatus", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-status-service-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns counts from the local database", async () => {
    seedLocalDb(path.join(tmpDir, ".docuvia", "local.db"));

    const service = new StatusService(tmpDir);
    const result = await service.getStatus();

    expect(result).toEqual({ projects: 1, l2Nodes: 2, l3Nodes: 1 });
  });

  it("logs a status.start and status.summary JSONL event to .docuvia/logs/status.log", async () => {
    seedLocalDb(path.join(tmpDir, ".docuvia", "local.db"));

    const service = new StatusService(tmpDir);
    const result = await service.getStatus();

    const lines = readLogLines(tmpDir, "status.log");
    expect(lines.some((l) => l.event === "status.start")).toBe(true);
    const summary = lines.find((l) => l.event === "status.summary");
    expect(summary).toBeDefined();
    expect(summary!.projects).toBe(result.projects);
    expect(summary!.l2Nodes).toBe(result.l2Nodes);
    expect(summary!.l3Nodes).toBe(result.l3Nodes);
  });

  it("throws LOCAL_DB_NOT_FOUND_MESSAGE and logs a status.error event when no local.db exists", async () => {
    const service = new StatusService(tmpDir);
    await expect(service.getStatus()).rejects.toThrow(LOCAL_DB_NOT_FOUND_MESSAGE);

    const lines = readLogLines(tmpDir, "status.log");
    expect(lines.some((l) => l.event === "status.error")).toBe(true);
  });
});
