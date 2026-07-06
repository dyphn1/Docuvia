import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { TopologyExportService } from "./topology-export.service.js";

describe("TopologyExportService", () => {
  let workspaceRoot: string;
  let dbPath: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-topology-"));
    fs.mkdirSync(path.join(workspaceRoot, ".docuvia"), { recursive: true });
    dbPath = path.join(workspaceRoot, ".docuvia", "local.db");

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE l2_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        name TEXT,
        type TEXT,
        path_patterns TEXT
      );
      CREATE TABLE node_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_node_id INTEGER,
        target_node_id INTEGER,
        link_type TEXT
      );
      CREATE TABLE l3_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        l2_node_id INTEGER,
        title TEXT,
        content TEXT,
        status TEXT
      );
      CREATE TABLE l1_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        slug TEXT
      );
      CREATE TABLE l2_node_l1_tags (
        l2_node_id INTEGER,
        l1_tag_id INTEGER
      );
    `);

    // Fixture mirrors persistAstGraph output:
    //   1 lib/core/src/a.ts        (file)
    //   2 └── funcA               (symbol, contains)
    //   3 lib/core/src/b.ts        (file)
    //   4 └── ClassB              (symbol, contains)
    //   5 artifacts/cli/src/c.ts   (file, no symbols)
    // funcA --calls--> ClassB ; ClassB --implements--> funcA(pretend iface)
    db.exec(`
      INSERT INTO l2_nodes (id, project_id, name, type, path_patterns) VALUES
        (1, 1, 'lib/core/src/a.ts', 'module', '["lib/core/src/a.ts"]'),
        (2, 1, 'funcA', 'module', '["lib/core/src/a.ts"]'),
        (3, 1, 'lib/core/src/b.ts', 'module', '["lib/core/src/b.ts"]'),
        (4, 1, 'ClassB', 'module', '["lib/core/src/b.ts"]'),
        (5, 1, 'artifacts/cli/src/c.ts', 'module', '["artifacts/cli/src/c.ts"]');
      INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES
        (1, 2, 'contains'),
        (3, 4, 'contains'),
        (2, 4, 'calls'),
        (4, 2, 'implements');
      INSERT INTO l3_nodes (l2_node_id, title, content, status) VALUES
        (1, 'Use WAL journal mode', '', 'active'),
        (3, 'Stale decision', '', 'archived');
      INSERT INTO l1_tags (id, name, slug) VALUES (1, 'typescript', 'typescript');
      INSERT INTO l2_node_l1_tags (l2_node_id, l1_tag_id) VALUES (1, 1);
    `);
    db.close();
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("exports symbol-level nodes with correct kinds, decision nodes, and directory groups", () => {
    const graph = new TopologyExportService(workspaceRoot).exportTopology();

    expect(graph.topologyVersion).toBe(1);
    expect(graph.collapsed).toBe(false);

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get("l2:1")?.kind).toBe("file");
    expect(byId.get("l2:2")?.kind).toBe("symbol");
    expect(byId.get("l2:4")?.kind).toBe("symbol");
    expect(byId.get("l2:5")?.kind).toBe("file");

    // Only the active decision is exported, linked to its parent file node.
    const decisions = graph.nodes.filter((n) => n.kind === "decision");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].label).toBe("Use WAL journal mode");
    expect(decisions[0].parent).toBe("l2:1");
    expect(graph.links.some((l) => l.source === decisions[0].id && l.linkType === "decision")).toBe(
      true
    );

    // Symbol-level edges preserved verbatim.
    expect(
      graph.links.some((l) => l.source === "l2:2" && l.target === "l2:4" && l.linkType === "calls")
    ).toBe(true);

    // Directory clusters: lib/core and artifacts/cli.
    const groupLabels = graph.groups.map((g) => g.label);
    expect(groupLabels).toContain("lib/core");
    expect(groupLabels).toContain("artifacts/cli");

    // Tags attached to file nodes only.
    expect(byId.get("l2:1")?.tags).toEqual(["typescript"]);
    expect(byId.get("l2:2")?.tags).toBeUndefined();

    expect(graph.stats.nodeCount).toBe(graph.nodes.length);
    expect(graph.stats.linkCount).toBe(graph.links.length);
  });

  it("collapse: 'file' folds symbol links into file-to-file edges without self-loops or dupes", () => {
    const graph = new TopologyExportService(workspaceRoot).exportTopology({ collapse: "file" });

    expect(graph.collapsed).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "symbol")).toBe(false);
    expect(graph.links.some((l) => l.linkType === "contains")).toBe(false);
    expect(graph.links.some((l) => l.source === l.target)).toBe(false);

    // funcA->ClassB call becomes a.ts -> b.ts.
    expect(
      graph.links.some((l) => l.source === "l2:1" && l.target === "l2:3" && l.linkType === "calls")
    ).toBe(true);

    // Decisions survive collapse (they attach to file nodes).
    expect(graph.nodes.some((n) => n.kind === "decision")).toBe(true);
  });

  it("collapse: 'auto' folds when node count exceeds maxNodes", () => {
    const service = new TopologyExportService(workspaceRoot);
    expect(service.exportTopology({ maxNodes: 3 }).collapsed).toBe(true);
    expect(service.exportTopology({ maxNodes: 100 }).collapsed).toBe(false);
  });

  it("throws a clear error when the local database is missing", () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-topology-empty-"));
    try {
      expect(() => new TopologyExportService(emptyRoot).exportTopology()).toThrow(
        /Local database not found/
      );
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("supports the legacy schema (UUID string ids, source_paths column)", () => {
    const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-topology-legacy-"));
    try {
      fs.mkdirSync(path.join(legacyRoot, ".docuvia"), { recursive: true });
      const db = new Database(path.join(legacyRoot, ".docuvia", "local.db"));
      db.exec(`
        CREATE TABLE l2_nodes (id TEXT PRIMARY KEY, name TEXT, slug TEXT, type TEXT, source_paths TEXT, l1_tag_id INTEGER, description TEXT);
        CREATE TABLE node_links (id INTEGER PRIMARY KEY, source_node_id TEXT, target_node_id TEXT, link_type TEXT);
        INSERT INTO l2_nodes (id, name, type, source_paths) VALUES
          ('uuid-a', 'src/a.ts', 'file', '["src/a.ts"]'),
          ('uuid-b', 'src/b.ts', 'file', '["src/b.ts"]');
        INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES
          ('uuid-a', 'uuid-b', 'calls'),
          ('uuid-a', 'uuid-deleted', 'calls');
      `);
      db.close();

      const graph = new TopologyExportService(legacyRoot).exportTopology();

      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes.every((n) => n.kind === "file")).toBe(true);
      expect(graph.nodes.find((n) => n.id === "l2:uuid-a")?.filePath).toBe("src/a.ts");
      // The valid edge survives; the dangling edge to a deleted node is dropped.
      expect(graph.links).toHaveLength(1);
      expect(graph.links[0]).toMatchObject({
        source: "l2:uuid-a",
        target: "l2:uuid-b",
        linkType: "calls",
      });
    } finally {
      fs.rmSync(legacyRoot, { recursive: true, force: true });
    }
  });

  it("tolerates a workspace without l3_nodes or tag tables", () => {
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-topology-bare-"));
    try {
      fs.mkdirSync(path.join(bareRoot, ".docuvia"), { recursive: true });
      const db = new Database(path.join(bareRoot, ".docuvia", "local.db"));
      db.exec(`
        CREATE TABLE l2_nodes (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, type TEXT, path_patterns TEXT);
        CREATE TABLE node_links (id INTEGER PRIMARY KEY, source_node_id INTEGER, target_node_id INTEGER, link_type TEXT);
        INSERT INTO l2_nodes (id, project_id, name, type, path_patterns)
          VALUES (1, 1, 'src/x.ts', 'module', '["src/x.ts"]');
      `);
      db.close();

      const graph = new TopologyExportService(bareRoot).exportTopology();
      expect(graph.nodes).toHaveLength(1);
      expect(graph.nodes[0].kind).toBe("file");
    } finally {
      fs.rmSync(bareRoot, { recursive: true, force: true });
    }
  });
});
