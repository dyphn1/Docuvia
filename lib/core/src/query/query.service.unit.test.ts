import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GraphStore } from "@workspace/schema";
import { createMockLogger } from "@workspace/contracts";
import { QueryService } from "./query.service.js";

describe("QueryService", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  const queryService = new QueryService();

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-query-service-"));
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    projectId = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    }).id;
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("extractKeywords()", () => {
    it("strips stop words and dedups tokens", () => {
      expect(
        queryService.extractKeywords("what is the authService for"),
      ).toEqual(["authService"]);
    });

    it("keeps identifier-ish tokens (dots/slashes/dashes) intact", () => {
      expect(queryService.extractKeywords("show src/auth-service.ts")).toEqual([
        "src/auth-service.ts",
      ]);
    });
  });

  describe("getContext()", () => {
    it("returns null when the target does not resolve", () => {
      expect(queryService.getContext(store, "nope")).toBeNull();
    });

    it("returns incoming/outgoing structural edges for a resolved node, labeled by their actual relationship", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "authService",
        pathPatterns: ["src/auth.ts"],
      });
      const callerId = store.graph.insertNode({
        projectId,
        name: "caller",
        pathPatterns: ["src/a.ts"],
      });
      const calleeId = store.graph.insertNode({
        projectId,
        name: "callee",
        pathPatterns: ["src/b.ts"],
      });
      store.graph.insertLink({
        sourceNodeId: callerId,
        targetNodeId: targetId,
        linkType: "implements",
      });
      store.graph.insertLink({
        sourceNodeId: targetId,
        targetNodeId: calleeId,
        linkType: "extends",
      });

      expect(queryService.getContext(store, "authService")).toEqual({
        incoming: [{ name: "caller", linkType: "implements" }],
        outgoing: [{ name: "callee", linkType: "extends" }],
      });
    });

    it("excludes contains edges — a symbol's own containing file is not a caller/callee", () => {
      const fileId = store.graph.insertNode({
        projectId,
        name: "src/auth.ts",
        pathPatterns: ["src/auth.ts"],
      });
      const targetId = store.graph.insertNode({
        projectId,
        name: "authService",
        pathPatterns: ["src/auth.ts"],
      });
      store.graph.insertLink({
        sourceNodeId: fileId,
        targetNodeId: targetId,
        linkType: "contains",
      });
      // Registers + marks "src/auth.ts" as Tier B-processed so both directions read as
      // "confirmed zero" rather than "not yet processed" -- this test is about `contains`-edge
      // filtering, not Tier B coverage (see tier-b-coverage.unit.test.ts for that).
      store.files.upsertFile({
        projectId,
        filePath: "src/auth.ts",
        contentHash: null,
      });
      store.files.markTierBProcessed({
        projectId,
        filePath: "src/auth.ts",
        commitSha: "test-sha",
      });

      expect(queryService.getContext(store, "authService")).toEqual({
        incoming: [],
        outgoing: [],
      });
    });

    it("attaches tierBCoverage when the resolved node's own file was never Tier B-processed and workspace coverage is incomplete (typescript-cli-benchmark.md §5.3/§5.7 item 2)", () => {
      store.graph.insertNode({
        projectId,
        name: "authService",
        pathPatterns: ["src/auth.ts"],
      });
      // "src/auth.ts" itself has no project_files row at all (never Tier B-processed), and a
      // second tracked file ("src/other.ts") is registered but also never processed -- so
      // workspace-wide coverage is incomplete too.
      store.files.upsertFile({
        projectId,
        filePath: "src/other.ts",
        contentHash: null,
      });

      expect(queryService.getContext(store, "authService")).toEqual({
        incoming: [],
        outgoing: [],
        tierBCoverage: {
          ownFileLastProcessedAt: null,
          workspaceFilesProcessed: 0,
          workspaceFilesTotal: 1,
        },
      });
    });
  });

  describe("query()", () => {
    it("returns null l2/empty l3/null context when nothing matches", () => {
      expect(queryService.query(store, "nothing-here")).toEqual({
        l2: null,
        l3: [],
        context: null,
      });
    });

    it("resolves an exact node-ref match as the l2 result, plus its structural context", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "authService",
        description: "handles authentication",
        pathPatterns: ["src/auth.ts"],
      });
      const callerId = store.graph.insertNode({
        projectId,
        name: "caller",
        pathPatterns: ["src/a.ts"],
      });
      store.graph.insertLink({
        sourceNodeId: callerId,
        targetNodeId: targetId,
        linkType: "calls",
      });
      // "src/auth.ts" (the target's own file) must be registered + marked Tier B-processed so
      // the empty `outgoing` list below reads as "confirmed zero" rather than "not yet
      // processed" -- this test is about node-ref resolution, not Tier B coverage.
      store.files.upsertFile({
        projectId,
        filePath: "src/auth.ts",
        contentHash: null,
      });
      store.files.markTierBProcessed({
        projectId,
        filePath: "src/auth.ts",
        commitSha: "test-sha",
      });

      const result = queryService.query(store, "authService");

      expect(result.l2).toEqual({
        name: "authService",
        type: "module",
        filePath: "src/auth.ts",
        matchType: "exact",
      });
      expect(result.context).toEqual({
        incoming: [{ name: "caller", linkType: "calls" }],
        outgoing: [],
      });
    });

    it("falls back to context: null instead of throwing when getContext() fails", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "authService",
        description: "handles authentication",
        pathPatterns: ["src/auth.ts"],
      });
      const callerId = store.graph.insertNode({
        projectId,
        name: "caller",
        pathPatterns: ["src/a.ts"],
      });
      store.graph.insertLink({
        sourceNodeId: callerId,
        targetNodeId: targetId,
        linkType: "calls",
      });

      vi.spyOn(queryService, "getContext").mockImplementation(() => {
        throw new Error("boom");
      });

      const result = queryService.query(store, "authService");

      expect(result.l2).toEqual({
        name: "authService",
        type: "module",
        filePath: "src/auth.ts",
        matchType: "exact",
      });
      expect(result.context).toBeNull();
    });
  });

  describe("search() matchType provenance", () => {
    it('tags an exact findNodeByName hit as matchType: "exact"', () => {
      store.graph.insertNode({
        projectId,
        name: "authService",
        pathPatterns: ["src/auth.ts"],
      });

      const results = queryService.search(store, "authService");

      expect(results).toContainEqual(
        expect.objectContaining({ title: "authService", matchType: "exact" }),
      );
    });

    it('tags an FTS-only keyword hit as matchType: "keyword"', () => {
      store.graph.insertNode({
        projectId,
        name: "authService",
        description: "handles authentication",
        pathPatterns: ["src/auth.ts"],
      });

      const results = queryService.search(store, "authentication");

      expect(results).toEqual([
        expect.objectContaining({
          title: "authService",
          matchType: "keyword",
        }),
      ]);
    });

    it('tags a resolved node\'s neighbor as matchType: "neighbor"', () => {
      const hubId = store.graph.insertNode({
        projectId,
        name: "hub",
        pathPatterns: ["src/hub.ts"],
      });
      const spokeId = store.graph.insertNode({
        projectId,
        name: "spoke",
        pathPatterns: ["src/spoke.ts"],
      });
      store.graph.insertLink({
        sourceNodeId: hubId,
        targetNodeId: spokeId,
        linkType: "calls",
      });

      const results = queryService.search(store, "hub");

      expect(results).toContainEqual(
        expect.objectContaining({ title: "spoke", matchType: "neighbor" }),
      );
    });
  });

  describe("search() limit validation", () => {
    // Regression test for a real bug: an invalid `limit` used to produce two different, silently
    // wrong behaviors in the same call — the FTS path binds it straight into SQL `LIMIT ?`, where
    // SQLite treats a negative value as "unlimited", while the neighbor path used
    // `Array.prototype.slice(0, limit)`, where a negative value truncates from the end instead.
    function seedHubWithNeighbors(count: number): void {
      const targetId = store.graph.insertNode({
        projectId,
        name: "hub",
        pathPatterns: ["src/hub.ts"],
      });
      for (let i = 0; i < count; i++) {
        const neighborId = store.graph.insertNode({
          projectId,
          name: `neighbor-${i}`,
          pathPatterns: [`src/n${i}.ts`],
        });
        store.graph.insertLink({
          sourceNodeId: targetId,
          targetNodeId: neighborId,
          linkType: "calls",
        });
      }
    }

    it.each([-5, NaN, 2.5, 0])(
      "treats an invalid limit (%p) the same as the default (10) instead of silently misbehaving",
      (invalidLimit) => {
        seedHubWithNeighbors(15);

        const defaultResult = queryService.search(store, "hub", 10);
        const invalidResult = queryService.search(store, "hub", invalidLimit);

        expect(invalidResult).toEqual(defaultResult);
      },
    );

    it("logs a warning when falling back from an invalid limit", () => {
      seedHubWithNeighbors(3);
      const logger = createMockLogger();
      const loggedService = new QueryService(logger);

      loggedService.search(store, "hub", -1);

      expect(logger.events).toContainEqual(
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining("Ignoring invalid query limit"),
          context: expect.objectContaining({ invalidLimit: -1, fallback: 10 }),
        }),
      );
    });
  });
});
