import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ErrorCodes } from "@workspace/contracts";
import { GraphStore } from "@workspace/schema";
import { ImpactService } from "./impact.service.js";

// TDD-SOURCE: lib/contracts/src/interfaces/impact.interfaces.ts

describe("Phase 6 impact quality evidence", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: GraphStore;
  let projectId: number;
  let impactService: ImpactService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-phase6-impact-"));
    dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    projectId = store.projects.insert({
      name: "phase6-impact",
      repoUrl: "file:///phase6-impact",
    }).id;
    impactService = new ImpactService();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("[happy] returns identical blast-radius entries across repeated identical reads", () => {
    const targetId = store.graph.insertNode({
      projectId,
      name: "sharedUtil",
      pathPatterns: ["src/util.ts"],
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

    const first = impactService.getBlastRadius(store, "sharedUtil");
    const second = impactService.getBlastRadius(store, "sharedUtil");

    expect(second).toEqual(first);
    expect(first).toEqual([{ name: "caller", type: "module" }]);
  });

  it("[invalid-input] returns undefined for a target that cannot resolve to a graph node", () => {
    expect(impactService.getBlastRadius(store, "missing-target")).toEqual(
      undefined,
    );
  });

  it("[error-handling] preserves the wrapped DB error when impact lookup runs on a closed store", async () => {
    await store.close();

    let failure: unknown;
    try {
      impactService.getBlastRadius(store, "sharedUtil");
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: ErrorCodes.DB_QUERY_FAILED,
      message: expect.stringContaining("Failed to find node by name: sharedUtil"),
    });

    store = await GraphStore.open({ dbPath });
  });

  it("[state-diff] reflects the exact caller added to a previously empty blast radius", () => {
    const targetId = store.graph.insertNode({
      projectId,
      name: "statefulTarget",
      pathPatterns: ["src/target.ts"],
    });
    const before = impactService.getBlastRadius(store, "statefulTarget");

    const callerId = store.graph.insertNode({
      projectId,
      name: "statefulCaller",
      pathPatterns: ["src/caller.ts"],
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: targetId,
      linkType: "calls",
    });

    const after = impactService.getBlastRadius(store, "statefulTarget");

    expect(before).toEqual([]);
    expect(after).toEqual([{ name: "statefulCaller", type: "module" }]);
  });

  it("[stress] resolves 250 distinct static callers without dropping or duplicating dependents", () => {
    const targetId = store.graph.insertNode({
      projectId,
      name: "hotTarget",
      pathPatterns: ["src/hot-target.ts"],
    });
    const expectedNames = store.withTransaction(() =>
      Array.from({ length: 250 }, (_, index) => {
        const name = `caller-${index}`;
        const callerId = store.graph.insertNode({
          projectId,
          name,
          pathPatterns: [`src/caller-${index}.ts`],
        });
        store.graph.insertLink({
          sourceNodeId: callerId,
          targetNodeId: targetId,
          linkType: "calls",
        });
        return name;
      }),
    );

    const blastRadius = impactService.getBlastRadius(store, "hotTarget");
    const actualNames = (blastRadius ?? []).map((entry) => entry.name).sort();

    expect(blastRadius).toHaveLength(250);
    expect(new Set(actualNames).size).toBe(250);
    expect(actualNames).toEqual([...expectedNames].sort());
  });

  it("recovers unresolved receiver calls through the terminal callee name", () => {
    store.graph.insertNode({
      projectId,
      name: "evalRenderTemplate",
      pathPatterns: ["src/renderer.ts"],
    });
    store.graph.insertNode({
      projectId,
      name: "src/render-host.ts",
      pathPatterns: ["src/render-host.ts"],
    });
    store.callSites.insertMany(projectId, "src/render-host.ts", [
      {
        targetFunction: "engine.evalRenderTemplate",
        calleeName: "evalRenderTemplate",
        receiverText: "engine",
        calleeKind: "member",
        startLine: 2,
        startColumn: 9,
      },
    ]);

    expect(impactService.getBlastRadius(store, "evalRenderTemplate")).toEqual([
      {
        name: "src/render-host.ts",
        type: "module",
        edgeSource: "lsp-fallback",
      },
    ]);
  });

  it("returns identical lsp-fallback entries across repeated identical reads", () => {
    store.graph.insertNode({
      projectId,
      name: "evalRenderMethod",
      pathPatterns: ["src/method-renderer.ts"],
    });
    store.graph.insertNode({
      projectId,
      name: "src/method-render-host.ts",
      pathPatterns: ["src/method-render-host.ts"],
    });
    store.callSites.insertMany(projectId, "src/method-render-host.ts", [
      {
        targetFunction: "renderer.evalRenderMethod",
        calleeName: "evalRenderMethod",
        receiverText: "renderer",
        calleeKind: "member",
        startLine: 5,
        startColumn: 2,
      },
    ]);

    const first = impactService.getBlastRadius(store, "evalRenderMethod");
    const second = impactService.getBlastRadius(store, "evalRenderMethod");

    expect(second).toEqual(first);
    expect(first).toEqual([
      {
        name: "src/method-render-host.ts",
        type: "module",
        edgeSource: "lsp-fallback",
      },
    ]);
  });
});
