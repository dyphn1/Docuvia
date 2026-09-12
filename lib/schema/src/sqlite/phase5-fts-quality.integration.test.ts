import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GraphStore } from "./graph-store.js";

// TDD-SOURCE: lib/contracts/src/interfaces/graph-store.interfaces.ts#IFtsRepo

describe("Phase 5 SQLite FTS retrieval quality evidence", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-phase5-fts-"));
    store = await GraphStore.open({
      dbPath: path.join(tmpDir, ".docuvia", "local.db"),
    });
    projectId = store.projects.insert({
      name: "phase5-fts",
      repoUrl: "file:///phase5-fts",
    }).id;
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("neutralizes FTS operator-like and quote-only input instead of treating it as query syntax", () => {
    const nodeId = store.graph.insertNode({
      projectId,
      name: "operatorLiteral",
      description: "OR auth operator literal",
      pathPatterns: ["src/operator.ts"],
    });

    expect(store.fts.searchL2Nodes(["OR"], 10).map((row) => row.id)).toEqual([
      nodeId,
    ]);
    expect(store.fts.searchL2Nodes(['"'], 10)).toEqual([]);
    expect(() => store.fts.searchL2Nodes(["auth*"], 10)).not.toThrow();
    expect(() => store.fts.searchL2Nodes(["auth OR operator"], 10)).not.toThrow();
  });

  it("returns the complete mapped L2 row contract rather than the FTS virtual-table shape", () => {
    const nodeId = store.graph.insertNode({
      projectId,
      name: "authService",
      description: "authentication service",
      pathPatterns: ["src/auth.ts"],
      nodeKey: "src/auth.ts#authService",
    });

    const [row] = store.fts.searchL2Nodes(["authentication"], 10);

    expect(row).toMatchObject({
      id: nodeId,
      project_id: projectId,
      name: "authService",
      type: "module",
      description: "authentication service",
      path_patterns: JSON.stringify(["src/auth.ts"]),
      node_key: "src/auth.ts#authService",
    });
    expect(row).toEqual(
      expect.objectContaining({
        is_system: expect.any(Number),
        ai_generated: expect.any(Number),
        needs_review: expect.any(Number),
        created_at: expect.any(String),
        updated_at: expect.any(String),
      }),
    );
  });

  it("returns identical ranked L2 order across repeated identical searches", () => {
    for (const name of ["alphaAuth", "betaAuth", "gammaAuth"]) {
      store.graph.insertNode({
        projectId,
        name,
        description: "shared authentication token",
        pathPatterns: [`src/${name}.ts`],
      });
    }

    const first = store.fts
      .searchL2Nodes(["authentication"], 10)
      .map((row) => row.id);
    const second = store.fts
      .searchL2Nodes(["authentication"], 10)
      .map((row) => row.id);

    expect(second).toEqual(first);
    expect(first).toHaveLength(3);
  });

  it("returns identical ranked L3 order across repeated identical searches", () => {
    const anchorId = store.graph.insertNode({
      projectId,
      name: "src/auth.ts",
      pathPatterns: ["src/auth.ts"],
    });
    for (const title of ["JWT decision A", "JWT decision B", "JWT decision C"]) {
      store.l3.upsertDecision({
        projectId,
        l2NodeId: anchorId,
        title,
        content: "shared JWT authentication decision",
        nodeType: "decision",
        confidence: 0.9,
        commitSha: "phase5",
        extractionModel: null,
        sourceFiles: ["src/auth.ts"],
      });
    }

    const first = store.fts.searchL3Nodes(["JWT"], 10).map((row) => row.id);
    const second = store.fts.searchL3Nodes(["JWT"], 10).map((row) => row.id);

    expect(second).toEqual(first);
    expect(first).toHaveLength(3);
  });
});
