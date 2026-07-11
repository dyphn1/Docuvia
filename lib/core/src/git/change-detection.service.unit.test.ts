import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GraphStore } from "@workspace/schema";
import { ChangeDetectionService } from "./change-detection.service.js";
import { IMPACT_RISK_THRESHOLDS } from "../impact/impact.service.js";

describe("ChangeDetectionService.detectChanges()", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  const changeDetection = new ChangeDetectionService();

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-change-detection-"));
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    projectId = store.projects.insert({ name: "demo", repoUrl: "file:///demo" }).id;
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns LOW risk with no affected nodes for an empty change set", () => {
    const result = changeDetection.detectChanges({ store, baseRef: null, filesChanged: [] });

    expect(result).toMatchObject({ baseRef: null, filesChanged: [], riskLevel: "LOW" });
    expect(result.affectedNodes).toEqual([]);
    expect(result.analysis).toContain("No local graph impact detected");
  });

  it("aggregates blast radii across changed files into a total impacted count and risk level", () => {
    const targetId = store.graph.insertNode({ projectId, name: "src/a.ts", pathPatterns: ["src/a.ts"] });
    const callerId = store.graph.insertNode({ projectId, name: "caller", pathPatterns: ["src/b.ts"] });
    store.graph.insertLink({ sourceNodeId: callerId, targetNodeId: targetId, linkType: "calls" });

    const result = changeDetection.detectChanges({
      store,
      baseRef: "main",
      filesChanged: [{ file: "src/a.ts", status: "modified" }],
    });

    expect(result.riskLevel).toBe("MEDIUM");
    expect(result.affectedNodes).toEqual([
      { file: "src/a.ts", impactedBy: [{ name: "caller", type: "module" }] },
    ]);
    expect(result.analysis).toContain("Impacted nodes: 1 across 1 changed file(s).");
  });

  it("bumps LOW risk to MEDIUM for a large diff even with zero impacted nodes", () => {
    const filesChanged = Array.from({ length: 11 }, (_, i) => ({
      file: "src/file" + i + ".ts",
      status: "modified",
    }));

    const result = changeDetection.detectChanges({ store, baseRef: null, filesChanged });

    expect(result.riskLevel).toBe("MEDIUM");
  });

  it("reaches CRITICAL once the total impacted count crosses the CRITICAL threshold", () => {
    const targetId = store.graph.insertNode({ projectId, name: "src/a.ts", pathPatterns: ["src/a.ts"] });
    for (let i = 0; i < IMPACT_RISK_THRESHOLDS.CRITICAL_MIN; i++) {
      const callerId = store.graph.insertNode({
        projectId,
        name: "caller" + i,
        pathPatterns: ["src/caller" + i + ".ts"],
      });
      store.graph.insertLink({ sourceNodeId: callerId, targetNodeId: targetId, linkType: "calls" });
    }

    const result = changeDetection.detectChanges({
      store,
      baseRef: null,
      filesChanged: [{ file: "src/a.ts", status: "modified" }],
    });

    expect(result.riskLevel).toBe("CRITICAL");
  });
});
