import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RiskLevels } from "@workspace/contracts";
import fs from "fs";
import os from "os";
import path from "path";
import { GraphStore } from "@workspace/schema";
import { ImpactService, IMPACT_RISK_THRESHOLDS } from "./impact.service.js";

/**
 * Uses a real temp `GraphStore` (test-only — see `persist-ast-graph.unit.test.ts`'s doc comment
 * for why this codebase prefers real repo behavior over hand-mocked `IGraphStore` surfaces here).
 */
describe("ImpactService", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  const impactService = new ImpactService();

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-impact-service-"));
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

  describe("computeRiskLevel()", () => {
    it("returns LOW for zero impacted nodes", () => {
      expect(impactService.computeRiskLevel(0)).toBe(RiskLevels.LOW);
    });

    it("returns MEDIUM below the HIGH threshold", () => {
      expect(impactService.computeRiskLevel(1)).toBe(RiskLevels.MEDIUM);
      expect(
        impactService.computeRiskLevel(IMPACT_RISK_THRESHOLDS.HIGH_MIN - 1),
      ).toBe(RiskLevels.MEDIUM);
    });

    it("returns HIGH at/above the HIGH threshold, below CRITICAL", () => {
      expect(
        impactService.computeRiskLevel(IMPACT_RISK_THRESHOLDS.HIGH_MIN),
      ).toBe(RiskLevels.HIGH);
      expect(
        impactService.computeRiskLevel(IMPACT_RISK_THRESHOLDS.CRITICAL_MIN - 1),
      ).toBe(RiskLevels.HIGH);
    });

    it("returns CRITICAL at/above the CRITICAL threshold", () => {
      expect(
        impactService.computeRiskLevel(IMPACT_RISK_THRESHOLDS.CRITICAL_MIN),
      ).toBe(RiskLevels.CRITICAL);
    });
  });

  describe("getBlastRadius()", () => {
    it("returns undefined when the target does not resolve to any node", () => {
      expect(impactService.getBlastRadius(store, "nope")).toBeUndefined();
    });

    it("returns the 1-hop set of nodes that depend on the resolved target", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "sharedUtil",
        pathPatterns: ["src/util.ts"],
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

      expect(impactService.getBlastRadius(store, "sharedUtil")).toEqual([
        { name: "caller", type: "module" },
      ]);
    });

    it("attaches L3 'why' data to a blast-radius entry when its node has l3 rows", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "sharedUtil",
        pathPatterns: ["src/util.ts"],
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
      store.l3.upsertDecision({
        projectId,
        l2NodeId: callerId,
        title: "why caller exists",
        content: "because reasons",
        nodeType: "decision",
        confidence: 0.9,
        commitSha: null,
        extractionModel: null,
        sourceFiles: [],
      });

      expect(impactService.getBlastRadius(store, "sharedUtil")).toEqual([
        {
          name: "caller",
          type: "module",
          why: [{ title: "why caller exists", content: "because reasons" }],
        },
      ]);
    });

    it("resolves the target via LIKE fallback when there is no exact name match", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "src/util/sharedUtil.ts",
        pathPatterns: ["src/util/sharedUtil.ts"],
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

      expect(impactService.getBlastRadius(store, "sharedUtil")).toEqual([
        { name: "caller", type: "module" },
      ]);
    });
  });
});
