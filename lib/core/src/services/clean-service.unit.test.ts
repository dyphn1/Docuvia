import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CleanService } from "./clean-service";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

describe("CleanService", () => {
  const workspaceRoot = "/mock/workspace_clean";
  const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");

  beforeEach(() => {
    fs.mkdirSync(path.join(workspaceRoot, ".docuvia"), { recursive: true });
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE project_files (file_path TEXT PRIMARY KEY);
      CREATE TABLE l2_nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, source_paths TEXT);
      CREATE TABLE node_links (source_node_id INTEGER, target_node_id INTEGER);
      CREATE TABLE l2_node_l1_tags (l2_node_id INTEGER);
    `);

    db.prepare("INSERT INTO project_files (file_path) VALUES (?)").run("src/active.ts");
    db.prepare("INSERT INTO project_files (file_path) VALUES (?)").run("src/stale.ts");

    db.prepare("INSERT INTO l2_nodes (id, source_paths) VALUES (?, ?)").run(1, '["src/active.ts"]');
    db.prepare("INSERT INTO l2_nodes (id, source_paths) VALUES (?, ?)").run(2, '["src/stale.ts"]');

    db.prepare("INSERT INTO node_links (source_node_id, target_node_id) VALUES (?, ?)").run(1, 2);
    db.prepare("INSERT INTO l2_node_l1_tags (l2_node_id) VALUES (?)").run(2);
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    // recursive: true (not rmdirSync) — the clean.start/clean.summary logging test below leaves
    // a non-empty .docuvia/logs/ subdirectory behind.
    if (fs.existsSync(path.join(workspaceRoot, ".docuvia")))
      fs.rmSync(path.join(workspaceRoot, ".docuvia"), { recursive: true, force: true });
  });

  it("should remove stale records not in activeFiles", async () => {
    const service = new CleanService(workspaceRoot);
    const result = await service.prune(["src/active.ts"]);
    expect(result.success).toBe(true);
    expect(result.prunedFiles).toBe(1);

    const db = new Database(dbPath);
    const files = db.prepare("SELECT * FROM project_files").all() as any[];
    expect(files.length).toBe(1);
    expect(files[0].file_path).toBe("src/active.ts");

    const nodes = db.prepare("SELECT * FROM l2_nodes").all() as any[];
    expect(nodes.length).toBe(1);
    expect(nodes[0].id).toBe(1);

    const links = db.prepare("SELECT * FROM node_links").all() as any[];
    expect(links.length).toBe(0);

    const tags = db.prepare("SELECT * FROM l2_node_l1_tags").all() as any[];
    expect(tags.length).toBe(0);

    db.close();
  });

  it("logs a clean.start and clean.summary JSONL event to .docuvia/logs/clean.log", async () => {
    const service = new CleanService(workspaceRoot);
    const result = await service.clean();
    expect(result.deleted).toBe(true);

    const logPath = path.join(workspaceRoot, ".docuvia", "logs", "clean.log");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines.some((l) => l.event === "clean.start")).toBe(true);
    const summary = lines.find((l) => l.event === "clean.summary");
    expect(summary).toBeDefined();
    expect(summary.deleted).toBe(true);
  });
});
