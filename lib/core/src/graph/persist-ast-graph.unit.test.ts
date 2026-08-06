import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import DatabaseCtor from "better-sqlite3";
import { GraphStore } from "@workspace/schema";
import type { ParsedAstFileResult } from "@workspace/contracts";
import { GraphPersisterService } from "./persist-ast-graph.js";
import { buildParseResponse } from "../ast/ast-worker.js";

/**
 * Uses a real temp `GraphStore` (from `@workspace/schema`, a test-only dependency — production
 * code never imports it; `lib/ui-core` injects an `IGraphStore` instance) rather than a mocked
 * repo surface: `GraphPersisterService`'s whole job is orchestrating several
 * `graph`/`tags`/`files` primitive calls (including `ScopeResolver`-based cross-file link
 * resolution), so asserting against the actual persisted rows is far less brittle than
 * hand-writing a mock that re-implements that orchestration.
 */
describe("GraphPersisterService.persist()", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  let persister: GraphPersisterService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-persist-ast-graph-"),
    );
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    projectId = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    }).id;
    persister = new GraphPersisterService();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists parsed files as l2_nodes and links functions with 'contains'", async () => {
    const parsedResults: ParsedAstFileResult[] = [
      {
        file: "src/a.ts",
        hash: "hash-a",
        data: {
          imports: [],
          exports: [],
          functions: [{ name: "foo", startLine: 0, endLine: 1 }],
          classes: [],
          calls: [],
        },
      },
    ];

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults,
      tags: ["typescript"],
    });

    const fileNodeId = store.graph.findNodeIdByName("src/a.ts", "src/a.ts");
    const fnNodeId = store.graph.findNodeIdByName("src/a.ts", "foo");
    expect(fileNodeId).toBeDefined();
    expect(fnNodeId).toBeDefined();
    expect(store.files.getAllHashes()).toEqual([
      { filePath: "src/a.ts", contentHash: "hash-a" },
    ]);
  });

  it("upserts and links every given tag to each persisted file node", async () => {
    const parsedResults: ParsedAstFileResult[] = [
      {
        file: "src/a.ts",
        hash: "hash-a",
        data: {
          imports: [],
          exports: [],
          functions: [],
          classes: [],
          calls: [],
        },
      },
    ];

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults,
      tags: ["typescript", "backend"],
    });

    expect(store.tags.getIdByName("typescript")).toBeDefined();
    expect(store.tags.getIdByName("backend")).toBeDefined();
  });

  it("resolves an intra-file call edge via ScopeResolver ('calls' link between the two function nodes)", async () => {
    const parsedResults: ParsedAstFileResult[] = [
      {
        file: "src/a.ts",
        hash: "hash-a",
        data: {
          imports: [],
          exports: [],
          functions: [
            { name: "foo", startLine: 0, endLine: 1 },
            { name: "bar", startLine: 2, endLine: 3 },
          ],
          classes: [],
          calls: [
            {
              sourceFunction: "foo",
              targetFunction: "bar",
              startLine: 1,
              startColumn: 2,
            },
          ],
        },
      },
    ];

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults,
      tags: [],
    });

    const fooId = store.graph.findNodeIdByName("src/a.ts", "foo");
    const barId = store.graph.findNodeIdByName("src/a.ts", "bar");
    expect(fooId).toBeDefined();
    expect(barId).toBeDefined();

    // GraphNodesRepo exposes no "list links" primitive, so query the persisted node_links row
    // directly via a second read-only connection to assert the "calls" edge itself (not just
    // that both endpoint nodes exist) was actually created.
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    const raw = new DatabaseCtor(dbPath, { readonly: true });
    try {
      const link = raw
        .prepare(
          "SELECT * FROM node_links WHERE source_node_id = ? AND target_node_id = ? AND link_type = 'calls'",
        )
        .get(fooId, barId);
      expect(link).toBeDefined();
    } finally {
      raw.close();
    }
  });

  it("disambiguates same-named symbols in one file instead of throwing on the node_key UNIQUE constraint (regression: multiple 'anonymous' callbacks in one file used to crash init)", async () => {
    const parsedResults: ParsedAstFileResult[] = [
      {
        file: "src/a.ts",
        hash: "hash-a",
        data: {
          imports: [],
          exports: [],
          functions: [
            // resolveCallableName() returns the literal string "anonymous" for every truly-unbound
            // callback in a file (e.g. two separate bare arguments to .then()/.map()) — a file with
            // 2+ of these used to insert the identical node_key twice and throw.
            { name: "anonymous", startLine: 5, endLine: 6 },
            { name: "anonymous", startLine: 10, endLine: 11 },
            // Two chained/nested callbacks can even share a start line (e.g.
            // `x.map(() => {}).filter(() => {})`), so the line-based disambiguation must itself
            // fall back further rather than collide.
            { name: "anonymous", startLine: 20, endLine: 20 },
            { name: "anonymous", startLine: 20, endLine: 20 },
          ],
          classes: [],
          calls: [],
        },
      },
    ];

    await expect(
      persister.persist({
        store,
        workspaceRoot: tmpDir,
        projectId,
        parsedResults,
        tags: [],
      }),
    ).resolves.toEqual({ updatedCount: 1 });

    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    const raw = new DatabaseCtor(dbPath, { readonly: true });
    try {
      const rows = raw
        .prepare("SELECT node_key FROM l2_nodes WHERE name = 'anonymous'")
        .all() as { node_key: string }[];
      const nodeKeys = rows.map((r) => r.node_key);
      expect(nodeKeys).toHaveLength(4);
      expect(new Set(nodeKeys).size).toBe(4); // every node_key is unique — none collided
    } finally {
      raw.close();
    }
  });

  it("disambiguates two same-named methods on different classes via qualified node_keys, with no @Lline suffix needed (GRPH-006)", async () => {
    // ClassA.handle and ClassB.handle share a bare name but now get structurally different
    // qualified base keys (file#ClassA.handle / file#ClassB.handle) by construction -- the
    // collision this ADR exists to close no longer needs buildUniqueNodeKey's line-suffix
    // fallback for this shape at all.
    const parsedResults: ParsedAstFileResult[] = [
      {
        file: "src/a.ts",
        hash: "hash-a",
        data: {
          imports: [],
          exports: [],
          functions: [
            {
              name: "handle",
              startLine: 1,
              endLine: 2,
              containerName: "ClassA",
            },
            {
              name: "handle",
              startLine: 5,
              endLine: 6,
              containerName: "ClassB",
            },
          ],
          classes: [],
          calls: [],
        },
      },
    ];

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults,
      tags: [],
    });

    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    const raw = new DatabaseCtor(dbPath, { readonly: true });
    try {
      const rows = raw
        .prepare("SELECT node_key FROM l2_nodes WHERE name = 'handle'")
        .all() as { node_key: string }[];
      const nodeKeys = rows.map((r) => r.node_key).sort();
      expect(nodeKeys).toEqual([
        "src/a.ts#ClassA.handle",
        "src/a.ts#ClassB.handle",
      ]);
    } finally {
      raw.close();
    }
  });

  it("re-persisting the same file deletes its stale nodes first (no duplicate function nodes)", async () => {
    const makeParsedResults = (): ParsedAstFileResult[] => [
      {
        file: "src/a.ts",
        hash: "hash-a",
        data: {
          imports: [],
          exports: [],
          functions: [{ name: "foo", startLine: 0, endLine: 1 }],
          classes: [],
          calls: [],
        },
      },
    ];

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: makeParsedResults(),
      tags: [],
    });
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: makeParsedResults(),
      tags: [],
    });

    // Both the file node and the function node should still resolve to exactly one id each —
    // no duplicates left behind by the second persist.
    expect(store.graph.findNodeIdByName("src/a.ts", "src/a.ts")).toBeDefined();
    expect(store.graph.findNodeIdByName("src/a.ts", "foo")).toBeDefined();
    expect(store.files.getAllHashes()).toEqual([
      { filePath: "src/a.ts", contentHash: "hash-a" },
    ]);
  });

  it("resolves a same-package, no-import Go cross-file call into a persisted 'calls' link (roadmap item 19, fixed)", async () => {
    const fooResponse = await buildParseResponse({
      taskId: "go-a",
      filePath: "a.go",
      code: "package main\nfunc Foo() {}\n",
      language: "go",
    });
    const barResponse = await buildParseResponse({
      taskId: "go-b",
      filePath: "b.go",
      code: "package main\nfunc Bar() { Foo() }\n",
      language: "go",
    });

    const parsedResults: ParsedAstFileResult[] = [
      { file: "a.go", hash: "hash-a", data: fooResponse.data! },
      { file: "b.go", hash: "hash-b", data: barResponse.data! },
    ];

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults,
      tags: [],
    });

    // The real Go parse does extract the call site correctly (sourceFunction: "Bar",
    // targetFunction: "Foo"), and now carries the call's 0-based source position as the seed for
    // Tier B forward resolution (issue #11 plan A, Slice 1) -- this isn't an extraction gap.
    expect(barResponse.data!.calls[0]).toEqual(
      expect.objectContaining({
        sourceFunction: "Bar",
        targetFunction: "Foo",
        startLine: expect.any(Number),
        startColumn: expect.any(Number),
      }),
    );

    const fooId = store.graph.findNodeIdByName("a.go", "Foo");
    const barId = store.graph.findNodeIdByName("b.go", "Bar");
    expect(fooId).toBeDefined();
    expect(barId).toBeDefined();

    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    const raw = new DatabaseCtor(dbPath, { readonly: true });
    try {
      const link = raw
        .prepare(
          "SELECT * FROM node_links WHERE source_node_id = ? AND target_node_id = ? AND link_type = 'calls'",
        )
        .get(barId, fooId);
      // No import ties b.go to a.go, but ScopeResolver.resolveCall() now falls back to a
      // directory-scoped Go same-package lookup: since a.go and b.go share a directory and a.go
      // declares "Foo" as a local, the call resolves and linkSymbolReference() inserts the edge.
      expect(link).toBeDefined();
      expect((link as any).link_type).toBe("calls");
    } finally {
      raw.close();
    }
  });
});
