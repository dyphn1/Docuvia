import { describe, it, expect } from "vitest";
import type { L2NodeRow, L3NodeRow, NodeLinkRow } from "@workspace/contracts";
import { TopologyBuilderService } from "./topology-builder.service.js";

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
    link_type: "calls",
    commit_sha: null,
    diff_summary: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeL3(overrides: Partial<L3NodeRow> = {}): L3NodeRow {
  return {
    id: 1,
    l2_node_id: 1,
    title: "a decision",
    content: "content",
    node_type: "decision",
    source_commits: "[]",
    commit_hash: null,
    ai_generated: 1,
    confidence: null,
    noise_score: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_verified_at: null,
    occurrence_count: 1,
    introduced_in_commit: null,
    verified_until_commit: null,
    validity_status: "pending",
    source: "commit",
    content_hash: null,
    extraction_model: null,
    source_files: null,
    initial_source_commits: null,
    ...overrides,
  };
}

describe("TopologyBuilderService.build()", () => {
  const builder = new TopologyBuilderService();

  it("projects l2/link/l3/tag rows into a symbol-level TopologyGraph by default", () => {
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
      id: 1,
      source_node_id: 1,
      target_node_id: 2,
      link_type: "contains",
    });
    const l3 = makeL3({ id: 5, l2_node_id: 1, title: "decision on a.ts" });

    const graph = builder.build({
      workspaceRoot: "/workspace",
      l2Rows: [fileNode, fnNode],
      linkRows: [containsLink],
      l3Rows: [l3],
      tagRows: [{ l2NodeId: 1, name: "typescript" }],
    });

    expect(graph.topologyVersion).toBe(1);
    expect(graph.collapsed).toBe(false);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      ["l2:1", "l2:2", "l3:5"].sort(),
    );

    const fileTopologyNode = graph.nodes.find((n) => n.id === "l2:1");
    expect(fileTopologyNode?.kind).toBe("file");
    expect(fileTopologyNode?.tags).toEqual(["typescript"]);

    const fnTopologyNode = graph.nodes.find((n) => n.id === "l2:2");
    expect(fnTopologyNode?.kind).toBe("symbol");

    const decisionNode = graph.nodes.find((n) => n.id === "l3:5");
    expect(decisionNode?.kind).toBe("decision");
    expect(decisionNode?.parent).toBe("l2:1");

    expect(graph.stats).toEqual({ nodeCount: 3, linkCount: 2, groupCount: 1 });
  });

  it("collapses symbols into their containing file when collapse: 'file'", () => {
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
    const otherFile = makeL2({
      id: 3,
      name: "src/b.ts",
      path_patterns: JSON.stringify(["src/b.ts"]),
    });
    const containsLink = makeLink({
      id: 1,
      source_node_id: 1,
      target_node_id: 2,
      link_type: "contains",
    });
    const callsLink = makeLink({
      id: 2,
      source_node_id: 2,
      target_node_id: 3,
      link_type: "calls",
    });

    const graph = builder.build(
      {
        workspaceRoot: "/workspace",
        l2Rows: [fileNode, fnNode, otherFile],
        linkRows: [containsLink, callsLink],
        l3Rows: [],
        tagRows: [],
      },
      { collapse: "file" },
    );

    expect(graph.collapsed).toBe(true);
    // Symbol "doThing" is folded away; only the two file nodes remain.
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      ["l2:1", "l2:3"].sort(),
    );
    expect(graph.links).toEqual([
      { source: "l2:1", target: "l2:3", linkType: "calls", confidence: 1 },
    ]);
  });

  it("auto-collapses once the node count exceeds maxNodes", () => {
    const nodes = [makeL2({ id: 1 }), makeL2({ id: 2 })];
    const graph = builder.build(
      {
        workspaceRoot: "/workspace",
        l2Rows: nodes,
        linkRows: [],
        l3Rows: [],
        tagRows: [],
      },
      { maxNodes: 1 },
    );
    expect(graph.collapsed).toBe(true);
  });

  it("drops dangling links whose source/target node no longer exists", () => {
    const fileNode = makeL2({ id: 1 });
    const danglingLink = makeLink({ source_node_id: 1, target_node_id: 999 });

    const graph = builder.build({
      workspaceRoot: "/workspace",
      l2Rows: [fileNode],
      linkRows: [danglingLink],
      l3Rows: [],
      tagRows: [],
    });

    expect(graph.links).toEqual([]);
  });

  it("groups nodes by directory cluster (first two path segments)", () => {
    const a = makeL2({
      id: 1,
      name: "a",
      path_patterns: JSON.stringify(["lib/core/a.ts"]),
    });
    const b = makeL2({
      id: 2,
      name: "b",
      path_patterns: JSON.stringify(["lib/core/b.ts"]),
    });
    const c = makeL2({
      id: 3,
      name: "c",
      path_patterns: JSON.stringify(["root.ts"]),
    });

    const graph = builder.build({
      workspaceRoot: "/workspace",
      l2Rows: [a, b, c],
      linkRows: [],
      l3Rows: [],
      tagRows: [],
    });

    expect(graph.groups).toHaveLength(2);
    const clustered = graph.groups.find((g) => g.label === "lib/core");
    expect(clustered?.count).toBe(2);
  });
});
