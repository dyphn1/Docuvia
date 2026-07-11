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
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-snapshot-renderer-test-"));
  });

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("writes graph/nodes.jsonl and graph/edges.jsonl reflecting every l2/link row", async () => {
    const fileNode = makeL2({ id: 1, name: "src/a.ts", path_patterns: JSON.stringify(["src/a.ts"]) });
    const fnNode = makeL2({ id: 2, name: "doThing", path_patterns: JSON.stringify(["src/a.ts"]) });
    const containsLink = makeLink({ source_node_id: 1, target_node_id: 2, link_type: "contains" });
    const callsLink = makeLink({ id: 2, source_node_id: 2, target_node_id: 2, link_type: "calls" });

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

  it("writes one markdown file per file node at knowledge/<filePath>.md", async () => {
    const fileNode = makeL2({ id: 1, name: "src/a.ts", path_patterns: JSON.stringify(["src/a.ts"]) });

    const result = await renderer.render({ outDir, l2Rows: [fileNode], linkRows: [] });

    expect(result.markdownFilesWritten).toBe(1);
    const mdPath = path.join(outDir, "knowledge", "src", "a.ts.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    const content = fs.readFileSync(mdPath, "utf8");
    expect(content).toContain("type: file");
    expect(content).toContain("# File: src/a.ts");
  });

  it("writes one markdown file per symbol node at knowledge/<dir>/<basename>/<symbol>.md", async () => {
    const fileNode = makeL2({ id: 1, name: "src/a.ts", path_patterns: JSON.stringify(["src/a.ts"]) });
    const fnNode = makeL2({ id: 2, name: "doThing", path_patterns: JSON.stringify(["src/a.ts"]) });
    const containsLink = makeLink({ source_node_id: 1, target_node_id: 2, link_type: "contains" });

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

    expect(result).toEqual({ nodesWritten: 0, edgesWritten: 0, markdownFilesWritten: 0, errors: [] });
    expect(fs.existsSync(path.join(outDir, "graph", "nodes.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "graph", "edges.jsonl"))).toBe(false);
  });

  it("sanitizes a path-traversal filePath instead of writing outside knowledgeDir", async () => {
    const fileNode = makeL2({
      id: 1,
      name: "evil.ts",
      path_patterns: JSON.stringify(["../../evil.ts"]),
    });

    const result = await renderer.render({ outDir, l2Rows: [fileNode], linkRows: [] });

    expect(result.errors).toEqual([]);
    expect(result.markdownFilesWritten).toBe(1);

    // Sanitized to a relative path contained within knowledgeDir/outDir — no traversal outside.
    const knowledgeDir = path.join(outDir, "knowledge");
    const written = fs.readdirSync(knowledgeDir, { recursive: true }) as string[];
    expect(written.some((f) => f.toString().endsWith("evil.ts.md"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "..", "evil.ts.md"))).toBe(false);
  });

  it("sanitizes illegal filename characters in a symbol's name instead of crashing", async () => {
    const fileNode = makeL2({ id: 1, name: "src/a.ts", path_patterns: JSON.stringify(["src/a.ts"]) });
    const fnNode = makeL2({ id: 2, name: 'do:this<>"|?*', path_patterns: JSON.stringify(["src/a.ts"]) });
    const containsLink = makeLink({ source_node_id: 1, target_node_id: 2, link_type: "contains" });

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
