import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphStore } from "./graph-store.js";

/** Test-only fixture helper: `l3_nodes` has no repo/insert method yet (deliberately out of scope
 *  — see the graph-store.interfaces.ts doc comment on `L2NodeWithL3Children`), so tests insert
 *  raw rows via a short-lived second connection to the same WAL-mode file. */
function insertL3NodeFixture(
  dbPath: string,
  input: { l2NodeId: number; title: string; contentHash?: string }
): void {
  const db = new Database(dbPath);
  try {
    db.prepare("INSERT INTO l3_nodes (l2_node_id, title, content_hash) VALUES (?, ?, ?)").run(
      input.l2NodeId,
      input.title,
      input.contentHash ?? null
    );
  } finally {
    db.close();
  }
}

describe("GraphStore (integration, real temp SQLite file)", () => {
  let tempDir: string;
  let dbPath: string;
  let store: GraphStore;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-graph-store-"));
    dbPath = path.join(tempDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("applies the schema on open", () => {
    // Exercised indirectly: a fresh temp file with no pre-existing schema
    // must already support inserts against every table the pilot touches.
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    expect(project.id).toBeGreaterThan(0);
    expect(project.name).toBe("demo");
    expect(project.repo_url).toBe("file:///demo");
  });

  it("projects repo: getFirst()/insert() round-trip", () => {
    expect(store.projects.getFirst()).toBeUndefined();

    const inserted = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    const first = store.projects.getFirst();
    expect(first).toEqual(inserted);
  });

  it("files repo: upsertFile()/getAllHashes() round-trip", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });

    expect(store.files.getAllHashes()).toEqual([]);

    store.files.upsertFile({ projectId: project.id, filePath: "src/a.ts", contentHash: "hash1" });
    store.files.upsertFile({ projectId: project.id, filePath: "src/b.ts", contentHash: "hash2" });
    expect(store.files.getAllHashes().sort((a, b) => a.filePath.localeCompare(b.filePath))).toEqual([
      { filePath: "src/a.ts", contentHash: "hash1" },
      { filePath: "src/b.ts", contentHash: "hash2" },
    ]);

    // Re-upserting the same (project, path) updates the hash rather than duplicating the row.
    store.files.upsertFile({ projectId: project.id, filePath: "src/a.ts", contentHash: "hash1-updated" });
    const hashes = store.files.getAllHashes();
    expect(hashes).toHaveLength(2);
    expect(hashes.find((h) => h.filePath === "src/a.ts")?.contentHash).toBe("hash1-updated");
  });

  it("tags repo: upsertTag()/getIdByName()/linkNodeToTag()", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });

    store.tags.upsertTag("typescript");
    // Upserting the same tag again must not throw or duplicate the row.
    store.tags.upsertTag("typescript");

    const tagId = store.tags.getIdByName("typescript");
    expect(tagId).toBeDefined();

    store.tags.linkNodeToTag(nodeId, tagId as number);
  });

  it("graph repo: insertNode()/insertLink()/findNodeIdByName()/deleteNodesForPath()", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });

    const fileNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });
    const fnNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "doThing",
      pathPatterns: ["src/a.ts"],
    });
    store.graph.insertLink({ sourceNodeId: fileNodeId, targetNodeId: fnNodeId, linkType: "contains" });

    expect(store.graph.findNodeIdByName("src/a.ts", "doThing")).toBe(fnNodeId);
    expect(store.graph.findNodeIdByName("src/a.ts", "missing")).toBeUndefined();

    const deletedIds = store.graph.deleteNodesForPath("src/a.ts");
    expect(deletedIds.sort()).toEqual([fileNodeId, fnNodeId].sort());
    expect(store.graph.findNodeIdByName("src/a.ts", "doThing")).toBeUndefined();
  });

  it("projects repo: count()", () => {
    expect(store.projects.count()).toBe(0);
    store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    expect(store.projects.count()).toBe(1);
  });

  it("graph repo: count() reports l2_nodes/l3_nodes row counts", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    expect(store.graph.count()).toEqual({ l2Nodes: 0, l3Nodes: 0 });

    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });
    insertL3NodeFixture(dbPath, { l2NodeId: nodeId, title: "some decision" });

    expect(store.graph.count()).toEqual({ l2Nodes: 1, l3Nodes: 1 });
  });

  it("graph repo: findNodesForChangedFiles() returns l2_nodes intersecting the changed-file set, each paired with its l3_nodes", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });

    const changedNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });
    const unchangedNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/b.ts",
      pathPatterns: ["src/b.ts"],
    });
    insertL3NodeFixture(dbPath, {
      l2NodeId: changedNodeId,
      title: "decision on a.ts",
      contentHash: "hash-a",
    });
    insertL3NodeFixture(dbPath, {
      l2NodeId: unchangedNodeId,
      title: "decision on b.ts",
      contentHash: "hash-b",
    });

    const result = store.graph.findNodesForChangedFiles(["src/a.ts"]);

    expect(result).toHaveLength(1);
    expect(result[0].l2Node.id).toBe(changedNodeId);
    expect(result[0].l3Nodes).toHaveLength(1);
    expect(result[0].l3Nodes[0].title).toBe("decision on a.ts");
  });

  it("pruneMissingFiles() deletes stale l2_nodes/node_links/l2_node_l1_tags/project_files not in activeFiles, in one transaction", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });

    store.files.upsertFile({ projectId: project.id, filePath: "src/active.ts", contentHash: "h1" });
    store.files.upsertFile({ projectId: project.id, filePath: "src/stale.ts", contentHash: "h2" });

    const activeNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/active.ts",
      pathPatterns: ["src/active.ts"],
    });
    const staleNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/stale.ts",
      pathPatterns: ["src/stale.ts"],
    });
    store.graph.insertLink({ sourceNodeId: activeNodeId, targetNodeId: staleNodeId, linkType: "depends_on" });
    store.tags.upsertTag("typescript");
    const tagId = store.tags.getIdByName("typescript") as number;
    store.tags.linkNodeToTag(staleNodeId, tagId);

    const result = store.pruneMissingFiles(["src/active.ts"]);

    expect(result).toEqual({ prunedFiles: 1, prunedNodes: 1 });
    expect(store.files.getAllHashes().map((f) => f.filePath)).toEqual(["src/active.ts"]);
    expect(store.graph.findNodeIdByName("src/active.ts", "src/active.ts")).toBe(activeNodeId);
    expect(store.graph.findNodeIdByName("src/stale.ts", "src/stale.ts")).toBeUndefined();
  });

  it("graph repo: findNodeByName() resolves exact match first, then falls back to a LIKE match", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "doSomethingSpecific",
      type: "function",
      pathPatterns: ["src/a.ts"],
    });

    expect(store.graph.findNodeByName("doSomethingSpecific")).toEqual({
      id: nodeId,
      name: "doSomethingSpecific",
      type: "function",
    });
    expect(store.graph.findNodeByName("Something")).toEqual({
      id: nodeId,
      name: "doSomethingSpecific",
      type: "function",
    });
    expect(store.graph.findNodeByName("nope")).toBeUndefined();
  });

  it("graph repo: getIncomingEdges()/getOutgoingEdges() report the 1-hop blast radius", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    const callerId = store.graph.insertNode({
      projectId: project.id,
      name: "caller",
      pathPatterns: ["src/a.ts"],
    });
    const calleeId = store.graph.insertNode({
      projectId: project.id,
      name: "callee",
      pathPatterns: ["src/b.ts"],
    });
    store.graph.insertLink({ sourceNodeId: callerId, targetNodeId: calleeId, linkType: "calls" });

    expect(store.graph.getIncomingEdges(calleeId)).toEqual([
      { id: callerId, name: "caller", type: "module" },
    ]);
    expect(store.graph.getOutgoingEdges(callerId)).toEqual([
      { id: calleeId, name: "callee", type: "module" },
    ]);
    expect(store.graph.getIncomingEdges(callerId)).toEqual([]);
  });

  it("graph repo: getIncomingEdges()/getOutgoingEdges() dedupe a neighbor connected by more than one edge type", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    const callerId = store.graph.insertNode({
      projectId: project.id,
      name: "caller",
      pathPatterns: ["src/a.ts"],
    });
    const calleeId = store.graph.insertNode({
      projectId: project.id,
      name: "callee",
      pathPatterns: ["src/b.ts"],
    });
    // Two distinct edges between the same pair of nodes — the neighbor must still be reported
    // exactly once, not once per edge.
    store.graph.insertLink({ sourceNodeId: callerId, targetNodeId: calleeId, linkType: "calls" });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: calleeId,
      linkType: "depends_on",
    });

    expect(store.graph.getOutgoingEdges(callerId)).toEqual([
      { id: calleeId, name: "callee", type: "module" },
    ]);
    expect(store.graph.getIncomingEdges(calleeId)).toEqual([
      { id: callerId, name: "caller", type: "module" },
    ]);
  });

  it("graph repo: getAllNodes()/getAllLinks() return every row — used by export-topology", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    const a = store.graph.insertNode({ projectId: project.id, name: "a", pathPatterns: ["src/a.ts"] });
    const b = store.graph.insertNode({ projectId: project.id, name: "b", pathPatterns: ["src/b.ts"] });
    store.graph.insertLink({ sourceNodeId: a, targetNodeId: b, linkType: "calls" });

    expect(store.graph.getAllNodes().map((n) => n.id).sort()).toEqual([a, b].sort());
    expect(store.graph.getAllLinks()).toHaveLength(1);
    expect(store.graph.getAllLinks()[0]).toMatchObject({
      source_node_id: a,
      target_node_id: b,
      link_type: "calls",
    });
  });

  it("tags repo: getAllTagLinks() returns every (l2NodeId, tagName) pairing", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });
    store.tags.upsertTag("typescript");
    const tagId = store.tags.getIdByName("typescript") as number;
    store.tags.linkNodeToTag(nodeId, tagId);

    expect(store.tags.getAllTagLinks()).toEqual([{ l2NodeId: nodeId, name: "typescript" }]);
  });

  it("l3 repo: getById()/getAllExportable() round-trip and exclude garbage decisions", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });
    insertL3NodeFixture(dbPath, { l2NodeId: nodeId, title: "kept decision" });

    const db2 = new Database(dbPath);
    try {
      db2
        .prepare(
          "INSERT INTO l3_nodes (l2_node_id, title, validity_status) VALUES (?, ?, 'garbage')"
        )
        .run(nodeId, "garbage decision");
    } finally {
      db2.close();
    }

    const exportable = store.l3.getAllExportable();
    expect(exportable).toHaveLength(1);
    expect(exportable[0].title).toBe("kept decision");
    expect(store.l3.getById(exportable[0].id)?.title).toBe("kept decision");
    expect(store.l3.getById(999999)).toBeUndefined();
  });

  it("fts repo: searchL2Nodes()/searchL3Nodes() keyword-match against name/description and title/content", () => {
    const project = store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "authService",
      description: "handles authentication",
      pathPatterns: ["src/auth.ts"],
    });
    insertL3NodeFixture(dbPath, { l2NodeId: nodeId, title: "switched to JWT auth" });

    expect(store.fts.searchL2Nodes(["authentication"], 10).map((n) => n.id)).toEqual([nodeId]);
    expect(store.fts.searchL2Nodes([], 10)).toEqual([]);
    expect(store.fts.searchL3Nodes(["JWT"], 10).map((n) => n.title)).toEqual([
      "switched to JWT auth",
    ]);
  });

  it("withWriteLock() serializes concurrent writers", async () => {
    const events: string[] = [];

    const first = store.withWriteLock(async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push("first:end");
    });

    // Give the first write a chance to actually start before queuing the second.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = store.withWriteLock(() => {
      events.push("second:start");
    });

    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("close() releases the file handle: a fresh GraphStore can reopen the same file without a lock error", async () => {
    store.projects.insert({ name: "demo", repoUrl: "file:///demo" });
    await store.close();

    // Reassign so the outer afterEach's store.close() closes this instance,
    // not the already-closed one.
    store = await GraphStore.open({ dbPath });
    expect(store.projects.getFirst()?.name).toBe("demo");
  });
});
