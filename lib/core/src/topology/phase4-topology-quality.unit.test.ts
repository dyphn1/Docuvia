import { describe, expect, it } from "vitest";
import type { L2NodeRow, L3NodeRow, NodeLinkRow } from "@workspace/contracts";
import { TopologyBuilderService } from "./topology-builder.service.js";

// TDD-SOURCE: lib/contracts/src/interfaces/topology.interfaces.ts

function makeL2(overrides: Partial<L2NodeRow> = {}): L2NodeRow {
  return {
    id: 1,
    project_id: 1,
    name: "src/a.ts",
    type: "module",
    is_system: 0,
    description: null,
    ai_generated: 0,
    needs_review: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    last_verified_at: null,
    path_patterns: JSON.stringify(["src/a.ts"]),
    reindex_required: 0,
    is_bootstrap_confirmed: 0,
    content_hash: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    node_key: "src/a.ts",
    ...overrides,
  };
}

function makeLink(overrides: Partial<NodeLinkRow> = {}): NodeLinkRow {
  return {
    id: 1,
    source_node_id: 1,
    target_node_id: 2,
    link_type: "calls",
    commit_sha: null,
    diff_summary: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeL3(overrides: Partial<L3NodeRow> = {}): L3NodeRow {
  return {
    id: 5,
    l2_node_id: 1,
    title: "decision",
    content: "content",
    node_type: "decision",
    source_commits: JSON.stringify(["abc123"]),
    commit_hash: null,
    ai_generated: 1,
    confidence: 0.8,
    noise_score: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_verified_at: null,
    occurrence_count: 1,
    introduced_in_commit: null,
    verified_until_commit: null,
    validity_status: "active",
    source: "analyze",
    content_hash: null,
    extraction_model: null,
    source_files: null,
    initial_source_commits: null,
    anchor_ranges: null,
    ...overrides,
  };
}

function withoutGeneratedAt<T extends { generatedAt: string }>(graph: T) {
  const { generatedAt: _generatedAt, ...stable } = graph;
  return stable;
}

describe("Phase 4 topology hardening", () => {
  const builder = new TopologyBuilderService();

  it("returns a complete empty topology contract for empty graph input", () => {
    const graph = builder.build({
      workspaceRoot: "/workspace",
      l2Rows: [],
      linkRows: [],
      l3Rows: [],
      tagRows: [],
    });

    expect(graph).toMatchObject({
      topologyVersion: 2,
      workspaceRoot: "/workspace",
      collapsed: false,
      nodes: [],
      links: [],
      groups: [],
      stats: {
        nodeCount: 0,
        linkCount: 0,
        groupCount: 0,
        foldedLinkCount: 0,
      },
    });
    expect(Number.isNaN(Date.parse(graph.generatedAt))).toBe(false);
  });

  it("produces deterministic structural topology across repeated identical input", () => {
    const input = {
      workspaceRoot: "/workspace",
      l2Rows: [
        makeL2(),
        makeL2({
          id: 2,
          name: "helper",
          node_key: "src/a.ts#helper",
        }),
      ],
      linkRows: [
        makeLink({
          source_node_id: 1,
          target_node_id: 2,
          link_type: "contains",
        }),
      ],
      l3Rows: [makeL3()],
      tagRows: [{ l2NodeId: 1, name: "typescript" }],
    };

    const first = builder.build(input, { collapse: "symbol" });
    const second = builder.build(input, { collapse: "symbol" });

    expect(withoutGeneratedAt(second)).toEqual(withoutGeneratedAt(first));
    expect(first.nodes.find((node) => node.id === "l2:1")?.tags).toEqual([
      "typescript",
    ]);
  });

  it("bounds malformed persisted metadata without throwing and remains deterministic", () => {
    const input = {
      workspaceRoot: "/workspace",
      l2Rows: [
        makeL2({
          path_patterns: "legacy/raw/path.ts",
          node_key: "legacy/raw/path.ts",
        }),
      ],
      linkRows: [],
      l3Rows: [makeL3({ source_commits: "{not-json" })],
      tagRows: [],
    };

    const first = builder.build(input);
    const second = builder.build(input);

    expect(withoutGeneratedAt(second)).toEqual(withoutGeneratedAt(first));
    expect(first.nodes.find((node) => node.id === "l2:1")?.filePath).toBe(
      "legacy/raw/path.ts",
    );
    expect(first.nodes.find((node) => node.id === "l3:5")?.sourceCommits).toBe(
      undefined,
    );
  });
});
