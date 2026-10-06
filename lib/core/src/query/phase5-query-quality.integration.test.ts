import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GraphStore } from "@workspace/schema";
import { QueryService } from "./query.service.js";

// TDD-SOURCE: lib/contracts/src/interfaces/query.interfaces.ts

describe("Phase 5 QueryService quality evidence", () => {
  const unknownCallResolution = {
    callSiteKey: null,
    resolutionClass: "unknown",
    verificationStatus: "unknown",
    selectedTargetNodeKey: null,
    isStale: false,
    alternatives: [],
    candidates: [],
  };
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

    expect(second).toStrictEqual(first);
    // GRPH-008 Phase 5 adds explicit unknown certainty to aggregate calls edges with no
    // per-site record. The negative test below pins that the original graph edge stays present.
    expect(first).toStrictEqual({
      incoming: [
        {
          name: "caller",
          linkType: "calls",
          callResolutions: [unknownCallResolution],
        },
      ],
      outgoing: [{ name: "callee", linkType: "implements" }],
    });
  });

  it("[negative] preserves an aggregate calls edge when per-site certainty is unavailable", () => {
    const targetId = store.graph.insertNode({
      projectId,
      name: "aggregateTarget",
      pathPatterns: ["src/aggregate-target.ts"],
    });
    const callerId = store.graph.insertNode({
      projectId,
      name: "aggregateCaller",
      pathPatterns: ["src/aggregate-caller.ts"],
    });
    store.files.upsertFile({
      projectId,
      filePath: "src/aggregate-target.ts",
      contentHash: null,
    });
    store.files.markTierBProcessed({
      projectId,
      filePath: "src/aggregate-target.ts",
      commitSha: "phase5-aggregate",
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: targetId,
      linkType: "calls",
    });

    expect(queryService.getContext(store, "aggregateTarget")).toStrictEqual({
      incoming: [
        {
          name: "aggregateCaller",
          linkType: "calls",
          callResolutions: [unknownCallResolution],
        },
      ],
      outgoing: [],
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
    "[error-handling] falls back to a provenance-free L3 entry when its row vanishes after search",
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
    "[happy] returns identical complete query results across repeated identical input",
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

      expect(second).toStrictEqual(first);
      expect(first.l2).toEqual({
        name: "authService",
        type: "module",
        filePath: "src/auth.ts",
        matchType: "exact",
      });
      // Phase 5 makes the aggregate call edge's missing per-site certainty explicit as unknown.
      expect(first.context).toStrictEqual({
        incoming: [
          {
            name: "caller",
            linkType: "calls",
            callResolutions: [unknownCallResolution],
          },
        ],
        outgoing: [],
      });
    },
  );

  it(
    "[invalid-input] handles punctuation-only and whitespace-only queries as empty results without throwing",
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

  it("[state-diff] reflects a newly persisted caller edge in structural context", () => {
    const targetId = store.graph.insertNode({
      projectId,
      name: "statefulAuthService",
      pathPatterns: ["src/stateful-auth.ts"],
    });
    store.files.upsertFile({
      projectId,
      filePath: "src/stateful-auth.ts",
      contentHash: null,
    });
    store.files.markTierBProcessed({
      projectId,
      filePath: "src/stateful-auth.ts",
      commitSha: "phase5-state-before",
    });

    expect(queryService.getContext(store, "statefulAuthService")).toStrictEqual({
      incoming: [],
      outgoing: [],
    });

    const callerId = store.graph.insertNode({
      projectId,
      name: "statefulCaller",
      pathPatterns: ["src/stateful-caller.ts"],
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: targetId,
      linkType: "calls",
    });

    expect(queryService.getContext(store, "statefulAuthService")).toStrictEqual({
      incoming: [
        {
          name: "statefulCaller",
          linkType: "calls",
          callResolutions: [unknownCallResolution],
        },
      ],
      outgoing: [],
    });
  });

  it("[stress] bounds 250 matching nodes to 25 unique deterministic search results", () => {
    for (let index = 0; index < 250; index++) {
      store.graph.insertNode({
        projectId,
        name: `stressAuthService${index.toString().padStart(3, "0")}`,
        description: "shared authentication stress candidate",
        pathPatterns: [`src/stress-auth-${index}.ts`],
      });
    }

    const first = queryService.search(store, "authentication", 25);
    const second = queryService.search(store, "authentication", 25);

    expect(second).toEqual(first);
    expect(first).toHaveLength(25);
    expect(new Set(first.map((result) => result.id)).size).toBe(25);
    expect(
      first.every((result) => result.title.startsWith("stressAuthService")),
    ).toBe(true);
  });
});
