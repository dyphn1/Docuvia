import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphStore } from "./graph-store.js";

// TDD-SOURCE: lib/contracts/src/interfaces/graph-store.interfaces.ts

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("Phase 4 GraphStore hardening", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: GraphStore | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-phase4-store-"));
    dbPath = path.join(tmpDir, ".docuvia", "local.db");
  });

  afterEach(async () => {
    if (store) await store.close();
    store = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("[happy] round-trips graph nodes and links identically through a readonly reopen", async () => {
    store = await GraphStore.open({ dbPath });
    const projectId = store.projects.insert({
      name: "phase4",
      repoUrl: "file:///phase4",
    }).id;
    const sourceId = store.graph.insertNode({
      projectId,
      name: "src/a.ts",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts",
    });
    const targetId = store.graph.insertNode({
      projectId,
      name: "helper",
      pathPatterns: ["src/a.ts"],
      nodeKey: "src/a.ts#helper",
    });
    store.graph.insertLink({
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      linkType: "contains",
    });

    const before = {
      nodes: store.graph.getAllNodes(),
      links: store.graph.getAllLinks(),
    };

    await store.close();
    store = await GraphStore.open({ dbPath, readonly: true });

    expect({
      nodes: store.graph.getAllNodes(),
      links: store.graph.getAllLinks(),
    }).toEqual(before);
  });

  it("[invalid-input] rejects a malformed database path before opening SQLite", async () => {
    await expect(GraphStore.open({ dbPath: "" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("[error-handling][state-diff] rolls back the complete graph write when a transaction callback throws", async () => {
    store = await GraphStore.open({ dbPath });
    const projectId = store.projects.insert({
      name: "phase4",
      repoUrl: "file:///phase4",
    }).id;
    const beforeCount = store.graph.count();
    const beforeNodeKeys = store.graph
      .getAllNodes()
      .map((node) => node.node_key)
      .sort();

    expect(() =>
      store!.withTransaction(() => {
        store!.graph.insertNode({
          projectId,
          name: "should-not-survive",
          pathPatterns: ["src/rollback.ts"],
          nodeKey: "src/rollback.ts",
        });
        throw new Error("phase4 rollback probe");
      }),
    ).toThrow("phase4 rollback probe");

    expect(store.graph.count()).toEqual(beforeCount);
    expect(
      store.graph
        .getAllNodes()
        .map((node) => node.node_key)
        .sort(),
    ).toEqual(beforeNodeKeys);
    expect(
      store.graph.getAllNodes().map((node) => node.node_key),
    ).not.toContain("src/rollback.ts");
  });

  it("[stress] serializes queued GraphStore writers deterministically and releases the lock", async () => {
    store = await GraphStore.open({ dbPath });
    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = store.withWriteLock(async () => {
      events.push("first:start");
      await gate;
      events.push("first:end");
    });
    await tick();

    const second = store.withWriteLock(async () => {
      events.push("second");
    });
    await tick();

    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:end", "second"]);

    await expect(store.withWriteLock(async () => "reacquired")).resolves.toBe(
      "reacquired",
    );
  });
});
