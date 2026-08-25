import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphPersisterService } from "../../src/graph/persist-ast-graph.js";

describe("GraphPersisterService", () => {
  let store: any;
  let persister: GraphPersisterService;

  beforeEach(() => {
    store = {
      withWriteLock: vi.fn().mockImplementation((fn: any) => fn()),
      withTransaction: vi.fn().mockImplementation((fn: any) => fn()),
      tags: {
        upsertTag: vi.fn(),
        getIdByName: vi.fn().mockReturnValue(99),
        linkNodeToTag: vi.fn(),
      },
      graph: {
        deleteNodesForPath: vi.fn(),
        getSemanticCoverage: vi.fn(),
        insertNode: vi.fn().mockReturnValue(1),
        insertLink: vi.fn(),
        findNodeIdByName: vi.fn(),
        findNodeByName: vi.fn(),
        withFtsSyncSuspended: vi.fn().mockImplementation((fn: any) => fn()),
      },
      files: { upsertFile: vi.fn() },
      // Issue #11 plan A, Slice 3: persistFileAndSymbolNodes' delete-then-reinsert step for
      // ast_call_sites now runs alongside deleteNodesForPath for every persisted file.
      callSites: {
        deleteForFile: vi.fn(),
        insertMany: vi.fn(),
        getForFiles: vi.fn().mockReturnValue(new Map()),
        getByTargetFunctions: vi.fn().mockReturnValue(new Map()),
      },
    };
    persister = new GraphPersisterService();
  });

  it("persists parsed results correctly", async () => {
    let idCounter = 1;
    store.graph.insertNode.mockImplementation(() => idCounter++);

    // To hit branch 506-510, we need findNodeIdByName to be called and hit the DB fallback
    // meaning the target file is not in fileIdMap (from previous batch)
    store.graph.findNodeIdByName.mockImplementation(
      (file: string, name: string) => {
        if (file === "prevBatch.ts") return 999;
        return undefined;
      },
    );

    const parsedResults = [
      {
        file: "index.ts",
        hash: "hash1",
        data: {
          functions: [{ name: "myFunc", contentHash: "hash2" }],
          classes: [{ name: "MyClass", contentHash: "hash3" }],
          imports: [
            { source: "./util.ts", default: "util", named: [] },
            { source: "./prevBatch.ts", default: "prevBatch", named: [] },
          ],
          calls: [
            { sourceFunction: "myFunc", targetFunction: "util" },
            { sourceFunction: "myFunc", targetFunction: "prevBatch" },
            { sourceFunction: undefined, targetFunction: "util" }, // Top level call
          ],
          implements: [{ sourceClass: "MyClass", targetInterface: "util" }],
          extends: [{ sourceClass: "MyClass", targetClass: "util" }],
        },
      },
      {
        file: "util.ts",
        hash: "hash4",
        data: {
          functions: [],
          classes: [],
          imports: [],
          calls: [],
          implements: [],
          extends: [],
        },
      },
    ];

    const res = await persister.persist({
      store,
      workspaceRoot: "/root",
      projectId: 1,
      parsedResults: parsedResults as any,
      tags: ["tag1", "tag2"],
    });

    expect(res.updatedCount).toBe(2);
    expect(store.tags.upsertTag).toHaveBeenCalledWith("tag1");
    expect(store.graph.deleteNodesForPath).toHaveBeenCalledWith("index.ts");
    expect(store.graph.insertNode).toHaveBeenCalled();
    expect(store.graph.insertLink).toHaveBeenCalled();
    expect(store.files.upsertFile).toHaveBeenCalled();
  });

  it("handles missing data arrays safely", async () => {
    const parsedResults = [
      {
        file: "index.ts",
        hash: "hash1",
        data: {}, // Everything missing
      },
    ];
    const res = await persister.persist({
      store,
      workspaceRoot: "/root",
      projectId: 1,
      parsedResults: parsedResults as any,
      tags: [],
    });
    expect(res.updatedCount).toBe(1);
  });
});
