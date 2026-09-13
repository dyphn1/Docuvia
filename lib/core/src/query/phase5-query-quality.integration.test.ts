import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GraphStore } from "@workspace/schema";
import { QueryService } from "./query.service.js";

// TDD-SOURCE: lib/contracts/src/interfaces/query.interfaces.ts

describe("Phase 5 QueryService quality evidence", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  let queryService: QueryService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-phase5-query-"));
    store = await GraphStore.open({
      dbPath: path.join(tmpDir, ".docuvia", "local.db"),
    });
    projectId = store.projects.insert({
      name: "phase5-query",
      repoUrl: "file:///phase5-query",
    }).id;
    queryService = new QueryService();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty keywords for punctuation-only input", () => {
    expect(queryService.extractKeywords("!!! ??? :::")).toEqual([]);
  });

  it("produces identical keyword arrays across repeated identical input", () => {
    const input = "show tier c src/auth-service.ts authService";

    const first = queryService.extractKeywords(input);
    const second = queryService.extractKeywords(input);

    expect(second).toEqual(first);
    expect(first).toEqual([
      "tier",
      "c",
      "src/auth-service.ts",
      "authService",
    ]);
  });

  it("returns identical structural context across repeated identical reads", () => {
    const targetId = store.graph.insertNode({
      projectId,
      name: "authService",
      pathPatterns: ["src/auth.ts"],
    });
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
    });
    const calleeId = store.graph.insertNode({
      projectId,
      name: "callee",
      pathPatterns: ["src/callee.ts"],
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: targetId,
      linkType: "calls",
    });
    store.graph.insertLink({
      sourceNodeId: targetId,
      targetNodeId: calleeId,
      linkType: "implements",
    });
    store.files.upsertFile({
      projectId,
      filePath: "src/auth.ts",
      contentHash: null,
    });
    store.files.markTierBProcessed({
      projectId,
      filePath: "src/auth.ts",
      commitSha: "phase5",
    });

    const first = queryService.getContext(store, "authService");
    const second = queryService.getContext(store, "authService");

    expect(second).toEqual(first);
    expect(first).toEqual({
      incoming: [{ name: "caller", linkType: "calls" }],
      outgoing: [{ name: "callee", linkType: "implements" }],
    });
  });

  it("deduplicates overlapping exact and keyword candidates by layer/id", () => {
    const targetId = store.graph.insertNode({
      projectId,
      name: "authService",
      description: "authService authentication entry point",
      pathPatterns: ["src/auth.ts"],
    });

    const results = queryService.search(store, "authService");
    const targetResults = results.filter(
      (result) => result.layer === "l2" && result.id === targetId,
    );

    expect(targetResults).toEqual([
      expect.objectContaining({
        id: targetId,
        title: "authService",
        matchType: "exact",
      }),
    ]);
    expect(
      new Set(results.map((result) => `${result.layer}:${result.id}`)).size,
    ).toBe(results.length);
  });

  it("returns identical ordered search results across repeated identical input", () => {
    store.graph.insertNode({
      projectId,
      name: "authService",
      description: "authentication service",
      pathPatterns: ["src/auth.ts"],
    });
    store.graph.insertNode({
      projectId,
      name: "authController",
      description: "authentication controller",
      pathPatterns: ["src/auth-controller.ts"],
    });
    store.graph.insertNode({
      projectId,
      name: "authMiddleware",
      description: "authentication middleware",
      pathPatterns: ["src/auth-middleware.ts"],
    });

    const first = queryService.search(store, "authentication", 10);
    const second = queryService.search(store, "authentication", 10);

    expect(second).toEqual(first);
    expect(second.map((result) => result.id)).toEqual(
      first.map((result) => result.id),
    );
  });

  it(
    "falls back to a provenance-free L3 entry when its row vanishes after search",
    () => {
      const anchorId = store.graph.insertNode({
        projectId,
        name: "src/auth.ts",
        pathPatterns: ["src/auth.ts"],
      });
      store.l3.upsertDecision({
        projectId,
        l2NodeId: anchorId,
        title: "switched to JWT",
        content: "stateless auth across services",
        nodeType: "decision",
        confidence: 0.9,
        commitSha: "abc1234",
        extractionModel: null,
        sourceFiles: ["src/auth.ts"],
        source: "agent-authored",
      });

      vi.spyOn(store.l3, "getById").mockReturnValue(undefined);

      expect(queryService.query(store, "JWT").l3).toEqual([
        {
          title: "switched to JWT",
          content: "stateless auth across services",
        },
      ]);
    },
  );

  it(
    "returns identical complete query results across repeated identical input",
    () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "authService",
        description: "authentication service",
        pathPatterns: ["src/auth.ts"],
      });
      const callerId = store.graph.insertNode({
        projectId,
        name: "caller",
        pathPatterns: ["src/caller.ts"],
      });
      store.graph.insertLink({
        sourceNodeId: callerId,
        targetNodeId: targetId,
        linkType: "calls",
      });
      store.files.upsertFile({
        projectId,
        filePath: "src/auth.ts",
        contentHash: null,
      });
      store.files.markTierBProcessed({
        projectId,
        filePath: "src/auth.ts",
        commitSha: "phase5",
      });

      const first = queryService.query(store, "authService");
      const second = queryService.query(store, "authService");

      expect(second).toEqual(first);
      expect(first.l2).toEqual({
        name: "authService",
        type: "module",
        filePath: "src/auth.ts",
        matchType: "exact",
      });
      expect(first.context).toEqual({
        incoming: [{ name: "caller", linkType: "calls" }],
        outgoing: [],
      });
    },
  );

  it(
    "handles punctuation-only and whitespace-only queries as empty results without throwing",
    () => {
      expect(queryService.query(store, "   ")).toEqual({
        l2: null,
        l3: [],
        context: null,
      });
      expect(queryService.query(store, "!!!")).toEqual({
        l2: null,
        l3: [],
        context: null,
      });
    },
  );
});
