import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RiskLevels,
  CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX,
  CallsProjectionCallerPolicies,
  LinkTypes,
  SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX,
  SnapshotCallSiteAvailabilityStates,
} from "@workspace/contracts";
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
    it("[performance] avoids loading every project resolution for a call edge", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "target",
        pathPatterns: ["src/target.ts"],
      });
      const callerId = store.graph.insertNode({
        projectId,
        name: "caller",
        pathPatterns: ["src/caller.ts"],
      });
      store.graph.insertLink({
        sourceNodeId: callerId,
        targetNodeId: targetId,
        linkType: LinkTypes.CALLS,
      });
      const getAllForProject = vi.spyOn(
        store.callSiteResolutions!,
        "getAllForProject",
      );

      expect(impactService.getBlastRadius(store, "target")).toEqual([
        { name: "caller", type: "module" },
      ]);
      expect(getAllForProject).not.toHaveBeenCalled();
    });

    it("returns undefined when the target does not resolve to any node", () => {
      const result = impactService.getBlastRadius(store, "nope");
      expect(result).toBeUndefined();
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

      const result = impactService.getBlastRadius(store, "sharedUtil");
      expect(result).toEqual([{ name: "caller", type: "module" }]);
    });

    it("orders blast-radius entries stably instead of by SQLite row id", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "stableTarget",
        pathPatterns: ["src/target.ts"],
      });
      const laterCallerId = store.graph.insertNode({
        projectId,
        name: "zCaller",
        pathPatterns: ["src/z.ts"],
      });
      const earlierCallerId = store.graph.insertNode({
        projectId,
        name: "aCaller",
        pathPatterns: ["src/a.ts"],
      });
      for (const sourceNodeId of [laterCallerId, earlierCallerId])
        store.graph.insertLink({
          sourceNodeId,
          targetNodeId: targetId,
          linkType: LinkTypes.CALLS,
        });

      expect(
        impactService
          .getBlastRadius(store, "stableTarget")
          ?.map(({ name }) => name),
      ).toEqual(["aCaller", "zCaller"]);
    });

    it("[happy][state-diff] expands exact callback callers to their enclosing function, callers, and files", () => {
      const insertNode = (name: string, nodeKey: string): number =>
        store.graph.insertNode({
          projectId,
          name,
          type: "module",
          pathPatterns: [nodeKey.split("#")[0]!],
          nodeKey,
        });
      const targetFile = insertNode("src/target.ts", "src/target.ts");
      const callerFile = insertNode("src/caller.ts", "src/caller.ts");
      const consumerFile = insertNode("src/consumer.ts", "src/consumer.ts");
      const target = insertNode("target", "src/target.ts#target");
      const outer = insertNode("outer", "src/caller.ts#outer");
      const callback = insertNode("anonymous", "src/caller.ts#anonymous@L4");
      const outerCaller = insertNode(
        "invokeOuter",
        "src/consumer.ts#invokeOuter",
      );

      store.graph.insertLink({
        sourceNodeId: targetFile,
        targetNodeId: target,
        linkType: "contains",
      });
      store.graph.insertLink({
        sourceNodeId: callerFile,
        targetNodeId: outer,
        linkType: "contains",
      });
      store.graph.insertLink({
        sourceNodeId: callerFile,
        targetNodeId: callback,
        linkType: "contains",
      });
      store.graph.insertLink({
        sourceNodeId: outer,
        targetNodeId: callback,
        linkType: LinkTypes.LEXICAL_PARENT,
      });
      store.graph.insertLink({
        sourceNodeId: callback,
        targetNodeId: target,
        linkType: "calls",
      });
      store.graph.insertLink({
        sourceNodeId: consumerFile,
        targetNodeId: outerCaller,
        linkType: "contains",
      });
      store.graph.insertLink({
        sourceNodeId: outerCaller,
        targetNodeId: outer,
        linkType: "calls",
      });
      store.meta.set(
        `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
        CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
      );

      const result = impactService.getBlastRadius(store, "target");
      const impactedNames = result?.map(({ name }) => name) ?? [];

      expect(impactedNames).toEqual(
        expect.arrayContaining([
          "anonymous",
          "outer",
          "invokeOuter",
          "src/caller.ts",
          "src/consumer.ts",
        ]),
      );
    });

    it("[regression][exact-v2] includes method and class context but stops at the class owner", () => {
      const insertNode = (name: string, nodeKey: string): number =>
        store.graph.insertNode({
          projectId,
          name,
          type: "module",
          pathPatterns: [nodeKey.split("#")[0]!],
          nodeKey,
        });
      const targetFile = insertNode("src/target.ts", "src/target.ts");
      const ownerFile = insertNode("src/owner.ts", "src/owner.ts");
      const consumerFile = insertNode("src/consumer.ts", "src/consumer.ts");
      const target = insertNode("target", "src/target.ts#target");
      const owner = insertNode("Owner", "src/owner.ts#Owner");
      const fieldCallback = insertNode(
        "fieldCallback",
        "src/owner.ts#Owner.field@L2",
      );
      const method = insertNode("method", "src/owner.ts#Owner.method");
      const methodCallback = insertNode(
        "methodCallback",
        "src/owner.ts#Owner.method@L5",
      );
      const consumer = insertNode("instantiateOwner", "src/consumer.ts#use");

      for (const [fileId, symbolId] of [
        [targetFile, target],
        [ownerFile, owner],
        [ownerFile, fieldCallback],
        [ownerFile, method],
        [ownerFile, methodCallback],
        [consumerFile, consumer],
      ]) {
        store.graph.insertLink({
          sourceNodeId: fileId!,
          targetNodeId: symbolId!,
          linkType: LinkTypes.CONTAINS,
        });
      }
      store.graph.insertLink({
        sourceNodeId: owner,
        targetNodeId: fieldCallback,
        linkType: LinkTypes.LEXICAL_OWNER,
      });
      store.graph.insertLink({
        sourceNodeId: owner,
        targetNodeId: method,
        linkType: LinkTypes.LEXICAL_OWNER,
      });
      store.graph.insertLink({
        sourceNodeId: method,
        targetNodeId: methodCallback,
        linkType: LinkTypes.LEXICAL_PARENT,
      });
      for (const caller of [fieldCallback, methodCallback]) {
        store.graph.insertLink({
          sourceNodeId: caller,
          targetNodeId: target,
          linkType: LinkTypes.CALLS,
        });
      }
      store.graph.insertLink({
        sourceNodeId: consumer,
        targetNodeId: owner,
        linkType: LinkTypes.CALLS,
      });
      store.meta.set(
        `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
        CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
      );

      const names = impactService
        .getBlastRadius(store, "target")
        ?.map(({ name }) => name);

      expect(names).toEqual(
        expect.arrayContaining([
          "fieldCallback",
          "methodCallback",
          "method",
          "Owner",
        ]),
      );
      expect(names).not.toContain("instantiateOwner");
      expect(names).not.toContain("src/consumer.ts");
    });

    it("returns multiple callers for a widely-used symbol", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "logger",
        pathPatterns: ["src/logger.ts"],
      });
      const callerA = store.graph.insertNode({
        projectId,
        name: "authService",
        pathPatterns: ["src/auth.ts"],
      });
      const callerB = store.graph.insertNode({
        projectId,
        name: "userService",
        pathPatterns: ["src/user.ts"],
      });
      const callerC = store.graph.insertNode({
        projectId,
        name: "paymentService",
        pathPatterns: ["src/payment.ts"],
      });
      store.graph.insertLink({
        sourceNodeId: callerA,
        targetNodeId: targetId,
        linkType: "calls",
      });
      store.graph.insertLink({
        sourceNodeId: callerB,
        targetNodeId: targetId,
        linkType: "calls",
      });
      store.graph.insertLink({
        sourceNodeId: callerC,
        targetNodeId: targetId,
        linkType: "calls",
      });

      const result = impactService.getBlastRadius(store, "logger");
      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          { name: "authService", type: "module" },
          { name: "userService", type: "module" },
          { name: "paymentService", type: "module" },
        ]),
      );
    });

    it("includes callers from different edge types (calls, extends, implements)", () => {
      const targetId = store.graph.insertNode({
        projectId,
        name: "BaseController",
        pathPatterns: ["src/base.ts"],
      });
      const callerId = store.graph.insertNode({
        projectId,
        name: "authService",
        pathPatterns: ["src/auth.ts"],
      });
      const extenderId = store.graph.insertNode({
        projectId,
        name: "AdminController",
        pathPatterns: ["src/admin.ts"],
      });
      const implementerId = store.graph.insertNode({
        projectId,
        name: "ApiController",
        pathPatterns: ["src/api.ts"],
      });
      store.graph.insertLink({
        sourceNodeId: callerId,
        targetNodeId: targetId,
        linkType: "calls",
      });
      store.graph.insertLink({
        sourceNodeId: extenderId,
        targetNodeId: targetId,
        linkType: "extends",
      });
      store.graph.insertLink({
        sourceNodeId: implementerId,
        targetNodeId: targetId,
        linkType: "implements",
      });

      const result = impactService.getBlastRadius(store, "BaseController");
      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          { name: "authService", type: "module" },
          { name: "AdminController", type: "module" },
          { name: "ApiController", type: "module" },
        ]),
      );
    });

    it("returns an empty array when the node exists but has no incoming edges", () => {
      store.graph.insertNode({
        projectId,
        name: "isolated",
        pathPatterns: ["src/isolated.ts"],
      });

      const result = impactService.getBlastRadius(store, "isolated");
      expect(result).toEqual([]);
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

    // Issue #217: when no real caller edge exists (the only incoming link is the trivial
    // self-file `contains`, or nothing at all), the blast radius falls back to a reverse read
    // of `ast_call_sites` -- call sites whose ScopeResolver resolution failed produce no
    // `node_links` edge but DO have a row here, so dynamic-loading dependents stop being
    // invisible. Such entries are labeled `edgeSource: "lsp-fallback"` so downstream can tell
    // them apart from confirmed static edges.
    describe("ast_call_sites fallback (issue #217)", () => {
      it("appends lsp-fallback entries from reverse-read call sites when no static caller edge exists", () => {
        store.graph.insertNode({
          projectId,
          name: "loadPlugin",
          pathPatterns: ["src/plugin.ts"],
        });
        store.graph.insertNode({
          projectId,
          name: "src/host.ts",
          pathPatterns: ["src/host.ts"],
        });
        store.callSites.insertMany(projectId, "src/host.ts", [
          { targetFunction: "loadPlugin", startLine: 10, startColumn: 2 },
        ]);

        expect(impactService.getBlastRadius(store, "loadPlugin")).toEqual([
          {
            name: "src/host.ts",
            type: "module",
            edgeSource: "lsp-fallback",
          },
        ]);
      });

      it("still fires when the only incoming link is the trivial self-file 'contains' edge, but excludes that file instead of double-counting it", () => {
        const spy = vi.spyOn(store.callSites, "getByTargetFunctions");
        const fileId = store.graph.insertNode({
          projectId,
          name: "src/plugin.ts",
          pathPatterns: ["src/plugin.ts"],
        });
        store.graph.insertNode({
          projectId,
          name: "loadPlugin",
          pathPatterns: ["src/plugin.ts"],
          nodeKey: "src/plugin.ts#loadPlugin",
        });
        store.graph.insertLink({
          sourceNodeId: fileId,
          targetNodeId: store.graph.findNodeIdByName(
            "src/plugin.ts",
            "loadPlugin",
          ) as number,
          linkType: "contains",
        });
        // The defining file calling its own symbol is recursion, not a dependent -- excluded.
        store.callSites.insertMany(projectId, "src/plugin.ts", [
          { targetFunction: "loadPlugin", startLine: 3, startColumn: 0 },
        ]);

        expect(impactService.getBlastRadius(store, "loadPlugin")).toEqual([
          { name: "src/plugin.ts", type: "module" },
        ]);
        expect(spy).toHaveBeenCalledTimes(1);
      });

      it("attaches L3 'why' data to an lsp-fallback entry like a static one", () => {
        store.graph.insertNode({
          projectId,
          name: "loadPlugin",
          pathPatterns: ["src/plugin.ts"],
        });
        const hostFileId = store.graph.insertNode({
          projectId,
          name: "src/host.ts",
          pathPatterns: ["src/host.ts"],
        });
        store.l3.upsertDecision({
          projectId,
          l2NodeId: hostFileId,
          title: "host decision",
          content: "loads plugins dynamically",
          nodeType: "decision",
          confidence: 0.9,
          commitSha: null,
          extractionModel: null,
          sourceFiles: [],
        });
        store.callSites.insertMany(projectId, "src/host.ts", [
          { targetFunction: "loadPlugin", startLine: 10, startColumn: 2 },
        ]);

        expect(impactService.getBlastRadius(store, "loadPlugin")).toEqual([
          {
            name: "src/host.ts",
            type: "module",
            why: [
              { title: "host decision", content: "loads plugins dynamically" },
            ],
            edgeSource: "lsp-fallback",
          },
        ]);
      });

      it("does not query call sites at all when a real static caller edge exists (fallback fires only when needed)", () => {
        const spy = vi.spyOn(store.callSites, "getByTargetFunctions");
        const targetId = store.graph.insertNode({
          projectId,
          name: "loadPlugin",
          pathPatterns: ["src/plugin.ts"],
        });
        const callerId = store.graph.insertNode({
          projectId,
          name: "src/host.ts",
          pathPatterns: ["src/host.ts"],
        });
        store.graph.insertLink({
          sourceNodeId: callerId,
          targetNodeId: targetId,
          linkType: "calls",
        });
        store.callSites.insertMany(projectId, "src/host.ts", [
          { targetFunction: "loadPlugin", startLine: 10, startColumn: 2 },
        ]);

        expect(impactService.getBlastRadius(store, "loadPlugin")).toEqual([
          { name: "src/host.ts", type: "module" },
        ]);
        expect(spy).not.toHaveBeenCalled();
      });

      it("[error-handling] reports an unavailable snapshot fallback only for symbols without static callers", () => {
        const availabilityKey = `${SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX}${projectId}`;
        store.meta.set(
          availabilityKey,
          SnapshotCallSiteAvailabilityStates.UNAVAILABLE,
        );
        const targetId = store.graph.insertNode({
          projectId,
          name: "loadPlugin",
          pathPatterns: ["src/plugin.ts"],
        });

        expect(
          impactService.getCallSiteFallbackUnavailableReason(
            store,
            "loadPlugin",
          ),
        ).toBe("snapshot-call-sites-unavailable");

        store.meta.set(
          availabilityKey,
          SnapshotCallSiteAvailabilityStates.AVAILABLE,
        );
        expect(
          impactService.getCallSiteFallbackUnavailableReason(
            store,
            "loadPlugin",
          ),
        ).toBeUndefined();
        store.meta.set(
          availabilityKey,
          SnapshotCallSiteAvailabilityStates.UNAVAILABLE,
        );

        const callerId = store.graph.insertNode({
          projectId,
          name: "src/host.ts",
          pathPatterns: ["src/host.ts"],
        });
        store.graph.insertLink({
          sourceNodeId: callerId,
          targetNodeId: targetId,
          linkType: "calls",
        });
        expect(
          impactService.getCallSiteFallbackUnavailableReason(
            store,
            "loadPlugin",
          ),
        ).toBeUndefined();
      });

      it("skips the target's own file and files absent from the graph, and never trusts a LIKE match as the dependent node", () => {
        store.graph.insertNode({
          projectId,
          name: "loadPlugin",
          pathPatterns: ["src/plugin.ts"],
        });
        // A node whose NAME merely contains the calling path -- findNodeByName's LIKE stage
        // would resolve "src/ho" to this; the fallback must not treat it as the dependent.
        store.graph.insertNode({
          projectId,
          name: "src/host.ts.bak.ts",
          pathPatterns: ["src/host.ts.bak.ts"],
        });
        store.callSites.insertMany(projectId, "src/plugin.ts", [
          { targetFunction: "loadPlugin", startLine: 1, startColumn: 0 },
        ]);
        store.callSites.insertMany(projectId, "src/host.ts", [
          { targetFunction: "loadPlugin", startLine: 10, startColumn: 2 },
        ]);

        expect(impactService.getBlastRadius(store, "loadPlugin")).toEqual([]);
      });
    });
  });
});
