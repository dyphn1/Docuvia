import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedAstFileResult } from "@workspace/contracts";
import { GraphStore } from "@workspace/schema";
import { buildQualifiedBaseKey, buildUniqueNodeKey } from "./node-key.js";
import { GraphPersisterService } from "./persist-ast-graph.js";
import { ScopeResolver } from "./scope-resolver.js";

// TDD-SOURCE: docs/gitbook/adr/graph/GRPH-006-qualified-symbol-table-node-key.md
// TDD-SOURCE: lib/contracts/src/interfaces/graph-persister.interfaces.ts
// TDD-SOURCE: lib/contracts/src/interfaces/graph-store.interfaces.ts

function makeParsedResults(): ParsedAstFileResult[] {
  return [
    {
      file: "src/a.ts",
      hash: "hash-a",
      data: {
        imports: [],
        exports: [],
        functions: [
          { name: "foo", startLine: 0, endLine: 0 },
          { name: "bar", startLine: 1, endLine: 1 },
        ],
        classes: [],
        calls: [
          {
            sourceFunction: "foo",
            targetFunction: "bar",
            startLine: 0,
            startColumn: 20,
          },
        ],
      },
    },
  ];
}

describe("Phase 4 graph hardening", () => {
  let store: GraphStore | undefined;
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (store) await store.close();
    store = undefined;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it("node-key qualification and collision fallback are deterministic across repeated identical input", () => {
    const makeKey = () => {
      const base = buildQualifiedBaseKey("src/a.ts", "handle", "ClassA");
      const used = new Set<string>([base, `${base}@L12`, `${base}@L12#2`]);
      return buildUniqueNodeKey(used, base, 12);
    };

    expect(makeKey()).toBe("src/a.ts#ClassA.handle@L12#3");
    expect(makeKey()).toBe(makeKey());
  });

  it("scope resolution is deterministic for repeated identical registered-file input", () => {
    const resolve = () => {
      const resolver = new ScopeResolver("/workspace");
      resolver.registerFile("a.go", [], [], ["Foo"]);
      resolver.registerFile("b.go", [], [], ["Bar"]);
      return {
        resolved: resolver.resolveCall("b.go", "Foo"),
        missing: resolver.resolveCall("b.go", "Missing"),
      };
    };

    const first = resolve();
    const second = resolve();

    expect(first).toEqual({
      resolved: { targetFile: "a.go", targetSymbol: "Foo" },
      missing: null,
    });
    expect(second).toEqual(first);
  });

  it("re-persisting identical AST input produces the same semantic graph snapshot", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-phase4-graph-"));
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    const projectId = store.projects.insert({
      name: "phase4",
      repoUrl: "file:///phase4",
    }).id;
    const persister = new GraphPersisterService();

    const semanticSnapshot = () => {
      const nodes = store!.graph.getAllNodes();
      const keyById = new Map(
        nodes.map((node) => [node.id, node.node_key ?? node.name] as const),
      );
      const normalizedNodes = nodes
        .map((node) => ({
          name: node.name,
          type: node.type,
          nodeKey: node.node_key,
          pathPatterns: node.path_patterns,
          contentHash: node.content_hash,
        }))
        .sort((a, b) => String(a.nodeKey).localeCompare(String(b.nodeKey)));
      const normalizedLinks = store!.graph
        .getAllLinks()
        .map((link) => ({
          source: keyById.get(link.source_node_id),
          target: keyById.get(link.target_node_id),
          linkType: link.link_type,
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return {
        nodes: normalizedNodes,
        links: normalizedLinks,
        files: store!.files
          .getAllHashes()
          .slice()
          .sort((a, b) => a.filePath.localeCompare(b.filePath)),
      };
    };

    const input = {
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: makeParsedResults(),
      tags: ["typescript"],
    };

    await persister.persist(input);
    const first = semanticSnapshot();
    await persister.persist(input);
    const second = semanticSnapshot();

    expect(second).toEqual(first);
    expect(second.nodes.map((node) => node.nodeKey)).toEqual([
      "src/a.ts",
      "src/a.ts#bar",
      "src/a.ts#foo",
    ]);
    expect(second.links).toContainEqual({
      source: "src/a.ts#foo",
      target: "src/a.ts#bar",
      linkType: "calls",
    });
  });

  it("rolls back partial AST graph writes when persistence fails during edge insertion", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-phase4-rollback-"));
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    const projectId = store.projects.insert({
      name: "phase4",
      repoUrl: "file:///phase4",
    }).id;
    const before = store.graph.count();
    const persister = new GraphPersisterService();

    vi.spyOn(store.graph, "insertLink").mockImplementationOnce(() => {
      throw new Error("phase4 forced edge failure");
    });

    await expect(
      persister.persist({
        store,
        workspaceRoot: tmpDir,
        projectId,
        parsedResults: makeParsedResults(),
        tags: [],
      }),
    ).rejects.toThrow("phase4 forced edge failure");

    expect(store.graph.count()).toEqual(before);
    expect(store.graph.findNodeIdByNodeKey("src/a.ts")).toBeUndefined();
    expect(store.files.getAllHashes()).toEqual([]);
  });
});
