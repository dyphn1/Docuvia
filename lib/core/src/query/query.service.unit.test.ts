import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GraphStore } from "@workspace/schema";
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

    it("returns incoming/outgoing structural edges for a resolved node", () => {
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
        linkType: "calls",
      });
      store.graph.insertLink({
        sourceNodeId: targetId,
        targetNodeId: calleeId,
        linkType: "calls",
      });

      expect(queryService.getContext(store, "authService")).toEqual({
        incoming: [{ name: "caller", type: "module" }],
        outgoing: [{ name: "callee", type: "module" }],
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

      const result = queryService.query(store, "authService");

      expect(result.l2).toEqual({ name: "authService" });
      expect(result.context).toEqual({
        incoming: [{ name: "caller", type: "module" }],
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

      expect(result.l2).toEqual({ name: "authService" });
      expect(result.context).toBeNull();
    });
  });
});
