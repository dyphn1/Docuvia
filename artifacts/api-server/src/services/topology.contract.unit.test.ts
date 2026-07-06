import { describe, it, expect } from "vitest";
import { buildTopologyGraph } from "@workspace/core";
import { GetProjectTopologyResponse } from "@workspace/api-zod";

/**
 * Contract test: the shared topology builder's output must satisfy the Zod
 * response schema Orval generates from openapi.yaml. Guards against the
 * lib/core types and the OpenAPI contract drifting apart — no DB required.
 */
describe("topology contract (builder output vs generated Zod schema)", () => {
  it("a representative graph (files, symbols, decisions, tags, all link types) parses", () => {
    const graph = buildTopologyGraph(
      {
        workspaceRoot: "https://example.com/repo.git",
        l2Rows: [
          { id: 1, name: "src/a.ts", filePath: "src/a.ts" },
          { id: 2, name: "funcA", filePath: "src/a.ts" },
          { id: 3, name: "src/b.ts", filePath: "src/b.ts" },
          { id: 4, name: "ClassB", filePath: "src/b.ts" },
        ],
        linkRows: [
          { sourceNodeId: 1, targetNodeId: 2, linkType: "contains" },
          { sourceNodeId: 3, targetNodeId: 4, linkType: "contains" },
          { sourceNodeId: 2, targetNodeId: 4, linkType: "calls" },
          { sourceNodeId: 4, targetNodeId: 2, linkType: "implements" },
        ],
        l3Rows: [{ id: 7, l2NodeId: 1, title: "Use WAL journal mode" }],
        tagRows: [{ l2NodeId: 1, name: "typescript" }],
      },
      {}
    );

    const parsed = GetProjectTopologyResponse.safeParse(graph);
    expect(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues)).toBe(true);
  });

  it("a collapsed and an empty graph both parse", () => {
    const collapsed = buildTopologyGraph(
      {
        workspaceRoot: "repo",
        l2Rows: [
          { id: 1, name: "src/a.ts", filePath: "src/a.ts" },
          { id: 2, name: "funcA", filePath: "src/a.ts" },
        ],
        linkRows: [{ sourceNodeId: 1, targetNodeId: 2, linkType: "contains" }],
        l3Rows: [],
        tagRows: [],
      },
      { collapse: "file" }
    );
    expect(GetProjectTopologyResponse.safeParse(collapsed).success).toBe(true);

    const empty = buildTopologyGraph(
      { workspaceRoot: "repo", l2Rows: [], linkRows: [], l3Rows: [], tagRows: [] },
      {}
    );
    expect(GetProjectTopologyResponse.safeParse(empty).success).toBe(true);
  });
});
