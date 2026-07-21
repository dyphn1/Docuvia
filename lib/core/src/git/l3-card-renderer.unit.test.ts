import { describe, it, expect } from "vitest";
import type { L2NodeRow, L3NodeRow, NodeLinkRow } from "@workspace/contracts";
import {
  computeL2GitPathsByNodeId,
  computeL2GitPathsByNodeKey,
  renderL3Card,
  parseL3Card,
} from "./l3-card-renderer.js";

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
    created_at: "",
    last_verified_at: null,
    path_patterns: JSON.stringify(["src/a.ts"]),
    reindex_required: 0,
    is_bootstrap_confirmed: 0,
    content_hash: null,
    updated_at: "",
    node_key: "src/a.ts",
    ...overrides,
  };
}

function makeL3(overrides: Partial<L3NodeRow> = {}): L3NodeRow {
  return {
    id: 1,
    l2_node_id: 1,
    title: "Uses async/await throughout",
    content: "All I/O paths use async/await.",
    node_type: "decision",
    source_commits: JSON.stringify(["commit-1", "commit-2"]),
    commit_hash: "commit-2",
    ai_generated: 1,
    confidence: 0.9,
    noise_score: null,
    created_at: "2024-01-01T00:00:00.000Z",
    last_verified_at: null,
    occurrence_count: 2,
    introduced_in_commit: null,
    verified_until_commit: null,
    validity_status: "pending",
    source: "analyze",
    content_hash: "abc123hash",
    extraction_model: "gpt-4o-mini",
    source_files: JSON.stringify(["src/a.ts"]),
    initial_source_commits: JSON.stringify(["commit-1"]),
    ...overrides,
  };
}

describe("computeL2GitPathsByNodeId", () => {
  it("maps a file node's id to knowledge/<path>.md", () => {
    const l2Rows = [makeL2({ id: 1, name: "src/a.ts" })];
    const linkRows: NodeLinkRow[] = [];

    const paths = computeL2GitPathsByNodeId(l2Rows, linkRows);

    expect(paths.get(1)).toBe("knowledge/src/a.ts.md");
  });

  it("maps a symbol node's id to knowledge/<dir>/<basename>/<symbolName>.md, using the containing file's path", () => {
    const l2Rows = [
      makeL2({ id: 1, name: "src/a.ts" }),
      makeL2({ id: 2, name: "doThing", node_key: "src/a.ts#doThing" }),
    ];
    const linkRows: NodeLinkRow[] = [
      {
        id: 1,
        source_node_id: 1,
        target_node_id: 2,
        link_type: "contains",
        commit_sha: null,
        diff_summary: null,
        created_at: "",
      },
    ];

    const paths = computeL2GitPathsByNodeId(l2Rows, linkRows);

    expect(paths.get(1)).toBe("knowledge/src/a.ts.md");
    expect(paths.get(2)).toBe("knowledge/src/a/doThing.md");
  });

  it("omits a node with no resolvable filePath", () => {
    const l2Rows = [makeL2({ id: 1, path_patterns: null })];
    const paths = computeL2GitPathsByNodeId(l2Rows, []);
    expect(paths.has(1)).toBe(false);
  });
});

describe("computeL2GitPathsByNodeKey", () => {
  it("produces the exact same paths as computeL2GitPathsByNodeId, keyed by nodeKey instead of rowid", () => {
    const nodes = [
      { nodeKey: "src/a.ts", name: "src/a.ts", filePath: "src/a.ts" },
      { nodeKey: "src/a.ts#doThing", name: "doThing", filePath: "src/a.ts" },
    ];
    const edges = [
      { source: "src/a.ts", target: "src/a.ts#doThing", type: "contains" },
    ];

    const paths = computeL2GitPathsByNodeKey(nodes, edges);

    expect(paths.get("src/a.ts")).toBe("knowledge/src/a.ts.md");
    expect(paths.get("src/a.ts#doThing")).toBe("knowledge/src/a/doThing.md");
  });

  it("omits a node with no filePath", () => {
    const nodes = [{ nodeKey: "orphan", name: "orphan" }];
    const paths = computeL2GitPathsByNodeKey(nodes, []);
    expect(paths.has("orphan")).toBe(false);
  });
});

describe("renderL3Card / parseL3Card", () => {
  it("round-trips every L3DIST-002 frontmatter field plus content", () => {
    const row = makeL3();
    const rendered = renderL3Card(row, "knowledge/src/a.ts.md");

    const parsed = parseL3Card(rendered);

    expect(parsed).toEqual({
      content_hash: "abc123hash",
      node_type: "decision",
      title: "Uses async/await throughout",
      l2_path: "knowledge/src/a.ts.md",
      source_commits: ["commit-1"], // frozen at initial_source_commits, not the grown source_commits
      extraction_model: "gpt-4o-mini",
      source_files: ["src/a.ts"],
      created_at: "2024-01-01T00:00:00.000Z",
      content: "All I/O paths use async/await.",
    });
  });

  it("falls back to source_commits when initial_source_commits is null (pre-migration row)", () => {
    const row = makeL3({
      initial_source_commits: null,
      source_commits: JSON.stringify(["only-commit"]),
    });
    const parsed = parseL3Card(renderL3Card(row, "knowledge/src/a.ts.md"));
    expect(parsed?.source_commits).toEqual(["only-commit"]);
  });

  it("produces byte-identical output for an unchanged row across repeated renders (idempotency, L3DIST edge case 5b)", () => {
    const row = makeL3();
    expect(renderL3Card(row, "knowledge/src/a.ts.md")).toBe(
      renderL3Card(row, "knowledge/src/a.ts.md"),
    );
  });

  it("round-trips null content as an empty string", () => {
    const row = makeL3({ content: null });
    const parsed = parseL3Card(renderL3Card(row, "knowledge/src/a.ts.md"));
    expect(parsed?.content).toBe("");
  });

  it("parseL3Card returns undefined for content that isn't a fenced-JSON-frontmatter card", () => {
    expect(parseL3Card("not a card at all")).toBeUndefined();
    expect(parseL3Card("---\nnot json\n---\n\nbody\n")).toBeUndefined();
  });
});
