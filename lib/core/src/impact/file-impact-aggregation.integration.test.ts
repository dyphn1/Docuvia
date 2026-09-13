import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "@workspace/schema";
import { LinkTypes } from "@workspace/contracts";
import { ImpactService } from "./impact.service.js";

// TDD-SOURCE: https://github.com/dyphn1/Docuvia/issues/192

describe("file-level impact aggregation", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  let impactService: ImpactService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-file-impact-"));
    store = await GraphStore.open({
      dbPath: path.join(tmpDir, ".docuvia", "local.db"),
    });
    projectId = store.projects.insert({
      name: "file-impact",
      repoUrl: "file:///file-impact",
    }).id;
    impactService = new ImpactService();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function insertFile(filePath: string): number {
    return store.graph.insertNode({
      projectId,
      name: filePath,
      pathPatterns: [filePath],
      nodeKey: filePath,
    });
  }

  function insertSymbol(filePath: string, name: string): number {
    return store.graph.insertNode({
      projectId,
      name,
      pathPatterns: [filePath],
      nodeKey: `${filePath}#${name}`,
    });
  }

  it("projects symbol callers back to their containing file for a file target", () => {
    const targetFile = "lib/core/src/graph/scope-resolver.ts";
    const callerFile = "lib/core/src/graph/persist-ast-graph.ts";
    const targetFileId = insertFile(targetFile);
    const targetSymbolId = insertSymbol(targetFile, "ScopeResolver");
    const callerFileId = insertFile(callerFile);
    const callerSymbolId = insertSymbol(callerFile, "persistLocked");

    store.graph.insertLink({
      sourceNodeId: targetFileId,
      targetNodeId: targetSymbolId,
      linkType: LinkTypes.CONTAINS,
    });
    store.graph.insertLink({
      sourceNodeId: callerFileId,
      targetNodeId: callerSymbolId,
      linkType: LinkTypes.CONTAINS,
    });
    store.graph.insertLink({
      sourceNodeId: callerSymbolId,
      targetNodeId: targetSymbolId,
      linkType: LinkTypes.CALLS,
    });

    const first = impactService.getBlastRadius(store, targetFile);
    const second = impactService.getBlastRadius(store, targetFile);

    expect(first).toEqual([{ name: callerFile, type: "module" }]);
    expect(second).toEqual(first);
  });

  it("deduplicates a caller already visible through a direct file-level dependency", () => {
    const targetFile = "src/target.ts";
    const callerFile = "src/caller.ts";
    const targetFileId = insertFile(targetFile);
    const targetSymbolId = insertSymbol(targetFile, "TargetService");
    const callerFileId = insertFile(callerFile);
    const callerSymbolId = insertSymbol(callerFile, "run");

    store.graph.insertLink({
      sourceNodeId: targetFileId,
      targetNodeId: targetSymbolId,
      linkType: LinkTypes.CONTAINS,
    });
    store.graph.insertLink({
      sourceNodeId: callerFileId,
      targetNodeId: callerSymbolId,
      linkType: LinkTypes.CONTAINS,
    });
    store.graph.insertLink({
      sourceNodeId: callerFileId,
      targetNodeId: targetFileId,
      linkType: LinkTypes.IMPORTS,
    });
    store.graph.insertLink({
      sourceNodeId: callerSymbolId,
      targetNodeId: targetSymbolId,
      linkType: LinkTypes.CALLS,
    });

    expect(impactService.getBlastRadius(store, targetFile)).toEqual([
      { name: callerFile, type: "module" },
    ]);
  });
});
