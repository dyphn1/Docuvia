import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GraphDatabaseRepository } from "./graph-database.repository";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

describe("GraphDatabaseRepository", () => {
  const workspaceRoot = "/mock/workspace_graph";
  const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");

  beforeEach(() => {
    vi.restoreAllMocks();
    fs.mkdirSync(path.join(workspaceRoot, ".docuvia"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src/interface.ts"), "");

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE project_files (project_id INTEGER, file_path TEXT, content_hash TEXT, last_parsed_at TEXT, UNIQUE(project_id, file_path));
      CREATE TABLE l1_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, slug TEXT, description TEXT);
      CREATE TABLE l2_nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, type TEXT, source_paths TEXT, description TEXT);
      CREATE TABLE node_links (source_node_id INTEGER, target_node_id INTEGER, link_type TEXT);
      CREATE TABLE l2_node_l1_tags (l2_node_id INTEGER, l1_tag_id INTEGER);
    `);
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(path.join(workspaceRoot, "src/interface.ts")))
      fs.unlinkSync(path.join(workspaceRoot, "src/interface.ts"));
    if (fs.existsSync(path.join(workspaceRoot, "src")))
      fs.rmdirSync(path.join(workspaceRoot, "src"));
    if (fs.existsSync(path.join(workspaceRoot, ".docuvia")))
      fs.rmdirSync(path.join(workspaceRoot, ".docuvia"));
  });

  it("should persist implements and extends link types", async () => {
    const repo = new GraphDatabaseRepository();

    // Mock ScopeResolver by passing pre-resolved data if needed, but since we rely on resolver.resolveCall, we can just supply local references
    const parsedResults = [
      {
        file: "src/interface.ts",
        hash: "hash1",
        data: {
          classes: [{ name: "TargetInterface" }, { name: "TargetClass" }],
          exports: [
            { name: "TargetInterface", type: "class" },
            { name: "TargetClass", type: "class" },
          ],
        },
      },
      {
        file: "src/consumer.ts",
        hash: "hash2",
        data: {
          classes: [{ name: "ConsumerClass" }],
          imports: [
            {
              localName: "TargetInterface",
              originalName: "TargetInterface",
              modulePath: "./interface",
            },
            { localName: "TargetClass", originalName: "TargetClass", modulePath: "./interface" },
          ],
          implements: [{ sourceClass: "ConsumerClass", targetInterface: "TargetInterface" }],
          extends: [{ sourceClass: "ConsumerClass", targetClass: "TargetClass" }],
        },
      },
    ];

    await repo.persistAstGraph(workspaceRoot, parsedResults, ["tag1"]);

    const db = new Database(dbPath);
    const links = db
      .prepare("SELECT * FROM node_links WHERE link_type IN ('implements', 'extends')")
      .all() as any[];

    expect(links.length).toBe(2);
    const types = links.map((l) => l.link_type);
    expect(types).toContain("implements");
    expect(types).toContain("extends");

    db.close();
  });
});
