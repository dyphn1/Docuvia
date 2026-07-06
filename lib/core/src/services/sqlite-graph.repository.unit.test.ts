import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqliteGraphRepository } from "./sqlite-graph.repository";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

describe("SqliteGraphRepository", () => {
  const workspaceRoot = "/mock/workspace_graph";
  const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");

  beforeEach(() => {
    vi.restoreAllMocks();
    fs.mkdirSync(path.join(workspaceRoot, ".docuvia"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src/interface.ts"), "");

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        file_path TEXT,
        content_hash TEXT,
        last_parsed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, file_path)
      );
      CREATE TABLE IF NOT EXISTS l1_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        slug TEXT,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS l2_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        name TEXT,
        slug TEXT,
        type TEXT,
        is_system INTEGER DEFAULT 0,
        description TEXT,
        ai_generated INTEGER DEFAULT 1,
        needs_review INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
        path_patterns TEXT,
        reindex_required INTEGER DEFAULT 0,
        is_bootstrap_confirmed INTEGER DEFAULT 0,
        content_hash TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS node_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_node_id INTEGER,
        target_node_id INTEGER,
        link_type TEXT,
        commit_sha TEXT,
        diff_summary TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS l2_node_l1_tags (
        l2_node_id INTEGER,
        l1_tag_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (e) {}
    }
    if (fs.existsSync(dbPath + "-wal")) {
      try {
        fs.unlinkSync(dbPath + "-wal");
      } catch (e) {}
    }
    if (fs.existsSync(dbPath + "-shm")) {
      try {
        fs.unlinkSync(dbPath + "-shm");
      } catch (e) {}
    }
    if (fs.existsSync(path.join(workspaceRoot, "src/interface.ts"))) {
      try {
        fs.unlinkSync(path.join(workspaceRoot, "src/interface.ts"));
      } catch (e) {}
    }
    if (fs.existsSync(path.join(workspaceRoot, "src"))) {
      try {
        fs.rmdirSync(path.join(workspaceRoot, "src"));
      } catch (e) {}
    }
    if (fs.existsSync(path.join(workspaceRoot, ".docuvia"))) {
      try {
        fs.rmdirSync(path.join(workspaceRoot, ".docuvia"));
      } catch (e) {}
    }
  });

  it("should persist implements and extends link types", async () => {
    const repo = new SqliteGraphRepository();

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

    await repo.persistAstGraph(workspaceRoot, parsedResults as any, ["tag1"]);

    const db = new Database(dbPath);
    try {
      const links = db
        .prepare("SELECT * FROM node_links WHERE link_type IN ('implements', 'extends')")
        .all() as any[];

      expect(links.length).toBe(2);
      const types = links.map((l) => l.link_type);
      expect(types).toContain("implements");
      expect(types).toContain("extends");

      // Regression guard: these must be symbol-level edges (ConsumerClass -> TargetInterface /
      // TargetClass), not file-level edges (consumer.ts -> interface.ts). Both classes share the
      // same file, so a file-level bug would collapse source and target to the same file node.
      const nodeByName = (name: string) =>
        db.prepare("SELECT id FROM l2_nodes WHERE name = ?").get(name) as
          | { id: number }
          | undefined;

      const consumerClassId = nodeByName("ConsumerClass")?.id;
      const targetInterfaceId = nodeByName("TargetInterface")?.id;
      const targetClassId = nodeByName("TargetClass")?.id;
      const consumerFileId = nodeByName("src/consumer.ts")?.id;
      const interfaceFileId = nodeByName("src/interface.ts")?.id;

      expect(consumerClassId).toBeDefined();
      expect(targetInterfaceId).toBeDefined();
      expect(targetClassId).toBeDefined();

      const implementsLink = links.find((l) => l.link_type === "implements");
      const extendsLink = links.find((l) => l.link_type === "extends");

      expect(implementsLink.source_node_id).toBe(consumerClassId);
      expect(implementsLink.target_node_id).toBe(targetInterfaceId);
      expect(extendsLink.source_node_id).toBe(consumerClassId);
      expect(extendsLink.target_node_id).toBe(targetClassId);

      // None of the symbol-level ids should equal the flattened file-level ids.
      expect(implementsLink.source_node_id).not.toBe(consumerFileId);
      expect(implementsLink.target_node_id).not.toBe(interfaceFileId);
      expect(extendsLink.source_node_id).not.toBe(consumerFileId);
      expect(extendsLink.target_node_id).not.toBe(interfaceFileId);
    } finally {
      db.close();
    }
  });
});
