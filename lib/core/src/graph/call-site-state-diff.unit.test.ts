import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "@workspace/schema";
import type { ParsedAstFileResult } from "@workspace/contracts";
import { GraphPersisterService } from "./persist-ast-graph.js";

// TDD-SOURCE: https://github.com/dyphn1/Docuvia/issues/263

describe("call-site persistence category coverage", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  let persister: GraphPersisterService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-state-diff-"));
    store = await GraphStore.open({
      dbPath: path.join(tmpDir, ".docuvia", "local.db"),
    });
    projectId = store.projects.insert({
      name: "state-diff",
      repoUrl: "file:///state-diff",
    }).id;
    persister = new GraphPersisterService();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function parsed(targetFunction: string): ParsedAstFileResult[] {
    return [
      {
        file: "src/a.ts",
        hash: `hash:${targetFunction}`,
        language: "typescript",
        data: {
          imports: [],
          exports: [],
          functions: [
            { name: "foo", startLine: 0, endLine: 1 },
            { name: "bar", startLine: 2, endLine: 3 },
            { name: "baz", startLine: 4, endLine: 5 },
          ],
          classes: [],
          calls: [
            {
              sourceFunction: "foo",
              targetFunction,
              startLine: 1,
              startColumn: 2,
            },
          ],
        },
      },
    ];
  }

  function outgoingCallsFromFoo(): string[] {
    const fooId = store.graph.findNodeIdByName("src/a.ts", "foo");
    expect(fooId).toBeTypeOf("number");
    return store.graph
      .getOutgoingRelations(fooId!)
      .filter(({ linkType }) => linkType === "calls")
      .map(({ name }) => name)
      .sort();
  }

  it("[happy] persists the extracted call-site and matching graph edge", async () => {
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: parsed("bar"),
      tags: [],
    });

    expect(
      store.callSites.getForFiles(projectId, ["src/a.ts"]).get("src/a.ts"),
    ).toEqual([{ targetFunction: "bar", startLine: 1, startColumn: 2 }]);
    expect(outgoingCallsFromFoo()).toEqual(["bar"]);
  });

  it("[invalid-input] preserves an unknown bare call-site without inventing a graph edge", async () => {
    const result = await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: parsed("missingSymbol"),
      tags: [],
    });

    expect(
      store.callSites.getForFiles(projectId, ["src/a.ts"]).get("src/a.ts"),
    ).toEqual([
      { targetFunction: "missingSymbol", startLine: 1, startColumn: 2 },
    ]);
    expect(outgoingCallsFromFoo()).toEqual([]);
    expect(result.callResolution).toEqual({
      total: 1,
      resolved: 0,
      selfDiscarded: 0,
      unresolvable: 0,
      external: 0,
      unknownReceiver: 0,
      unresolved: 1,
    });
  });

  it("[error-handling] reports unresolved classification instead of claiming a resolved edge", async () => {
    const result = await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: parsed("notDefined"),
      tags: [],
    });

    expect(result.updatedCount).toBe(1);
    expect(result.callResolutionByFile).toEqual({
      "src/a.ts": {
        total: 1,
        resolved: 0,
        selfDiscarded: 0,
        unresolvable: 0,
        external: 0,
        unknownReceiver: 0,
        unresolved: 1,
      },
    });
  });

  it("[state-diff] replaces stale call-sites and call edges when a file is re-parsed", async () => {
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: parsed("bar"),
      tags: [],
    });

    const beforeSites = store.callSites
      .getForFiles(projectId, ["src/a.ts"])
      .get("src/a.ts");
    const beforeEdges = outgoingCallsFromFoo();

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: parsed("baz"),
      tags: [],
    });

    const afterSites = store.callSites
      .getForFiles(projectId, ["src/a.ts"])
      .get("src/a.ts");
    const afterEdges = outgoingCallsFromFoo();

    expect(beforeSites).toEqual([
      { targetFunction: "bar", startLine: 1, startColumn: 2 },
    ]);
    expect(beforeEdges).toEqual(["bar"]);
    expect(afterSites).toEqual([
      { targetFunction: "baz", startLine: 1, startColumn: 2 },
    ]);
    expect(afterEdges).toEqual(["baz"]);
    expect(afterSites).not.toEqual(beforeSites);
    expect(afterEdges).not.toEqual(beforeEdges);
  });
});
