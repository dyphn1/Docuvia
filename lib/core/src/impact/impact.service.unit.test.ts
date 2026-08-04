import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RiskLevels } from "@workspace/contracts";
import fs from "fs";
import os from "os";
import path from "path";
import { GraphStore } from "@workspace/schema";
import {
  ImpactService,
  IMPACT_RISK_THRESHOLDS,
  IMPACT_RISK_REFERENCE_NODE_COUNT,
  computeRiskLevelFromCounts,
} from "./impact.service.js";

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
      expect(impactService.computeRiskLevel(store, 0)).toBe(RiskLevels.LOW);
    });

    it("returns MEDIUM below the HIGH threshold", () => {
      expect(impactService.computeRiskLevel(store, 1)).toBe(RiskLevels.MEDIUM);
      expect(
        impactService.computeRiskLevel(
          store,
          IMPACT_RISK_THRESHOLDS.HIGH_MIN - 1,
        ),
      ).toBe(RiskLevels.MEDIUM);
    });

    it("returns HIGH at/above the HIGH threshold, below CRITICAL", () => {
      expect(
        impactService.computeRiskLevel(store, IMPACT_RISK_THRESHOLDS.HIGH_MIN),
      ).toBe(RiskLevels.HIGH);
      expect(
        impactService.computeRiskLevel(
          store,
          IMPACT_RISK_THRESHOLDS.CRITICAL_MIN - 1,
        ),
      ).toBe(RiskLevels.HIGH);
    });

    it("returns CRITICAL at/above the CRITICAL threshold", () => {
      expect(
        impactService.computeRiskLevel(
          store,
          IMPACT_RISK_THRESHOLDS.CRITICAL_MIN,
        ),
      ).toBe(RiskLevels.CRITICAL);
    });

    it("reads store.graph.count().l2Nodes and threads it into the scaled formula (above-reference branch)", () => {
      // 292_710 is vscode's own real measured l2_nodes count (typescript-cli-benchmark.md) --
      // its exact CRITICAL_MIN boundary (Math.round(21 * sqrt(292710/16000)) === 90) is the same
      // "89 -> HIGH / 90 -> CRITICAL" data point asserted directly against
      // computeRiskLevelFromCounts() below; kept identical here so this test's only remaining job
      // is confirming ImpactService.computeRiskLevel() actually reads store.graph.count().l2Nodes
      // and threads it through, not re-deriving a second boundary value.
      vi.spyOn(store.graph, "count").mockReturnValue({
        l2Nodes: 292_710,
        l3Nodes: 0,
      });

      expect(impactService.computeRiskLevel(store, 89)).toBe(RiskLevels.HIGH);
      expect(impactService.computeRiskLevel(store, 90)).toBe(
        RiskLevels.CRITICAL,
      );
    });
  });

  describe("computeRiskLevelFromCounts()", () => {
    it("reproduces the exact legacy boundaries at/below the reference node count", () => {
      for (const totalNodeCount of [0, 100, IMPACT_RISK_REFERENCE_NODE_COUNT]) {
        expect(computeRiskLevelFromCounts(0, totalNodeCount)).toBe(
          RiskLevels.LOW,
        );
        expect(computeRiskLevelFromCounts(1, totalNodeCount)).toBe(
          RiskLevels.MEDIUM,
        );
        expect(computeRiskLevelFromCounts(5, totalNodeCount)).toBe(
          RiskLevels.MEDIUM,
        );
        expect(computeRiskLevelFromCounts(6, totalNodeCount)).toBe(
          RiskLevels.HIGH,
        );
        expect(computeRiskLevelFromCounts(20, totalNodeCount)).toBe(
          RiskLevels.HIGH,
        );
        expect(computeRiskLevelFromCounts(21, totalNodeCount)).toBe(
          RiskLevels.CRITICAL,
        );
      }
    });

    it("matches nest's exact real measured data point (Injectable, 9/16,159 -> HIGH)", () => {
      expect(computeRiskLevelFromCounts(9, 16_159)).toBe(RiskLevels.HIGH);
      expect(computeRiskLevelFromCounts(20, 16_159)).toBe(RiskLevels.HIGH);
      expect(computeRiskLevelFromCounts(21, 16_159)).toBe(RiskLevels.CRITICAL);
    });

    it("matches vscode's exact real measured data point (Disposable, 2,366/292,710 -> CRITICAL)", () => {
      expect(computeRiskLevelFromCounts(2_366, 292_710)).toBe(
        RiskLevels.CRITICAL,
      );
    });

    it("meaningfully changes vscode-scale classification for counts that were unconditionally CRITICAL before (21-89)", () => {
      expect(computeRiskLevelFromCounts(25, 292_710)).toBe(RiskLevels.MEDIUM);
      expect(computeRiskLevelFromCounts(60, 292_710)).toBe(RiskLevels.HIGH);
      expect(computeRiskLevelFromCounts(89, 292_710)).toBe(RiskLevels.HIGH);
      expect(computeRiskLevelFromCounts(90, 292_710)).toBe(RiskLevels.CRITICAL);
    });

    it("never decreases the effective HIGH/CRITICAL thresholds as totalNodeCount grows (monotonicity)", () => {
      const totalNodeCounts = [16_000, 64_000, 256_000, 1_024_000];
      let previousHighMin = -Infinity;
      let previousCriticalMin = -Infinity;

      for (const totalNodeCount of totalNodeCounts) {
        // Binary-search-free boundary probe: walk impactedCount up until the label changes.
        let highMin = -1;
        let criticalMin = -1;
        for (let impactedCount = 1; impactedCount <= 10_000; impactedCount++) {
          const level = computeRiskLevelFromCounts(
            impactedCount,
            totalNodeCount,
          );
          if (highMin === -1 && level === RiskLevels.HIGH) {
            highMin = impactedCount;
          }
          if (level === RiskLevels.CRITICAL) {
            criticalMin = impactedCount;
            break;
          }
        }

        expect(highMin).toBeGreaterThanOrEqual(previousHighMin);
        expect(criticalMin).toBeGreaterThanOrEqual(previousCriticalMin);
        previousHighMin = highMin;
        previousCriticalMin = criticalMin;
      }
    });

    it("does not divide by zero or propagate NaN for a freshly-init'd, not-yet-ingested graph (totalNodeCount 0)", () => {
      expect(computeRiskLevelFromCounts(0, 0)).toBe(RiskLevels.LOW);
      expect(computeRiskLevelFromCounts(6, 0)).toBe(RiskLevels.HIGH);
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
