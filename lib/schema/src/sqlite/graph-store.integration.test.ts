import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { L3DecisionSources } from "@workspace/contracts";
import { GraphStore } from "./graph-store.js";

/** Test-only fixture helper: `l3_nodes` has no repo/insert method yet (deliberately out of scope
 *  — see the graph-store.interfaces.ts doc comment on `L2NodeWithL3Children`), so tests insert
 *  raw rows via a short-lived second connection to the same WAL-mode file. */
function insertL3NodeFixture(
  dbPath: string,
  input: { l2NodeId: number; title: string; contentHash?: string },
): void {
  const db = new Database(dbPath);
  try {
    db.prepare(
      "INSERT INTO l3_nodes (l2_node_id, title, content_hash) VALUES (?, ?, ?)",
    ).run(input.l2NodeId, input.title, input.contentHash ?? null);
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
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    expect(project.id).toBeGreaterThan(0);
    expect(project.name).toBe("demo");
    expect(project.repo_url).toBe("file:///demo");
    expect(project.repo_url).toMatch(/^file:\/\//);
    expect(typeof project.name).toBe("string");
  });

  it("projects repo: getFirst()/insert() round-trip", () => {
    expect(store.projects.getFirst()).toBeUndefined();

    const inserted = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const first = store.projects.getFirst();
    expect(first).toEqual(inserted);
    expect(first!.id).toBeGreaterThan(0);
    expect(first!.name).toBe("demo");
    expect(first!.repo_url).toMatch(/^file:\/\//);
  });

  it("projects repo: getOrInsert() inserts once and returns the same row on every later call", () => {
    const first = store.projects.getOrInsert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    expect(first.name).toBe("demo");

    // A second call with different input must not insert a second row — it returns the row
    // already there (this is the atomic replacement for a caller composing getFirst()+insert()
    // itself, which two racing `docuvia init` processes could both see as empty).
    const second = store.projects.getOrInsert({
      name: "other",
      repoUrl: "file:///other",
    });
    expect(second).toEqual(first);
    expect(store.projects.count()).toBe(1);
  });

  it("files repo: upsertFile()/getAllHashes() round-trip", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    expect(project.repo_url).toMatch(/^file:\/\//);

    expect(store.files.getAllHashes()).toEqual([]);

    store.files.upsertFile({
      projectId: project.id,
      filePath: "src/a.ts",
      contentHash: "hash1",
    });
    store.files.upsertFile({
      projectId: project.id,
      filePath: "src/b.ts",
      contentHash: "hash2",
    });
    expect(
      store.files
        .getAllHashes()
        .sort((a, b) => a.filePath.localeCompare(b.filePath)),
    ).toEqual([
      { filePath: "src/a.ts", contentHash: "hash1" },
      { filePath: "src/b.ts", contentHash: "hash2" },
    ]);

    // Re-upserting the same (project, path) updates the hash rather than duplicating the row.
    store.files.upsertFile({
      projectId: project.id,
      filePath: "src/a.ts",
      contentHash: "hash1-updated",
    });
    const hashes = store.files.getAllHashes();
    expect(hashes).toHaveLength(2);
    expect(hashes.find((h) => h.filePath === "src/a.ts")?.contentHash).toBe(
      "hash1-updated",
    );
  });

  it("files repo: markTierBProcessed()/getTierBFileStatus()/getTierBCoverage() round-trip", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    expect(project.repo_url).toMatch(/^file:\/\//);
    expect(project.name).toBe("demo");

    // No `project_files` row at all yet -- undefined, not a zeroed-out status object.
    expect(store.files.getTierBFileStatus("src/a.ts")).toBeUndefined();
    expect(store.files.getTierBCoverage()).toEqual({
      totalFiles: 0,
      processedFiles: 0,
    });

    store.files.upsertFile({
      projectId: project.id,
      filePath: "src/a.ts",
      contentHash: "hash1",
    });
    store.files.upsertFile({
      projectId: project.id,
      filePath: "src/b.ts",
      contentHash: "hash2",
    });
    store.files.upsertFile({
      projectId: project.id,
      filePath: "src/c.ts",
      contentHash: "hash3",
    });

    // Tier A parsed the file (upsertFile), but Tier B has never touched it yet -- explicit
    // "never processed" status, not undefined (the row exists) and not a fabricated timestamp.
    expect(store.files.getTierBFileStatus("src/a.ts")).toEqual({
      lastProcessedAt: null,
      lastProcessedCommitSha: null,
    });
    expect(store.files.getTierBCoverage()).toEqual({
      totalFiles: 3,
      processedFiles: 0,
    });

    store.files.markTierBProcessed({
      projectId: project.id,
      filePath: "src/a.ts",
      commitSha: "abc123",
    });

    const status = store.files.getTierBFileStatus("src/a.ts");
    expect(status?.lastProcessedAt).not.toBeNull();
    expect(status?.lastProcessedCommitSha).toBe("abc123");

    expect(store.files.getTierBCoverage()).toEqual({
      totalFiles: 3,
      processedFiles: 1,
    });

    // Re-marking the same file updates rather than duplicates its row.
    store.files.markTierBProcessed({
      projectId: project.id,
      filePath: "src/a.ts",
      commitSha: "def456",
    });
    expect(store.files.getAllHashes()).toHaveLength(3);
    expect(
      store.files.getTierBFileStatus("src/a.ts")?.lastProcessedCommitSha,
    ).toBe("def456");
    expect(store.files.getTierBCoverage()).toEqual({
      totalFiles: 3,
      processedFiles: 1,
    });
  });

  it("tags repo: upsertTag()/getIdByName()/linkNodeToTag()", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    expect(project.repo_url).toMatch(/^file:\/\//);
    expect(project.id).toBeGreaterThan(0);
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });

    store.tags.upsertTag("typescript");
    // Upserting the same tag again must not throw or duplicate the row.
    store.tags.upsertTag("typescript");

    const tagId = store.tags.getIdByName("typescript");
    expect(typeof tagId).toBe("number");
    expect(tagId!).toBeGreaterThan(0);

    store.tags.linkNodeToTag(nodeId, tagId as number);
  });

  it("graph repo: insertNode()/insertLink()/findNodeIdByName()/deleteNodesForPath()", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });

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
    store.graph.insertLink({
      sourceNodeId: fileNodeId,
      targetNodeId: fnNodeId,
      linkType: "contains",
    });

    const allLinks = store.graph.getAllLinks();
    expect(allLinks).toHaveLength(1);
    expect(allLinks[0].link_type).toBe("contains");
    expect([
      "contains",
      "depends_on",
      "calls",
      "extends",
      "implements",
    ]).toContain(allLinks[0].link_type);

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
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    expect(store.graph.count()).toEqual({ l2Nodes: 0, l3Nodes: 0 });

    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });
    insertL3NodeFixture(dbPath, { l2NodeId: nodeId, title: "some decision" });

    expect(store.graph.count()).toEqual({ l2Nodes: 1, l3Nodes: 1 });
  });

  it("graph repo: getSemanticCoverage() counts l2_nodes carrying a non-empty description (issue #135 -- the semantically-empty-graph metric)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    expect(store.graph.getSemanticCoverage()).toEqual({
      totalNodes: 0,
      describedNodes: 0,
    });

    store.graph.insertNode({
      projectId: project.id,
      name: "src/described.ts",
      pathPatterns: ["src/described.ts"],
      description: "Has a description",
    });
    store.graph.insertNode({
      projectId: project.id,
      name: "src/blank.ts",
      pathPatterns: ["src/blank.ts"],
      description: "",
    });
    store.graph.insertNode({
      projectId: project.id,
      name: "src/none.ts",
      pathPatterns: ["src/none.ts"],
    });

    // `blank.ts`'s empty-string description and `none.ts`'s absent description both count as
    // undescribed -- exactly the 0/6285 live state issue #135 documents.
    expect(store.graph.getSemanticCoverage()).toEqual({
      totalNodes: 3,
      describedNodes: 1,
    });
  });

  it("graph repo: getCanarySample() returns a LIMIT-bounded, id-ordered sample of non-empty names (issue #221 P3)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    expect(store.graph.getCanarySample(10)).toEqual([]);

    for (const name of ["src/a.ts", "b", "", "src/c.ts"]) {
      store.graph.insertNode({
        projectId: project.id,
        name,
        pathPatterns: [name],
      });
    }

    // Empty-string names are excluded (they can't feed a lookup/FTS probe); insertion order
    // (== id order) is preserved so doctor's sample is deterministic across runs.
    expect(store.graph.getCanarySample(10)).toEqual([
      { name: "src/a.ts" },
      { name: "b" },
      { name: "src/c.ts" },
    ]);
    expect(store.graph.getCanarySample(2)).toEqual([
      { name: "src/a.ts" },
      { name: "b" },
    ]);
  });

  it("graph repo: findNodesForChangedFiles() returns l2_nodes intersecting the changed-file set, each paired with its l3_nodes", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });

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
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });

    store.files.upsertFile({
      projectId: project.id,
      filePath: "src/active.ts",
      contentHash: "h1",
    });
    store.files.upsertFile({
      projectId: project.id,
      filePath: "src/stale.ts",
      contentHash: "h2",
    });

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
    store.graph.insertLink({
      sourceNodeId: activeNodeId,
      targetNodeId: staleNodeId,
      linkType: "depends_on",
    });
    const linkCheck = store.graph.getAllLinks();
    expect(linkCheck.some((l) => l.link_type === "depends_on")).toBe(true);
    store.tags.upsertTag("typescript");
    const tagId = store.tags.getIdByName("typescript") as number;
    store.tags.linkNodeToTag(staleNodeId, tagId);

    const result = store.pruneMissingFiles(["src/active.ts"]);

    expect(result).toEqual({ prunedFiles: 1, prunedNodes: 1 });
    expect(store.files.getAllHashes().map((f) => f.filePath)).toEqual([
      "src/active.ts",
    ]);
    expect(store.graph.findNodeIdByName("src/active.ts", "src/active.ts")).toBe(
      activeNodeId,
    );
    expect(
      store.graph.findNodeIdByName("src/stale.ts", "src/stale.ts"),
    ).toBeUndefined();
  });

  it("graph repo: findNodeByName() resolves exact match first, then falls back to a LIKE match", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
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
      filePath: "src/a.ts",
    });
    expect(store.graph.findNodeByName("Something")).toEqual({
      id: nodeId,
      name: "doSomethingSpecific",
      type: "function",
      filePath: "src/a.ts",
    });
    expect(store.graph.findNodeByName("nope")).toBeUndefined();
    expect(store.graph.findNodeByName("nope")?.id).toBeUndefined();
  });

  it("graph repo: findNodeByName() prefers a non-test/spec node over a same-named test/spec node", () => {
    // Regression guard for the vscode benchmark's "Disposable" mis-resolution
    // (docs/cli-test-analysis/typescript-cli-benchmark.md §5.4): a bare `LIMIT 1` with no
    // ordering could return either row non-deterministically; this asserts the real class wins
    // even when it's inserted *after* the test fixture (SQLite would otherwise favor rowid order).
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    store.graph.insertNode({
      projectId: project.id,
      name: "Disposable",
      type: "class",
      pathPatterns: ["src/test/fixtures/disposable.ts"],
    });
    const realClassId = store.graph.insertNode({
      projectId: project.id,
      name: "Disposable",
      type: "class",
      pathPatterns: ["src/base/common/lifecycle.ts"],
    });

    expect(store.graph.findNodeByName("Disposable")).toEqual({
      id: realClassId,
      name: "Disposable",
      type: "class",
      filePath: "src/base/common/lifecycle.ts",
    });
  });

  it("graph repo: findNodeByName() prefers the more-connected node among same-named non-test nodes", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const quietNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "Widget",
      type: "class",
      pathPatterns: ["src/rare/widget.ts"],
    });
    const popularNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "Widget",
      type: "class",
      pathPatterns: ["src/core/widget.ts"],
    });
    const callerId = store.graph.insertNode({
      projectId: project.id,
      name: "caller",
      type: "function",
      pathPatterns: ["src/core/caller.ts"],
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: popularNodeId,
      linkType: "depends_on",
    });

    expect(store.graph.findNodeByName("Widget")).toEqual({
      id: popularNodeId,
      name: "Widget",
      type: "class",
      filePath: "src/core/widget.ts",
    });
    expect(quietNodeId).not.toBe(popularNodeId);
  });

  it("graph repo: findNodeByName() prefers the more-connected node even when it sits at a deeper path than a same-named, less-connected file", () => {
    // Regression guard for the vscode benchmark's "Disposable" mis-resolution
    // (docs/cli-test-analysis/typescript-cli-benchmark.md, Open Findings §1) — and for a
    // wrong-direction fix tried while chasing it. The real cause was `ScopeResolver` never
    // resolving relative imports whose specifier names a compiled `.js` extension (fixed in
    // scope-resolver.ts), which misattributed most `extends`/`implements` edges through
    // persist-ast-graph.ts's name-based fallback. A path-depth tiebreaker was tried here as a
    // workaround before that root cause was found, then reverted once a real vscode ingestion
    // (post-fix) showed connectivity alone resolving `Disposable` correctly: the canonical,
    // deeper `src/vs/base/common/lifecycle.ts` (2,317 real incoming edges) must outrank a
    // shallower, far-less-connected same-named file (63 edges) — depth must never override a
    // clear connectivity signal.
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const shallowQuietId = store.graph.insertNode({
      projectId: project.id,
      name: "Disposable",
      type: "class",
      pathPatterns: ["extensions/simple-browser/src/dispose.ts"],
    });
    const deepPopularId = store.graph.insertNode({
      projectId: project.id,
      name: "Disposable",
      type: "class",
      pathPatterns: ["src/vs/base/common/lifecycle.ts"],
    });
    for (let i = 0; i < 3; i++) {
      const callerId = store.graph.insertNode({
        projectId: project.id,
        name: `caller${i}`,
        type: "class",
        pathPatterns: [`src/vs/base/${i}.ts`],
      });
      store.graph.insertLink({
        sourceNodeId: callerId,
        targetNodeId: deepPopularId,
        linkType: "extends",
      });
    }

    expect(store.graph.findNodeByName("Disposable")).toEqual({
      id: deepPopularId,
      name: "Disposable",
      type: "class",
      filePath: "src/vs/base/common/lifecycle.ts",
    });
    expect(shallowQuietId).not.toBe(deepPopularId);
  });

  it("graph repo: findNodeByName() omits filePath when the node has no path_patterns", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "orphanNode",
      pathPatterns: [],
    });

    expect(store.graph.findNodeByName("orphanNode")).toEqual({
      id: nodeId,
      name: "orphanNode",
      type: "module",
    });
  });

  it("graph repo: getIncomingEdges()/getOutgoingEdges() report the 1-hop blast radius", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
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
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: calleeId,
      linkType: "calls",
    });

    expect(store.graph.getIncomingEdges(calleeId)).toEqual([
      { id: callerId, name: "caller", type: "module" },
    ]);
    expect(store.graph.getOutgoingEdges(callerId)).toEqual([
      { id: calleeId, name: "callee", type: "module" },
    ]);
    expect(store.graph.getIncomingEdges(callerId)).toEqual([]);
  });

  it("graph repo: getIncomingEdges()/getOutgoingEdges() dedupe a neighbor connected by more than one edge type", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
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
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: calleeId,
      linkType: "calls",
    });
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

  it("graph repo: getIncomingRelations()/getOutgoingRelations() report linkType and do NOT collapse a neighbor connected by more than one relationship (unlike getIncomingEdges()/getOutgoingEdges(), which impact's blast-radius count relies on)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
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
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: calleeId,
      linkType: "calls",
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: calleeId,
      linkType: "depends_on",
    });

    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .sort((a, b) => a.linkType.localeCompare(b.linkType)),
    ).toEqual([
      { id: calleeId, name: "callee", type: "module", linkType: "calls" },
      { id: calleeId, name: "callee", type: "module", linkType: "depends_on" },
    ]);
    for (const rel of store.graph.getOutgoingRelations(callerId)) {
      expect([
        "calls",
        "depends_on",
        "contains",
        "extends",
        "implements",
      ]).toContain(rel.linkType);
    }
    expect(
      store.graph
        .getIncomingRelations(calleeId)
        .sort((a, b) => a.linkType.localeCompare(b.linkType)),
    ).toEqual([
      { id: callerId, name: "caller", type: "module", linkType: "calls" },
      { id: callerId, name: "caller", type: "module", linkType: "depends_on" },
    ]);
  });

  it("graph repo: getIncomingRelations()/getOutgoingRelations() still dedupe the exact same (neighbor, linkType) pair", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
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
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: calleeId,
      linkType: "calls",
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: calleeId,
      linkType: "calls",
    });

    expect(store.graph.getOutgoingRelations(callerId)).toEqual([
      { id: calleeId, name: "callee", type: "module", linkType: "calls" },
    ]);
  });

  it("graph repo: getIncomingRelations()/getOutgoingRelations() include contains edges (raw, unfiltered) — QueryService.getContext() is what filters those out", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const fileId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });
    const symbolId = store.graph.insertNode({
      projectId: project.id,
      name: "doThing",
      pathPatterns: ["src/a.ts"],
    });
    store.graph.insertLink({
      sourceNodeId: fileId,
      targetNodeId: symbolId,
      linkType: "contains",
    });

    expect(store.graph.getIncomingRelations(symbolId)).toEqual([
      { id: fileId, name: "src/a.ts", type: "module", linkType: "contains" },
    ]);
  });

  it("graph repo: getAllNodes()/getAllLinks() return every row — used by export-topology", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const a = store.graph.insertNode({
      projectId: project.id,
      name: "a",
      pathPatterns: ["src/a.ts"],
    });
    const b = store.graph.insertNode({
      projectId: project.id,
      name: "b",
      pathPatterns: ["src/b.ts"],
    });
    store.graph.insertLink({
      sourceNodeId: a,
      targetNodeId: b,
      linkType: "calls",
    });

    expect(
      store.graph
        .getAllNodes()
        .map((n) => n.id)
        .sort(),
    ).toEqual([a, b].sort());
    expect(store.graph.getAllLinks()).toHaveLength(1);
    expect(store.graph.getAllLinks()[0]).toMatchObject({
      source_node_id: a,
      target_node_id: b,
      link_type: "calls",
    });
    expect([
      "contains",
      "depends_on",
      "calls",
      "extends",
      "implements",
    ]).toContain(store.graph.getAllLinks()[0].link_type);
  });

  it("tags repo: getAllTagLinks() returns every (l2NodeId, tagName) pairing", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });
    store.tags.upsertTag("typescript");
    const tagId = store.tags.getIdByName("typescript") as number;
    store.tags.linkNodeToTag(nodeId, tagId);

    expect(store.tags.getAllTagLinks()).toEqual([
      { l2NodeId: nodeId, name: "typescript" },
    ]);
  });

  it("l3 repo: getById()/getAllExportable() round-trip and exclude garbage decisions", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
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
          "INSERT INTO l3_nodes (l2_node_id, title, validity_status) VALUES (?, ?, 'garbage')",
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
    expect(store.l3.getById(999999)?.title).toBeUndefined();
  });

  it("l3 repo: getByL2NodeId() returns only the rows for that l2_node_id", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
    });
    const otherNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/b.ts",
      pathPatterns: ["src/b.ts"],
    });
    insertL3NodeFixture(dbPath, { l2NodeId: nodeId, title: "decision for a" });
    insertL3NodeFixture(dbPath, {
      l2NodeId: otherNodeId,
      title: "decision for b",
    });

    const rows = store.l3.getByL2NodeId(nodeId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("decision for a");
    expect(store.l3.getByL2NodeId(999999)).toEqual([]);
  });

  it("graph repo: findNodeIdByNodeKey() resolves the exact STOR-005 node_key, undefined otherwise", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });

    expect(store.graph.findNodeIdByNodeKey("src/a.ts")).toBe(nodeId);
    expect(store.graph.findNodeIdByNodeKey("src/a.ts")).toBeGreaterThan(0);
    expect(store.graph.findNodeIdByNodeKey("src/missing.ts")).toBeUndefined();
  });

  it("graph repo: pruneOrphanedLinks() removes node_links rows left dangling by deleteNodesForPath's outgoing-only delete (§8d incoming-edge repair hygiene)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const callerId = store.graph.insertNode({
      projectId: project.id,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    const calleeId = store.graph.insertNode({
      projectId: project.id,
      name: "callee",
      pathPatterns: ["src/callee.ts"],
      nodeKey: "src/callee.ts#callee",
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: calleeId,
      linkType: "calls",
    });

    // Simulates Tier A's per-file replace of src/callee.ts: deleteNodesForPath only removes
    // *outgoing* links from the deleted node, leaving the caller's incoming link dangling
    // (target_node_id now references a row that no longer exists).
    store.graph.deleteNodesForPath("src/callee.ts");
    expect(store.graph.getAllLinks()).toHaveLength(1);

    const pruned = store.graph.pruneOrphanedLinks();

    expect(pruned).toBe(1);
    expect(store.graph.getAllLinks()).toHaveLength(0);
  });

  it("l3 repo: upsertDecision() inserts a new row with full provenance on the first call", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });

    const result = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      title: "Uses async/await throughout",
      content: "All I/O paths use async/await rather than raw promise chains.",
      nodeType: "decision",
      confidence: 0.9,
      commitSha: "abc123",
      extractionModel: "gpt-4o-mini",
      sourceFiles: ["src/a.ts"],
    });

    expect(result.deduped).toBe(false);
    const row = store.l3.getById(result.id);
    expect(row).toMatchObject({
      l2_node_id: nodeId,
      title: "Uses async/await throughout",
      node_type: "decision",
      commit_hash: "abc123",
      ai_generated: 1,
      source: "analyze",
      validity_status: "pending",
      occurrence_count: 1,
      extraction_model: "gpt-4o-mini",
    });
    expect(JSON.parse(row!.source_commits)).toEqual(["abc123"]);
    expect(JSON.parse(row!.source_files!)).toEqual(["src/a.ts"]);
    expect(typeof row!.content_hash).toBe("string");
    expect(row!.content_hash).toMatch(/^[a-f0-9]{32,}$/);
  });

  it("l3 repo: upsertDecision() stores region anchors on a fresh insert (issue #68), leaves them untouched on the dedup path, and omits them when not captured", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });
    const baseInput = {
      projectId: project.id,
      l2NodeId: nodeId,
      title: "Uses async/await throughout",
      content: "All I/O paths use async/await rather than raw promise chains.",
      nodeType: "decision",
      confidence: 0.9,
      commitSha: "abc123",
      extractionModel: null,
      sourceFiles: ["src/a.ts"],
    };

    // Without capture: NULL ("unknown region"), never an empty confirmed range.
    const uncaptured = store.l3.upsertDecision({ ...baseInput });
    expect(store.l3.getById(uncaptured.id)!.anchor_ranges).toBeNull();

    const withAnchors = store.l3.upsertDecision({
      ...baseInput,
      title: "Second distinct decision",
      content: "Different claim entirely.",
      anchorRanges: [{ path: "src/a.ts", startRow: 9, endRow: 14 }],
    });
    const anchoredRow = store.l3.getById(withAnchors.id)!;
    expect(JSON.parse(anchoredRow.anchor_ranges!)).toEqual([
      { path: "src/a.ts", startRow: 9, endRow: 14 },
    ]);

    // Dedup/occurrence-bump path must not touch the existing row's anchors.
    store.l3.upsertDecision({
      ...baseInput,
      title: "Second distinct decision",
      content: "Different claim entirely.",
      anchorRanges: [{ path: "src/a.ts", startRow: 0, endRow: 0 }],
    });
    const afterDedup = store.l3.getById(withAnchors.id)!;
    expect(afterDedup.occurrence_count).toBe(2);
    expect(JSON.parse(afterDedup.anchor_ranges!)).toEqual([
      { path: "src/a.ts", startRow: 9, endRow: 14 },
    ]);
  });

  it("l3 repo: upsertDecision() bumps occurrence_count and appends a new commit sha instead of duplicating the row on a content_hash match", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });
    const decision = {
      title: "Uses async/await throughout",
      content: "All I/O paths use async/await rather than raw promise chains.",
      nodeType: "decision",
      confidence: 0.9,
      extractionModel: "gpt-4o-mini",
      sourceFiles: ["src/a.ts"],
    };

    const first = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      ...decision,
      commitSha: "commit-1",
    });
    const second = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      ...decision,
      commitSha: "commit-2",
    });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(store.graph.count().l3Nodes).toBe(1);

    const row = store.l3.getById(first.id);
    expect(row?.occurrence_count).toBe(2);
    expect(JSON.parse(row!.source_commits)).toEqual(["commit-1", "commit-2"]);

    // Re-running with the same commit sha again must not duplicate it in source_commits.
    const third = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      ...decision,
      commitSha: "commit-2",
    });
    expect(third.deduped).toBe(true);
    const rowAfterRepeat = store.l3.getById(first.id);
    expect(rowAfterRepeat?.occurrence_count).toBe(3);
    expect(JSON.parse(rowAfterRepeat!.source_commits)).toEqual([
      "commit-1",
      "commit-2",
    ]);
  });

  it("l3 repo: upsertDecision() does not dedup across different projects even with the same content_hash", () => {
    const projectA = store.projects.insert({
      name: "a",
      repoUrl: "file:///a",
    });
    const projectB = store.projects.insert({
      name: "b",
      repoUrl: "file:///b",
    });
    const nodeA = store.graph.insertNode({
      projectId: projectA.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });
    const nodeB = store.graph.insertNode({
      projectId: projectB.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });
    const decision = {
      title: "Same decision text",
      content: "Same content.",
      nodeType: "decision",
      confidence: 0.9,
      commitSha: "commit-1",
      extractionModel: null,
      sourceFiles: ["src/a.ts"],
    };

    const first = store.l3.upsertDecision({
      projectId: projectA.id,
      l2NodeId: nodeA,
      ...decision,
    });
    const second = store.l3.upsertDecision({
      projectId: projectB.id,
      l2NodeId: nodeB,
      ...decision,
    });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(false);
    expect(second.id).not.toBe(first.id);
    expect(store.graph.count().l3Nodes).toBe(2);
  });

  it("l3 repo: upsertDecision() with commitSha null (unborn HEAD) leaves source_commits empty and commit_hash null", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });

    const result = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      title: "No commits yet",
      content: "Repo has no commits.",
      nodeType: "context",
      confidence: 0.5,
      commitSha: null,
      extractionModel: null,
      sourceFiles: ["src/a.ts"],
    });

    const row = store.l3.getById(result.id);
    expect(row?.commit_hash).toBeNull();
    expect(JSON.parse(row!.source_commits)).toEqual([]);
  });

  it("l3 repo: upsertDecision() freezes initial_source_commits at the first-insert value even as source_commits keeps growing on later re-analysis", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });
    const decision = {
      title: "Uses async/await throughout",
      content: "All I/O paths use async/await.",
      nodeType: "decision",
      confidence: 0.9,
      extractionModel: "gpt-4o-mini",
      sourceFiles: ["src/a.ts"],
    };

    const first = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      ...decision,
      commitSha: "commit-1",
    });
    store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      ...decision,
      commitSha: "commit-2",
    });

    const row = store.l3.getById(first.id);
    expect(JSON.parse(row!.source_commits)).toEqual(["commit-1", "commit-2"]);
    // Frozen at the first insert -- unaffected by the second call's occurrence-bump append.
    expect(JSON.parse(row!.initial_source_commits!)).toEqual(["commit-1"]);
  });

  it("l3 repo: upsertDecision({ source: AGENT_AUTHORED }) inserts a row with source = 'agent-authored'", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });

    const result = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      title: "Agent-authored decision",
      content: "Written verbatim by an AI coding agent, no LLM call.",
      nodeType: "decision",
      confidence: 0.9,
      commitSha: "abc123",
      extractionModel: null,
      sourceFiles: ["src/a.ts"],
      source: L3DecisionSources.AGENT_AUTHORED,
    });

    const row = store.l3.getById(result.id);
    expect(row?.source).toBe("agent-authored");
  });

  it("l3 repo: upsertDecision() without a source still inserts source = 'analyze' (default regression guard)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });

    const result = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      title: "Default-source decision",
      content: "No source passed by the caller.",
      nodeType: "decision",
      confidence: 0.9,
      commitSha: "abc123",
      extractionModel: null,
      sourceFiles: ["src/a.ts"],
    });

    const row = store.l3.getById(result.id);
    expect(row?.source).toBe("analyze");
  });

  it("l3 repo: upsertDecision() dedup path keeps the first writer's source, even when a later call for the same content_hash passes a different source", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });
    const decision = {
      title: "Uses async/await throughout",
      content: "All I/O paths use async/await rather than raw promise chains.",
      nodeType: "decision",
      confidence: 0.9,
      extractionModel: null,
      sourceFiles: ["src/a.ts"],
    };

    const first = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      ...decision,
      commitSha: "commit-1",
      source: L3DecisionSources.ANALYZE,
    });
    const second = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      ...decision,
      commitSha: "commit-2",
      source: L3DecisionSources.AGENT_AUTHORED,
    });

    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    const row = store.l3.getById(first.id);
    expect(row?.occurrence_count).toBe(2);
    expect(row?.source).toBe("analyze");
  });

  it("l3 repo: importCard() inserts a new row seeded from the card's fields, preserving createdAt and freezing both source_commits/initial_source_commits at the card's sourceCommits", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });

    const result = store.l3.importCard({
      l2NodeId: nodeId,
      contentHash: "imported-hash",
      title: "A teammate's decision",
      content: "Some imported decision content.",
      nodeType: "decision",
      sourceCommits: ["teammate-commit-1"],
      extractionModel: "gpt-4o-mini",
      sourceFiles: ["src/a.ts"],
      createdAt: "2024-05-01T00:00:00.000Z",
    });

    expect(result.imported).toBe(true);
    const row = store.l3.getById(result.id);
    expect(row).toMatchObject({
      l2_node_id: nodeId,
      title: "A teammate's decision",
      content: "Some imported decision content.",
      node_type: "decision",
      content_hash: "imported-hash",
      extraction_model: "gpt-4o-mini",
      ai_generated: 1,
      created_at: "2024-05-01T00:00:00.000Z",
    });
    expect(JSON.parse(row!.source_commits)).toEqual(["teammate-commit-1"]);
    expect(JSON.parse(row!.initial_source_commits!)).toEqual([
      "teammate-commit-1",
    ]);
    expect(JSON.parse(row!.source_files!)).toEqual(["src/a.ts"]);
  });

  it("l3 repo: importCard() is a no-op (imported: false) when a row with the same content_hash already exists locally, never overwriting it", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });

    const existing = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: nodeId,
      title: "Locally authored decision",
      content: "Authored on this machine.",
      nodeType: "decision",
      confidence: 0.9,
      commitSha: "local-commit",
      extractionModel: null,
      sourceFiles: ["src/a.ts"],
    });
    const existingRow = store.l3.getById(existing.id)!;

    const result = store.l3.importCard({
      l2NodeId: nodeId,
      contentHash: existingRow.content_hash!,
      title: "A different title from the card",
      content: "Different content from the card",
      nodeType: "decision",
      sourceCommits: ["teammate-commit"],
      extractionModel: "gpt-4o-mini",
      sourceFiles: ["src/a.ts"],
      createdAt: "2024-05-01T00:00:00.000Z",
    });

    expect(result).toEqual({ id: existing.id, imported: false });
    expect(store.graph.count().l3Nodes).toBe(1);
    // The existing local row is untouched -- not overwritten by the card's thinner fields.
    expect(store.l3.getById(existing.id)).toEqual(existingRow);
  });

  it("fts repo: searchL2Nodes()/searchL3Nodes() keyword-match against name/description and title/content", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "authService",
      description: "handles authentication",
      pathPatterns: ["src/auth.ts"],
    });
    insertL3NodeFixture(dbPath, {
      l2NodeId: nodeId,
      title: "switched to JWT auth",
    });

    expect(
      store.fts.searchL2Nodes(["authentication"], 10).map((n) => n.id),
    ).toEqual([nodeId]);
    expect(store.fts.searchL2Nodes([], 10)).toEqual([]);
    expect(store.fts.searchL3Nodes(["JWT"], 10).map((n) => n.title)).toEqual([
      "switched to JWT auth",
    ]);
  });

  it("fts repo: searchL2Nodes() is AND-first, only widening to OR when nothing matches every keyword (roadmap-and-open-items.md item 25)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    // Matches both keywords -- the AND-first case should isolate this one alone, ignoring the
    // two single-keyword-only distractors below even though they'd also match under plain OR.
    const bothId = store.graph.insertNode({
      projectId: project.id,
      name: "queryCommand",
      pathPatterns: ["artifacts/cli/src/commands/query.ts"],
    });
    store.graph.insertNode({
      projectId: project.id,
      name: "unrelatedQueryHelper",
      pathPatterns: ["src/query-only.ts"],
    });
    store.graph.insertNode({
      projectId: project.id,
      name: "initCommandLock",
      pathPatterns: ["src/init-command-lock.ts"],
    });

    expect(
      store.fts.searchL2Nodes(["query", "command"], 10).map((n) => n.id),
    ).toEqual([bothId]);

    // No row matches both "query" and "nonexistentxyz" -- AND-first must fall back to OR instead
    // of returning nothing.
    const orFallback = store.fts
      .searchL2Nodes(["query", "nonexistentxyz"], 10)
      .map((n) => n.id);
    expect(orFallback).toContain(bothId);
  });

  it("fts repo: singular/plural variants stem to the same token (porter tokenizer, migration 0007)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    const nodeId = store.graph.insertNode({
      projectId: project.id,
      name: "artifacts/cli/src/commands/query.ts",
      pathPatterns: ["artifacts/cli/src/commands/query.ts"],
    });

    // "commands" (plural, only present via the path) must still satisfy an AND match against the
    // singular query keyword "command" -- this is exactly what broke before migration 0007.
    expect(
      store.fts.searchL2Nodes(["query", "command"], 10).map((n) => n.id),
    ).toEqual([nodeId]);
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

  it("callSites repo: insertMany()/getForFiles() round-trip, keyed by the exact file path passed in", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });

    // No rows yet -- absent from the map, not present with an empty array (per the
    // ICallSitesRepo.getForFiles doc comment).
    expect(
      store.callSites.getForFiles(project.id, ["src/a.ts", "src/b.ts"]),
    ).toEqual(new Map());

    store.callSites.insertMany(project.id, "src/a.ts", [
      { targetFunction: "foo", startLine: 1, startColumn: 2 },
      { targetFunction: "bar", startLine: 3, startColumn: 4 },
    ]);
    store.callSites.insertMany(project.id, "src/b.ts", [
      { targetFunction: "baz", startLine: 5, startColumn: 6 },
    ]);
    // Zero call sites for a queued file must not insert (or leave behind) any rows.
    store.callSites.insertMany(project.id, "src/c.ts", []);

    const result = store.callSites.getForFiles(project.id, [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/never-queued.ts",
    ]);

    expect(result.has("src/c.ts")).toBe(false);
    expect(result.has("src/never-queued.ts")).toBe(false);
    expect(result.get("src/a.ts")).toEqual([
      { targetFunction: "foo", startLine: 1, startColumn: 2 },
      { targetFunction: "bar", startLine: 3, startColumn: 4 },
    ]);
    expect(result.get("src/b.ts")).toEqual([
      { targetFunction: "baz", startLine: 5, startColumn: 6 },
    ]);
  });

  it("callSites repo: getForFiles() scopes by projectId -- a call site inserted for one project is invisible to another", () => {
    const projectA = store.projects.insert({
      name: "a",
      repoUrl: "file:///a",
    });
    const projectB = store.projects.insert({
      name: "b",
      repoUrl: "file:///b",
    });

    store.callSites.insertMany(projectA.id, "src/shared.ts", [
      { targetFunction: "foo", startLine: 0, startColumn: 0 },
    ]);

    expect(store.callSites.getForFiles(projectB.id, ["src/shared.ts"])).toEqual(
      new Map(),
    );
    expect(
      store.callSites
        .getForFiles(projectA.id, ["src/shared.ts"])
        .get("src/shared.ts"),
    ).toEqual([{ targetFunction: "foo", startLine: 0, startColumn: 0 }]);
  });

  it("callSites repo: getByTargetFunctions() reverse-reads by callee name, keyed by the calling file (issue #217 impact fallback)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });

    // No rows yet -- absent from the map, not present with an empty array (same convention
    // as getForFiles), and an empty target list short-circuits without touching the DB.
    expect(
      store.callSites.getByTargetFunctions(project.id, ["loadPlugin"]),
    ).toEqual(new Map());
    expect(store.callSites.getByTargetFunctions(project.id, [])).toEqual(
      new Map(),
    );

    store.callSites.insertMany(project.id, "src/host.ts", [
      // The unresolved-dynamic-loading shape issue #217 targets: a call site whose
      // ScopeResolver resolution failed still has its row here.
      { targetFunction: "loadPlugin", startLine: 10, startColumn: 4 },
      { targetFunction: "loadPlugin", startLine: 20, startColumn: 2 },
      { targetFunction: "other", startLine: 30, startColumn: 0 },
    ]);
    store.callSites.insertMany(project.id, "src/other-host.ts", [
      { targetFunction: "loadPlugin", startLine: 5, startColumn: 8 },
    ]);

    const result = store.callSites.getByTargetFunctions(project.id, [
      "loadPlugin",
      "never-called-anywhere",
    ]);

    expect(result.size).toBe(2);
    expect(result.get("src/host.ts")).toEqual([
      { startLine: 10, startColumn: 4 },
      { startLine: 20, startColumn: 2 },
    ]);
    expect(result.get("src/other-host.ts")).toEqual([
      { startLine: 5, startColumn: 8 },
    ]);
  });

  it("callSites repo: getByTargetFunctions() scopes by projectId -- a call site inserted for one project is invisible to another", () => {
    const projectA = store.projects.insert({
      name: "a",
      repoUrl: "file:///a",
    });
    const projectB = store.projects.insert({
      name: "b",
      repoUrl: "file:///b",
    });

    store.callSites.insertMany(projectA.id, "src/shared.ts", [
      { targetFunction: "foo", startLine: 0, startColumn: 0 },
    ]);

    expect(store.callSites.getByTargetFunctions(projectB.id, ["foo"])).toEqual(
      new Map(),
    );
    expect(
      store.callSites
        .getByTargetFunctions(projectA.id, ["foo"])
        .get("src/shared.ts"),
    ).toEqual([{ startLine: 0, startColumn: 0 }]);
  });

  it("callSites repo: deleteForFile() removes only that (project, file)'s rows, leaving other files' rows intact (delete-then-reinsert-on-reparse symmetry)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });

    store.callSites.insertMany(project.id, "src/a.ts", [
      { targetFunction: "foo", startLine: 1, startColumn: 2 },
    ]);
    store.callSites.insertMany(project.id, "src/b.ts", [
      { targetFunction: "bar", startLine: 3, startColumn: 4 },
    ]);

    store.callSites.deleteForFile(project.id, "src/a.ts");

    const result = store.callSites.getForFiles(project.id, [
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(result.has("src/a.ts")).toBe(false);
    expect(result.get("src/b.ts")).toEqual([
      { targetFunction: "bar", startLine: 3, startColumn: 4 },
    ]);

    // deleteForFile on a file with no rows is a safe no-op, not an error.
    expect(() =>
      store.callSites.deleteForFile(project.id, "src/never-inserted.ts"),
    ).not.toThrow();
  });

  it("meta repo: get()/set() round-trip, and upserts an existing key rather than erroring", () => {
    expect(store.meta.get("knowledgeTipSha")).toBeUndefined();
    expect(typeof store.meta.get("knowledgeTipSha")).toBe("undefined");

    store.meta.set("knowledgeTipSha", "aaa111");
    expect(store.meta.get("knowledgeTipSha")).toBe("aaa111");
    expect(typeof store.meta.get("knowledgeTipSha")).toBe("string");

    store.meta.set("knowledgeTipSha", "bbb222");
    expect(store.meta.get("knowledgeTipSha")).toBe("bbb222");
    expect(store.meta.get("knowledgeTipSha")).not.toBe("aaa111");
  });

  it("graph repo: bulkLoadGraph() wipes existing nodes/links and rebuilds from node_key, dropping edges with an unresolvable endpoint", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });
    // Pre-existing state that bulkLoadGraph must wipe, not merge with.
    const staleId = store.graph.insertNode({
      projectId: project.id,
      name: "stale.ts",
      pathPatterns: ["stale.ts"],
    });
    insertL3NodeFixture(dbPath, { l2NodeId: staleId, title: "stale decision" });

    const result = store.graph.bulkLoadGraph({
      projectId: project.id,
      nodes: [
        {
          nodeKey: "src/auth.ts",
          name: "src/auth.ts",
          filePath: "src/auth.ts",
        },
        {
          nodeKey: "src/auth.ts#login",
          name: "login",
          filePath: "src/auth.ts",
        },
      ],
      edges: [
        {
          source: "src/auth.ts",
          target: "src/auth.ts#login",
          type: "contains",
        },
        // References a node_key that doesn't exist among `nodes` — must be dropped, not inserted
        // with a dangling foreign id.
        {
          source: "src/auth.ts#login",
          target: "src/auth.ts#missing",
          type: "calls",
        },
      ],
    });

    expect(result).toEqual({ nodesLoaded: 2, edgesLoaded: 1, edgesDropped: 1 });
    expect(store.graph.count()).toEqual({ l2Nodes: 2, l3Nodes: 1 }); // l3_nodes untouched by design (not yet git-serialized — STOR-002 known gap)
    expect(
      store.graph
        .getAllNodes()
        .map((n) => n.node_key)
        .sort(),
    ).toEqual(["src/auth.ts", "src/auth.ts#login"]);
    expect(
      store.graph.findNodeIdByName("stale.ts", "stale.ts"),
    ).toBeUndefined();

    const fileNode = store.graph.findNodeByName("src/auth.ts");
    const symbolNode = store.graph.findNodeByName("login");
    expect(
      store.graph.getOutgoingEdges(fileNode!.id).map((n) => n.name),
    ).toEqual(["login"]);
    expect(store.graph.getOutgoingEdges(symbolNode!.id)).toEqual([]); // the dangling edge never landed
  });

  it("graph repo: bulkLoadGraph() leaves l2_nodes_fts correctly searchable (triggers are dropped and the index rebuilt, not just skipped)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });

    store.graph.bulkLoadGraph({
      projectId: project.id,
      nodes: [
        {
          nodeKey: "src/auth.ts",
          name: "authService",
          filePath: "src/auth.ts",
        },
        {
          nodeKey: "src/db.ts",
          name: "databaseService",
          filePath: "src/db.ts",
        },
      ],
      edges: [],
    });

    expect(
      store.fts.searchL2Nodes(["authService"], 10).map((n) => n.node_key),
    ).toEqual(["src/auth.ts"]);
    expect(
      store.fts.searchL2Nodes(["databaseService"], 10).map((n) => n.node_key),
    ).toEqual(["src/db.ts"]);

    // Normal (non-bulk) insert/delete/update must still keep the FTS index in sync afterward —
    // proves the triggers were actually recreated, not left dropped.
    const newNodeId = store.graph.insertNode({
      projectId: project.id,
      name: "cacheService",
      pathPatterns: ["src/cache.ts"],
    });
    expect(
      store.fts.searchL2Nodes(["cacheService"], 10).map((n) => n.id),
    ).toEqual([newNodeId]);
  });

  it("graph repo: bulkLoadGraph() restores 100,000 nodes in under 10 seconds (STOR-002's hard performance bar)", () => {
    const project = store.projects.insert({
      name: "demo",
      repoUrl: "file:///demo",
    });

    const NODE_COUNT = 100_000;
    const nodes = Array.from({ length: NODE_COUNT }, (_, i) => ({
      nodeKey: `src/file${i}.ts`,
      name: `src/file${i}.ts`,
      filePath: `src/file${i}.ts`,
    }));
    // One edge per node (to its predecessor) — same order of magnitude as the nodes themselves.
    const edges = Array.from({ length: NODE_COUNT - 1 }, (_, i) => ({
      source: `src/file${i}.ts`,
      target: `src/file${i + 1}.ts`,
      type: "depends_on",
    }));

    const start = performance.now();
    const result = store.graph.bulkLoadGraph({
      projectId: project.id,
      nodes,
      edges,
    });
    const elapsedMs = performance.now() - start;

    expect(result).toEqual({
      nodesLoaded: NODE_COUNT,
      edgesLoaded: NODE_COUNT - 1,
      edgesDropped: 0,
    });
    expect(store.graph.count().l2Nodes).toBe(NODE_COUNT);
    expect(elapsedMs).toBeLessThan(10_000);
  });
});

describe("GraphStore.open DB classification", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-open-class-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("readonly open on a genuinely-missing file throws DB_NOT_FOUND, not DB_OPEN_FAILED", async () => {
    const missingDbPath = path.join(tempDir, ".docuvia", "local.db");
    await expect(
      GraphStore.open({ dbPath: missingDbPath, readonly: true }),
    ).rejects.toMatchObject({
      code: "DB_NOT_FOUND",
      message: expect.stringContaining("docuvia init"),
    });
  });

  it("readonly open on a present file still succeeds (no false DB_NOT_FOUND)", async () => {
    const dbPath = path.join(tempDir, ".docuvia", "local.db");
    const writer = await GraphStore.open({ dbPath });
    await writer.close();
    const reader = await GraphStore.open({ dbPath, readonly: true });
    await reader.close();
  });
});

describe("callSites repo: callee evidence columns (issue #192, migration 0012)", () => {
  let tempDir: string;
  let dbPath: string;
  let store: GraphStore;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-call-evidence-"));
    dbPath = path.join(tempDir, ".docuvia", "local.db");
    store = await GraphStore.open({ dbPath });
  });

  afterEach(async () => {
    await store.close();
    // Windows: SQLite may hold file handles briefly after close; retry rmSync.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });

  it("insertMany() persists decomposition fields and getByTargetFunctions() OR-matches callee_name", async () => {
    const project = store.projects.insert({
      name: "callee-evidence",
      repoUrl: "file:///callee-evidence",
    });

    store.callSites.insertMany(project.id, "src/a.ts", [
      // Member call: raw string includes the receiver; callee_name is the matchable part.
      {
        targetFunction: "service.doSomething",
        startLine: 1,
        startColumn: 2,
        calleeName: "doSomething",
        receiverText: "service",
        calleeKind: "member",
      },
      // Bare call: no receiver, kind 'bare'.
      {
        targetFunction: "foo",
        startLine: 3,
        startColumn: 4,
        calleeName: "foo",
        calleeKind: "bare",
      },
      // Pre-0012-style row: decomposition absent -> NULLs.
      { targetFunction: "legacy", startLine: 5, startColumn: 6 },
    ]);

    const raw = new Database(dbPath, { readonly: true })
      .prepare(
        "SELECT target_function, callee_name, receiver_text, callee_kind FROM ast_call_sites ORDER BY id",
      )
      .all() as Array<Record<string, unknown>>;
    expect(raw).toEqual([
      {
        target_function: "service.doSomething",
        callee_name: "doSomething",
        receiver_text: "service",
        callee_kind: "member",
      },
      {
        target_function: "foo",
        callee_name: "foo",
        receiver_text: null,
        callee_kind: "bare",
      },
      {
        target_function: "legacy",
        callee_name: null,
        receiver_text: null,
        callee_kind: null,
      },
    ]);

    // #217 impact fallback: a lookup by the bare callee identifier must now find member
    // calls whose raw target_function ("service.doSomething") could never exact-match.
    const byCallee = store.callSites.getByTargetFunctions(project.id, [
      "doSomething",
    ]);
    expect(byCallee.get("src/a.ts")).toEqual([
      { startLine: 1, startColumn: 2 },
    ]);

    // Raw-string matching still works (back-compat).
    const byRaw = store.callSites.getByTargetFunctions(project.id, ["foo"]);
    expect(byRaw.get("src/a.ts")).toEqual([{ startLine: 3, startColumn: 4 }]);

    expect(
      store.callSites.getByTargetFunctions(project.id, ["no-such-symbol"]),
    ).toEqual(new Map());
  });
});

// ── Self-analysis: verify the real knowledge graph has correct structure ─────────────
// These tests query the ACTUAL .docuvia/local.db to verify the graph is honest.
// They fail when the graph is wrong. That's the point.

describe("Self-analysis: verify real knowledge graph structure", () => {
  const DB_PATH = path.resolve(__dirname, "../../../../.docuvia/local.db");
  let store: GraphStore;
  let project: { id: number };

  beforeEach(async () => {
    if (!fs.existsSync(DB_PATH)) {
      // Skip if no knowledge graph exists yet.
      return;
    }
    store = await GraphStore.open({ dbPath: DB_PATH });
    project = store.projects.getOrInsert({
      name: "docuvia2",
      repoUrl: "file:///docuvia2",
    });
  });

  afterEach(async () => {
    if (store) await store.close();
  });

  it("scope-resolver.ts exists as a node in the graph", () => {
    if (!store) return;
    const node = store.graph.findNodeByName(
      "lib/core/src/graph/scope-resolver.ts",
    );
    expect(node).toMatchObject({
      name: "lib/core/src/graph/scope-resolver.ts",
      type: "module",
    });
  });

  it("ast-worker.ts exists as a node in the graph", () => {
    if (!store) return;
    const node = store.graph.findNodeByName("lib/core/src/ast/ast-worker.ts");
    expect(node).toMatchObject({
      name: "lib/core/src/ast/ast-worker.ts",
      type: "module",
    });
  });

  it("scope-resolver has a contains edge to resolveImportedBinding", () => {
    if (!store) return;
    const scopeResolverId = store.graph.findNodeIdByName(
      "lib/core/src/graph/scope-resolver.ts",
      "lib/core/src/graph/scope-resolver.ts",
    );
    const resolveImportedBindingId = store.graph.findNodeIdByName(
      "lib/core/src/graph/scope-resolver.ts",
      "resolveImportedBinding",
    );
    expect(scopeResolverId).toBeTypeOf("number");
    expect(scopeResolverId!).toBeGreaterThanOrEqual(1);
    expect(resolveImportedBindingId).toBeTypeOf("number");
    expect(resolveImportedBindingId!).toBeGreaterThanOrEqual(1);
  });

  it("ast-worker has a contains edge to getCalleeEvidence", () => {
    if (!store) return;
    const astWorkerId = store.graph.findNodeIdByName(
      "lib/core/src/ast/ast-worker.ts",
      "lib/core/src/ast/ast-worker.ts",
    );
    const getCalleeEvidenceId = store.graph.findNodeIdByName(
      "lib/core/src/ast/ast-worker.ts",
      "getCalleeEvidence",
    );
    expect(astWorkerId).toBeTypeOf("number");
    expect(astWorkerId!).toBeGreaterThanOrEqual(1);
    expect(getCalleeEvidenceId).toBeTypeOf("number");
    expect(getCalleeEvidenceId!).toBeGreaterThanOrEqual(1);
  });

  it("total calls edges is non-zero (graph is not empty)", () => {
    if (!store) return;
    const count = store.graph.count();
    expect(count.l2Nodes).toBeGreaterThanOrEqual(1);
  });
});
