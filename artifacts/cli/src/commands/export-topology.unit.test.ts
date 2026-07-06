import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { exportTopologyCommand } from "./export-topology.js";

describe("exportTopologyCommand", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-export-topo-"));
    fs.mkdirSync(path.join(workspaceRoot, ".docuvia"), { recursive: true });
    const db = new Database(path.join(workspaceRoot, ".docuvia", "local.db"));
    db.exec(`
      CREATE TABLE l2_nodes (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, type TEXT, path_patterns TEXT);
      CREATE TABLE node_links (id INTEGER PRIMARY KEY, source_node_id INTEGER, target_node_id INTEGER, link_type TEXT);
      INSERT INTO l2_nodes (id, project_id, name, type, path_patterns) VALUES
        (1, 1, 'src/a.ts', 'module', '["src/a.ts"]'),
        (2, 1, 'funcA', 'module', '["src/a.ts"]'),
        (3, 1, 'src/b.ts', 'module', '["src/b.ts"]');
      INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES
        (1, 2, 'contains'),
        (2, 3, 'calls');
    `);
    db.close();
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("writes topology.json and a self-contained topology.html into .docuvia", async () => {
    await exportTopologyCommand({ workspaceRoot });

    const jsonPath = path.join(workspaceRoot, ".docuvia", "topology.json");
    const htmlPath = path.join(workspaceRoot, ".docuvia", "topology.html");
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(htmlPath)).toBe(true);

    const graph = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    expect(graph.topologyVersion).toBe(1);
    expect(graph.nodes).toHaveLength(3);

    const html = fs.readFileSync(htmlPath, "utf8");
    // The graph data is embedded, and the viewer must be fully offline:
    // no external scripts, stylesheets, imports, or fetches of any kind.
    expect(html).toContain('"topologyVersion":1');
    expect(html).toContain("funcA");
    expect(html).not.toMatch(/src\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/href\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/\bfetch\s*\(/);
    expect(html).not.toMatch(/@import/);
  });

  it("--json skips the HTML viewer and --out redirects the output directory", async () => {
    const outDir = path.join(workspaceRoot, "custom-out");
    await exportTopologyCommand({ workspaceRoot, jsonOnly: true, out: outDir });

    expect(fs.existsSync(path.join(outDir, "topology.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "topology.html"))).toBe(false);
  });

  it("escapes </script> sequences in labels so they cannot break the embedded data", async () => {
    const db = new Database(path.join(workspaceRoot, ".docuvia", "local.db"));
    db.exec(
      `INSERT INTO l2_nodes (id, project_id, name, type, path_patterns) VALUES (9, 1, 'evil</script><script>alert(1)', 'module', '["src/evil.ts"]')`
    );
    db.close();

    await exportTopologyCommand({ workspaceRoot });
    const html = fs.readFileSync(path.join(workspaceRoot, ".docuvia", "topology.html"), "utf8");
    expect(html).not.toContain("evil</script>");
    expect(html).toContain("evil\\u003c/script");
  });

  it("propagates a clear error when no local database exists", async () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-export-empty-"));
    try {
      await expect(exportTopologyCommand({ workspaceRoot: emptyRoot })).rejects.toThrow(
        /Local database not found/
      );
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
