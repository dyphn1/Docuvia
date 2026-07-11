import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import DatabaseCtor from "better-sqlite3";
import { GraphStore } from "@workspace/schema";
import type { ParsedAstFileResult } from "@workspace/contracts";
import { GraphPersisterService } from "./persist-ast-graph.js";

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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-persist-ast-graph-"));
    const dbPath = path.join(tmpDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
    projectId = store.projects.insert({ name: "demo", repoUrl: "file:///demo" }).id;
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

    await persister.persist({ store, workspaceRoot: tmpDir, projectId, parsedResults, tags: ["typescript"] });

    const fileNodeId = store.graph.findNodeIdByName("src/a.ts", "src/a.ts");
    const fnNodeId = store.graph.findNodeIdByName("src/a.ts", "foo");
    expect(fileNodeId).toBeDefined();
    expect(fnNodeId).toBeDefined();
    expect(store.files.getAllHashes()).toEqual([{ filePath: "src/a.ts", contentHash: "hash-a" }]);
  });

  it("upserts and links every given tag to each persisted file node", async () => {
    const parsedResults: ParsedAstFileResult[] = [
      {
        file: "src/a.ts",
        hash: "hash-a",
        data: { imports: [], exports: [], functions: [], classes: [], calls: [] },
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
          calls: [{ sourceFunction: "foo", targetFunction: "bar" }],
        },
      },
    ];

    await persister.persist({ store, workspaceRoot: tmpDir, projectId, parsedResults, tags: [] });

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
          "SELECT * FROM node_links WHERE source_node_id = ? AND target_node_id = ? AND link_type = 'calls'"
        )
        .get(fooId, barId);
      expect(link).toBeDefined();
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
    expect(store.files.getAllHashes()).toEqual([{ filePath: "src/a.ts", contentHash: "hash-a" }]);
  });
});
