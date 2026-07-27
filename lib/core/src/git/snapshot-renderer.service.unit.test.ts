import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { L2NodeRow, NodeLinkRow } from "@workspace/contracts";
import { SnapshotRendererService } from "./snapshot-renderer.service.js";

function makeL2(overrides: Partial<L2NodeRow> = {}): L2NodeRow {
  return {
    id: 1,
    project_id: 1,
    name: "src/a.ts",
    type: "module",
    is_system: 0,
    description: null,
    ai_generated: 1,
    needs_review: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    last_verified_at: null,
    path_patterns: JSON.stringify(["src/a.ts"]),
    reindex_required: 0,
    is_bootstrap_confirmed: 0,
    content_hash: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    node_key: null,
    ...overrides,
  };
}

function makeLink(overrides: Partial<NodeLinkRow> = {}): NodeLinkRow {
  return {
    id: 1,
    source_node_id: 1,
    target_node_id: 2,
    link_type: "contains",
    commit_sha: null,
    diff_summary: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function readJsonl(filePath: string): unknown[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("SnapshotRendererService.render()", () => {
  let outDir: string;
  const renderer = new SnapshotRendererService();

  beforeEach(() => {
    outDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-snapshot-renderer-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("writes graph/nodes.jsonl and graph/edges.jsonl reflecting every l2/link row", async () => {
    const fileNode = makeL2({
      id: 1,
      name: "src/a.ts",
      path_patterns: JSON.stringify(["src/a.ts"]),
    });
    const fnNode = makeL2({
      id: 2,
      name: "doThing",
      path_patterns: JSON.stringify(["src/a.ts"]),
    });
    const containsLink = makeLink({
      source_node_id: 1,
      target_node_id: 2,
      link_type: "contains",
    });
    const callsLink = makeLink({
      id: 2,
      source_node_id: 2,
      target_node_id: 2,
      link_type: "calls",
    });

    const result = await renderer.render({
      outDir,
      l2Rows: [fileNode, fnNode],
      linkRows: [containsLink, callsLink],
    });

    expect(result.nodesWritten).toBe(2);
    expect(result.edgesWritten).toBe(2);

    const nodes = readJsonl(path.join(outDir, "graph", "nodes.jsonl"));
    expect(nodes).toEqual([
      { id: "l2:1", type: "file", name: "src/a.ts", filePath: "src/a.ts" },
      { id: "l2:2", type: "symbol", name: "doThing", filePath: "src/a.ts" },
    ]);

    const edges = readJsonl(path.join(outDir, "graph", "edges.jsonl"));
    expect(edges).toEqual([
      { source: "l2:1", target: "l2:2", type: "contains" },
      { source: "l2:2", target: "l2:2", type: "calls" },
    ]);
  });

  it("uses node_key (STOR-005) as the exported id instead of the rowid when present", async () => {
    const fileNode = makeL2({
      id: 1,
      name: "src/a.ts",
      path_patterns: JSON.stringify(["src/a.ts"]),
      node_key: "src/a.ts",
    });
    const fnNode = makeL2({
      id: 2,
      name: "doThing",
      path_patterns: JSON.stringify(["src/a.ts"]),
      node_key: "src/a.ts#doThing",
    });
    const containsLink = makeLink({
      source_node_id: 1,
      target_node_id: 2,
      link_type: "contains",
    });

    await renderer.render({
      outDir,
      l2Rows: [fileNode, fnNode],
      linkRows: [containsLink],
    });

    const nodes = readJsonl(path.join(outDir, "graph", "nodes.jsonl"));
    expect(nodes).toEqual([
      { id: "src/a.ts", type: "file", name: "src/a.ts", filePath: "src/a.ts" },
      {
        id: "src/a.ts#doThing",
        type: "symbol",
        name: "doThing",
        filePath: "src/a.ts",
      },
    ]);

    const edges = readJsonl(path.join(outDir, "graph", "edges.jsonl"));
    expect(edges).toEqual([
      { source: "src/a.ts", target: "src/a.ts#doThing", type: "contains" },
    ]);
  });

  it("sorts nodes/edges by id regardless of input row order (deterministic across ingestion runs)", async () => {
    // `l2Rows`/`linkRows` reflect `SELECT * FROM l2_nodes`/`node_links` in raw rowid (insertion)
    // order, which itself depends on AST-parse/worker-pool completion timing -- two ingestion
    // runs of the identical source commit can hand this same content in a different row order.
    // Sorting here is what makes the rendered nodes.jsonl/edges.jsonl (and therefore the packed
    // git tree) a pure function of graph content, independent of that persistence-order race.
    const nodeC = makeL2({
      id: 1,
      name: "src/c.ts",
      node_key: "src/c.ts",
      path_patterns: JSON.stringify(["src/c.ts"]),
    });
    const nodeA = makeL2({
      id: 2,
      name: "src/a.ts",
      node_key: "src/a.ts",
      path_patterns: JSON.stringify(["src/a.ts"]),
    });
    const nodeB = makeL2({
      id: 3,
      name: "src/b.ts",
      node_key: "src/b.ts",
      path_patterns: JSON.stringify(["src/b.ts"]),
    });
    const linkCA = makeLink({
      id: 1,
      source_node_id: 1,
      target_node_id: 2,
      link_type: "calls",
    });
    const linkAB = makeLink({
      id: 2,
      source_node_id: 2,
      target_node_id: 3,
      link_type: "calls",
    });

    // Rows deliberately handed in insertion (rowid) order, not sorted-by-id order.
    await renderer.render({
      outDir,
      l2Rows: [nodeC, nodeA, nodeB],
      linkRows: [linkCA, linkAB],
    });

    const nodes = readJsonl(path.join(outDir, "graph", "nodes.jsonl"));
    expect(nodes.map((n) => (n as { id: string }).id)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);

    const edges = readJsonl(path.join(outDir, "graph", "edges.jsonl"));
    expect(edges).toEqual([
      { source: "src/a.ts", target: "src/b.ts", type: "calls" },
      { source: "src/c.ts", target: "src/a.ts", type: "calls" },
    ]);
  });

  it("writes one markdown file per file node at knowledge/<filePath>.md", async () => {
    const fileNode = makeL2({
      id: 1,
      name: "src/a.ts",
      path_patterns: JSON.stringify(["src/a.ts"]),
    });

    const result = await renderer.render({
      outDir,
      l2Rows: [fileNode],
      linkRows: [],
    });

    expect(result.markdownFilesWritten).toBe(1);
    const mdPath = path.join(outDir, "knowledge", "src", "a.ts.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    const content = fs.readFileSync(mdPath, "utf8");
    expect(content).toContain("type: file");
    expect(content).toContain("# File: src/a.ts");
  });

  it("writes one markdown file per symbol node at knowledge/<dir>/<basename>/<symbol>.md", async () => {
    const fileNode = makeL2({
      id: 1,
      name: "src/a.ts",
      path_patterns: JSON.stringify(["src/a.ts"]),
    });
    const fnNode = makeL2({
      id: 2,
      name: "doThing",
      path_patterns: JSON.stringify(["src/a.ts"]),
    });
    const containsLink = makeLink({
      source_node_id: 1,
      target_node_id: 2,
      link_type: "contains",
    });

    const result = await renderer.render({
      outDir,
      l2Rows: [fileNode, fnNode],
      linkRows: [containsLink],
    });

    expect(result.markdownFilesWritten).toBe(2);
    const mdPath = path.join(outDir, "knowledge", "src", "a", "doThing.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    const content = fs.readFileSync(mdPath, "utf8");
    expect(content).toContain("type: symbol");
    expect(content).toContain("# Symbol: doThing");
  });

  it("skips graph files and reports zero counts for an empty graph", async () => {
    const result = await renderer.render({ outDir, l2Rows: [], linkRows: [] });

    expect(result).toEqual({
      nodesWritten: 0,
      edgesWritten: 0,
      markdownFilesWritten: 0,
      errors: [],
    });
    expect(fs.existsSync(path.join(outDir, "graph", "nodes.jsonl"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(outDir, "graph", "edges.jsonl"))).toBe(
      false,
    );
  });

  it("sanitizes a path-traversal filePath instead of writing outside knowledgeDir", async () => {
    const fileNode = makeL2({
      id: 1,
      name: "evil.ts",
      path_patterns: JSON.stringify(["../../evil.ts"]),
    });

    const result = await renderer.render({
      outDir,
      l2Rows: [fileNode],
      linkRows: [],
    });

    expect(result.errors).toEqual([]);
    expect(result.markdownFilesWritten).toBe(1);

    // Sanitized to a relative path contained within knowledgeDir/outDir — no traversal outside.
    const knowledgeDir = path.join(outDir, "knowledge");
    const written = fs.readdirSync(knowledgeDir, {
      recursive: true,
    }) as string[];
    expect(written.some((f) => f.toString().endsWith("evil.ts.md"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "..", "evil.ts.md"))).toBe(false);
  });

  it("sanitizes illegal filename characters in a symbol's name instead of crashing", async () => {
    const fileNode = makeL2({
      id: 1,
      name: "src/a.ts",
      path_patterns: JSON.stringify(["src/a.ts"]),
    });
    const fnNode = makeL2({
      id: 2,
      name: 'do:this<>"|?*',
      path_patterns: JSON.stringify(["src/a.ts"]),
    });
    const containsLink = makeLink({
      source_node_id: 1,
      target_node_id: 2,
      link_type: "contains",
    });

    const result = await renderer.render({
      outDir,
      l2Rows: [fileNode, fnNode],
      linkRows: [containsLink],
    });

    expect(result.errors).toEqual([]);
    expect(result.markdownFilesWritten).toBe(2);

    // The illegal characters are replaced (not left as-is, which would crash/misbehave on
    // Windows filesystems), but the exact substitution isn't the contract under test here.
    const symbolDir = path.join(outDir, "knowledge", "src", "a");
    const written = fs.readdirSync(symbolDir);
    expect(written).toHaveLength(1);
    expect(written[0]).not.toMatch(/[<>:"|?*]/);
    const content = fs.readFileSync(path.join(symbolDir, written[0]), "utf8");
    expect(content).toContain('do:this<>"|?*');
  });
});
