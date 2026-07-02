import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LocalOrphanBranchWriter } from "./local-orphan-branch-writer";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], opts: any, cb: any) =>
    cb(null, { stdout: "git version" }),
  spawn: vi.fn(() => ({
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => {
      if (event === "close") cb(0);
    }),
    stdin: { end: vi.fn() },
  })),
}));

describe("LocalOrphanBranchWriter", () => {
  const workspaceRoot = "/mock/workspace_orphan";
  const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");

  beforeEach(() => {
    fs.mkdirSync(path.join(workspaceRoot, ".docuvia"), { recursive: true });
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE l1_tags (name TEXT);
      CREATE TABLE l2_nodes (id INTEGER PRIMARY KEY, name TEXT, type TEXT, description TEXT, source_paths TEXT);
      CREATE TABLE l3_nodes (id INTEGER PRIMARY KEY, l2_node_id INTEGER, title TEXT, status TEXT, created_at TEXT, content TEXT);
      CREATE TABLE node_links (source_node_id INTEGER, target_node_id INTEGER, link_type TEXT);
    `);
    db.prepare(
      "INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES (1, 2, 'calls')"
    ).run();
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(path.join(workspaceRoot, ".docuvia")))
      fs.rmdirSync(path.join(workspaceRoot, ".docuvia"));
    vi.clearAllMocks();
  });

  it("should export node_links.yaml", async () => {
    const writer = new LocalOrphanBranchWriter(workspaceRoot);
    await writer.packToBranch();

    const spawnMock = vi.mocked(child_process.spawn);
    expect(spawnMock).toHaveBeenCalled();
    const spawnCall = spawnMock.mock.calls[0];
    const stdinEndCall = (spawnMock.mock.results[0].value as any).stdin.end.mock.calls[0];
    const fastImportData = stdinEndCall[0] as string;

    expect(fastImportData).toContain("node_links.yaml");
    expect(fastImportData).toContain('link_type: "calls"');
    expect(fastImportData).toContain("source_node_id: 1");
    expect(fastImportData).toContain("target_node_id: 2");
  });
});
