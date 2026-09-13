import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "@workspace/schema";
import { ImpactService } from "./impact.service.js";

// TDD-SOURCE: lib/contracts/src/interfaces/impact.interfaces.ts

describe("Phase 6 impact quality evidence", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  let impactService: ImpactService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-phase6-impact-"));
    store = await GraphStore.open({
      dbPath: path.join(tmpDir, ".docuvia", "local.db"),
    });
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

  it("returns identical blast-radius entries across repeated identical reads", () => {
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
