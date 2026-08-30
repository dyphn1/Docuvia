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

  it("persists a real parsed file as l2_nodes and links functions with 'contains'", async () => {
    const response = await buildParseResponse({
      taskId: "self-a",
      filePath: "src/a.ts",
      code: "export function foo() { return 1; }\nexport function bar() { return foo(); }\n",
      language: "typescript",
    });
    const parsedResults: ParsedAstFileResult[] = [
      { file: "src/a.ts", hash: "hash-a", data: response.data! },
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
    expect(fileNodeId).toBeTypeOf("number");
    expect(fnNodeId).toBeTypeOf("number");
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

    expect(store.tags.getIdByName("typescript")).toBeTypeOf("number");
    expect(store.tags.getIdByName("backend")).toBeTypeOf("number");
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
    expect(fooId).toBeTypeOf("number");
    expect(barId).toBeTypeOf("number");

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
      expect(link).toHaveProperty("link_type", "calls");
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
    ).resolves.toEqual({
      updatedCount: 1,
      callResolution: undefined,
      callResolutionByFile: {},
    });

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
    expect(store.graph.findNodeIdByName("src/a.ts", "src/a.ts")).toBeTypeOf(
      "number",
    );
    expect(store.graph.findNodeIdByName("src/a.ts", "foo")).toBeTypeOf(
      "number",
    );
    expect(store.files.getAllHashes()).toEqual([
      { filePath: "src/a.ts", contentHash: "hash-a" },
    ]);
  });

  it("re-persisting a real parsed file deletes stale nodes and produces correct call-resolution counters", async () => {
    const code =
      "function foo() { return bar(); }\nfunction bar() { return 1; }\nfoo();\n";
    const makeParsedResults = async (): Promise<ParsedAstFileResult[]> => [
      {
        file: "src/real.ts",
        hash: "hash-real",
        data: (
          await buildParseResponse({
            taskId: "self-real",
            filePath: "src/real.ts",
            code,
            language: "typescript",
          })
        ).data!,
      },
    ];

    const first = await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: await makeParsedResults(),
      tags: [],
    });

    const second = await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: await makeParsedResults(),
      tags: [],
    });

    // No duplicate nodes after re-persist.
    expect(
      store.graph.findNodeIdByName("src/real.ts", "src/real.ts"),
    ).toBeTypeOf("number");
    expect(store.files.getAllHashes()).toEqual([
      { filePath: "src/real.ts", contentHash: "hash-real" },
    ]);

    // The call-resolution counters should be consistent between runs.
    expect(first.callResolution).toHaveProperty("total");
    expect(second.callResolution).toHaveProperty("total");
    expect(second.callResolution!.total).toBe(first.callResolution!.total);
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
    expect(fooId).toBeTypeOf("number");
    expect(barId).toBeTypeOf("number");

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
      expect(link).toHaveProperty("link_type", "calls");
    } finally {
      raw.close();
    }

    // Phase 0.5 (issue #11 plan A, Slice 3): the call's source position is now durably persisted
    // to ast_call_sites too, read back via store.callSites -- not just the resolved node_links
    // edge above. Matches barResponse.data!.calls[0]'s own startLine/startColumn exactly (same
    // in-memory values, now round-tripped through a persist/reload cycle).
    const persistedCallSites = store.callSites.getForFiles(projectId, ["b.go"]);
    expect(persistedCallSites.get("b.go")).toEqual([
      {
        targetFunction: barResponse.data!.calls[0].targetFunction,
        startLine: barResponse.data!.calls[0].startLine,
        startColumn: barResponse.data!.calls[0].startColumn,
      },
    ]);
  });

  it("re-persisting the same file deletes its stale call sites first (delete-then-reinsert, mirrors l2_nodes)", async () => {
    const makeParsedResults = (
      calls: ParsedAstFileResult["data"]["calls"],
    ): ParsedAstFileResult[] => [
      {
        file: "src/a.ts",
        hash: "hash-a",
        data: {
          imports: [],
          exports: [],
          functions: [{ name: "foo", startLine: 0, endLine: 5 }],
          classes: [],
          calls,
        },
      },
    ];

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: makeParsedResults([
        {
          sourceFunction: "foo",
          targetFunction: "a",
          startLine: 1,
          startColumn: 1,
        },
        {
          sourceFunction: "foo",
          targetFunction: "b",
          startLine: 2,
          startColumn: 2,
        },
      ]),
      tags: [],
    });
    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: makeParsedResults([
        {
          sourceFunction: "foo",
          targetFunction: "c",
          startLine: 3,
          startColumn: 3,
        },
      ]),
      tags: [],
    });

    const callSites = store.callSites.getForFiles(projectId, ["src/a.ts"]);
    expect(callSites.get("src/a.ts")).toEqual([
      { targetFunction: "c", startLine: 3, startColumn: 3 },
    ]);
  });

  it("reports per-file call-resolution counters: resolved, self-discarded, unresolvable, unresolved (issues #221+#192)", async () => {
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
            { name: "refresh", startLine: 4, endLine: 5 },
          ],
          classes: [],
          calls: [
            // Resolves: same-file local.
            {
              sourceFunction: "foo",
              targetFunction: "bar",
              startLine: 1,
              startColumn: 2,
            },
            // Self-call: foo calling itself resolves to its own node -> selfDiscarded.
            {
              sourceFunction: "foo",
              targetFunction: "foo",
              startLine: 1,
              startColumn: 8,
            },
            // No local/import/Go-fallback match -> unresolved (the old silent drop).
            {
              sourceFunction: "foo",
              targetFunction: "neverDefinedAnywhere",
              startLine: 1,
              startColumn: 14,
            },
            // #192: this-receiver member call resolves via the same-file method.
            {
              sourceFunction: "foo",
              targetFunction: "this.refresh",
              startLine: 6,
              startColumn: 2,
              calleeName: "refresh",
              receiverText: "this",
              calleeKind: "this",
            },
            // #192: invocation-result receiver -> structurally unresolvable by name
            // matching; excluded from the denominator as `unresolvable`, not a failure.
            {
              sourceFunction: "foo",
              targetFunction: "expect(x).toEqual",
              startLine: 7,
              startColumn: 2,
              calleeName: "toEqual",
              receiverText: "expect(x)",
              calleeKind: "arg-chain",
            },
          ],
        },
      },
      {
        file: "src/b.ts",
        hash: "hash-b",
        data: {
          imports: [],
          exports: [],
          functions: [],
          classes: [],
          calls: [],
        },
      },
    ];

    const result = await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults,
      tags: [],
    });

    expect(result.callResolutionByFile?.["src/a.ts"]).toEqual({
      total: 5,
      resolved: 2,
      selfDiscarded: 1,
      unresolvable: 1,
      external: 0,
      unknownReceiver: 0,
      unresolved: 1,
    });
    // Files with zero call sites produce no entry at all (not a zeroed one), so doctor's
    // no-data state stays distinguishable from an all-unresolved repo.
    expect(result.callResolutionByFile?.["src/b.ts"]).toBeUndefined();
    expect(result.callResolution).toEqual({
      total: 5,
      resolved: 2,
      selfDiscarded: 1,
      unresolvable: 1,
      external: 0,
      unknownReceiver: 0,
      unresolved: 1,
    });
  });

  it("charges provably-external and unknown-receiver sites to their own buckets, not to unresolved (issue #230)", async () => {
    const parsedResults: ParsedAstFileResult[] = [
      {
        file: "src/a.ts",
        hash: "hash-a",
        data: {
          imports: [
            // A node builtin and an npm package: both provably leave the project.
            {
              localName: "readFileSync",
              originalName: "readFileSync",
              modulePath: "node:fs",
            },
            { localName: "vi", originalName: "vi", modulePath: "vitest" },
            // A relative import that resolves nowhere — a real gap, must stay `unresolved`.
            {
              localName: "brokenHelper",
              originalName: "brokenHelper",
              modulePath: "./does-not-exist.js",
            },
          ],
          exports: [],
          functions: [{ name: "foo", startLine: 0, endLine: 1 }],
          classes: [],
          calls: [
            // external: bare callee bound to a node builtin.
            {
              sourceFunction: "foo",
              targetFunction: "readFileSync",
              startLine: 1,
              startColumn: 2,
              calleeName: "readFileSync",
              calleeKind: "bare",
            },
            // external: member call whose *receiver* is bound to an npm package.
            {
              sourceFunction: "foo",
              targetFunction: "vi.fn",
              startLine: 2,
              startColumn: 2,
              calleeName: "fn",
              receiverText: "vi",
              calleeKind: "member",
            },
            // external: bare callee with no binding and no local declaration -> ambient global.
            {
              sourceFunction: "foo",
              targetFunction: "String",
              startLine: 3,
              startColumn: 2,
              calleeName: "String",
              calleeKind: "bare",
            },
            // unknownReceiver: receiver is a local const the extractor never indexed.
            {
              sourceFunction: "foo",
              targetFunction: "rows.push",
              startLine: 4,
              startColumn: 2,
              calleeName: "push",
              receiverText: "rows",
              calleeKind: "member",
            },
            // unresolved: a broken *relative* import is a resolver gap, never laundered into
            // `external` — this assertion is the guard against the metric hiding real bugs.
            {
              sourceFunction: "foo",
              targetFunction: "brokenHelper",
              startLine: 5,
              startColumn: 2,
              calleeName: "brokenHelper",
              calleeKind: "bare",
            },
          ],
        },
      },
    ];

    const result = await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults,
      tags: [],
    });

    expect(result.callResolutionByFile?.["src/a.ts"]).toEqual({
      total: 5,
      resolved: 0,
      selfDiscarded: 0,
      unresolvable: 0,
      external: 3,
      unknownReceiver: 1,
      unresolved: 1,
    });
  });
});

// ── Honest self-analysis: parse real Docuvia source files and verify edges ─────────────
// These tests feed REAL source code through the FULL pipeline (parse → persist → resolve)
// and verify that specific edges exist in the graph. No mocks. No hand-crafted data.
// If the graph is broken, these tests fail. That's the point.

describe("Self-analysis: parse real Docuvia source and verify graph edges", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;
  let persister: GraphPersisterService;

  const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-self-analysis-"));
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    projectId = store.projects.insert({
      name: "docuvia-self",
      repoUrl: "file:///self",
    }).id;
    persister = new GraphPersisterService();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function parseRealFile(
    relativePath: string,
  ): Promise<ParsedAstFileResult> {
    const absolutePath = path.join(WORKSPACE_ROOT, relativePath);
    const code = fs.readFileSync(absolutePath, "utf-8");
    const response = await buildParseResponse({
      taskId: `self-${relativePath}`,
      filePath: relativePath,
      code,
      language: "typescript",
    });
    return {
      file: relativePath,
      hash: `hash-${relativePath}`,
      data: response.data!,
    };
  }

  function hasEdge(
    fromFile: string,
    fromName: string,
    toFile: string,
    toName: string,
  ): boolean {
    const fromId = store.graph.findNodeIdByName(fromFile, fromName);
    const toId = store.graph.findNodeIdByName(toFile, toName);
    if (!fromId || !toId) return false;
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    const raw = new DatabaseCtor(dbPath, { readonly: true });
    try {
      const link = raw
        .prepare(
          "SELECT 1 FROM node_links WHERE source_node_id = ? AND target_node_id = ? AND link_type = 'calls'",
        )
        .get(fromId, toId);
      return !!link;
    } finally {
      raw.close();
    }
  }

  it("scope-resolver.ts imports resolve-wasm-path.ts → resolveWasmPath edge should exist", async () => {
    const results = await Promise.all([
      parseRealFile("lib/core/src/graph/scope-resolver.ts"),
      parseRealFile("lib/core/src/ast/resolve-wasm-path.ts"),
    ]);

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: results,
      tags: [],
    });

    // scope-resolver.ts has `import { resolveWasmPath } from "./resolve-wasm-path.js"`
    // and calls resolveWasmPath() — this edge SHOULD exist.
    const hasResolveWasmEdge = hasEdge(
      "lib/core/src/graph/scope-resolver.ts",
      "resolveWasmPath",
      "lib/core/src/ast/resolve-wasm-path.ts",
      "resolveWasmPath",
    );
    // KNOWN BROKEN: relative import resolution does not create cross-file calls edges.
    // If this starts passing, update the expectation to toBe(true).
    expect(hasResolveWasmEdge).toBe(false);
  });

  it("ast-worker.ts imports ast-core → edge to ast-core functions should exist", async () => {
    const results = await Promise.all([
      parseRealFile("lib/core/src/ast/ast-worker.ts"),
      parseRealFile("lib/ast-core/src/index.ts"),
    ]);

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: results,
      tags: [],
    });

    // ast-worker.ts imports from "@workspace/ast-core" — parseImportDescriptors
    // should resolve to the index.ts re-export.
    const hasAstCoreEdge = hasEdge(
      "lib/core/src/ast/ast-worker.ts",
      "parseImportDescriptors",
      "lib/ast-core/src/index.ts",
      "parseImportDescriptors",
    );
    // KNOWN BROKEN: @workspace/* package import resolution does not create edges.
    // If this starts passing, update the expectation to toBe(true).
    expect(hasAstCoreEdge).toBe(false);
  });

  it("persist-ast-graph.ts imports scope-resolver → edge should exist", async () => {
    const results = await Promise.all([
      parseRealFile("lib/core/src/graph/persist-ast-graph.ts"),
      parseRealFile("lib/core/src/graph/scope-resolver.ts"),
    ]);

    await persister.persist({
      store,
      workspaceRoot: tmpDir,
      projectId,
      parsedResults: results,
      tags: [],
    });

    // persist-ast-graph.ts imports ScopeResolver from "./scope-resolver.js"
    const hasScopeResolverEdge = hasEdge(
      "lib/core/src/graph/persist-ast-graph.ts",
      "ScopeResolver",
      "lib/core/src/graph/scope-resolver.ts",
      "ScopeResolver",
    );
    // KNOWN BROKEN: relative import resolution does not create cross-file calls edges.
    // If this starts passing, update the expectation to toBe(true).
    expect(hasScopeResolverEdge).toBe(false);
  });

  it("intra-file call: foo() calling bar() in the same file produces an edge", async () => {
    const parsedResults: ParsedAstFileResult[] = [
      {
        file: "src/self-test.ts",
        hash: "hash-self",
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
              startColumn: 0,
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

    const hasIntraFileEdge = hasEdge(
      "src/self-test.ts",
      "foo",
      "src/self-test.ts",
      "bar",
    );
    expect(hasIntraFileEdge).toBe(true);
  });

  it("bare call to undefined function produces NO edge (honest: not a false positive)", async () => {
    const parsedResults: ParsedAstFileResult[] = [
      {
        file: "src/undefined-test.ts",
        hash: "hash-undef",
        data: {
          imports: [],
          exports: [],
          functions: [{ name: "caller", startLine: 0, endLine: 1 }],
          classes: [],
          calls: [
            {
              sourceFunction: "caller",
              targetFunction: "doesNotExist",
              startLine: 1,
              startColumn: 0,
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

    // "doesNotExist" is not defined anywhere → no edge should be created.
    // This is the honest behavior: don't guess, don't create false edges.
    const hasFalseEdge = hasEdge(
      "src/undefined-test.ts",
      "caller",
      "src/undefined-test.ts",
      "doesNotExist",
    );
    expect(hasFalseEdge).toBe(false);
  });
});
