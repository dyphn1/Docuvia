import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphStore } from "./graph-store.js";

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
