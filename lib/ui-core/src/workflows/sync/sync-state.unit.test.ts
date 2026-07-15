import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  loadSyncState,
  saveSyncState,
  withSyncStateLock,
} from "./sync-state.js";

describe("sync-state", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-sync-state-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadSyncState returns an empty object when the file doesn't exist yet", async () => {
    expect(await loadSyncState(tmpDir)).toEqual({});
  });

  it("round-trips state through save then load", async () => {
    await saveSyncState(tmpDir, {
      "proj-1": { syncedContentHashes: ["a", "b"] },
    });

    expect(await loadSyncState(tmpDir)).toEqual({
      "proj-1": { syncedContentHashes: ["a", "b"] },
    });
  });

  it("withSyncStateLock serializes concurrent load-mutate-save cycles instead of racing", async () => {
    // Regression test for a real bug: loadSyncState()/saveSyncState() used to have no lock, so
    // two concurrent load→mutate→save cycles on the same file could both load the same initial
    // state and the second save would silently clobber the first's update, losing an entry.
    // Each run below sleeps between load and save specifically to force that race window open;
    // if withSyncStateLock didn't actually serialize the two calls, one hash would be lost.
    const runOne = async (hash: string): Promise<void> => {
      await withSyncStateLock(tmpDir, async () => {
        const state = await loadSyncState(tmpDir);
        const project = state["proj-1"] ?? { syncedContentHashes: [] };
        await new Promise((resolve) => setTimeout(resolve, 20));
        project.syncedContentHashes = [...project.syncedContentHashes, hash];
        state["proj-1"] = project;
        await saveSyncState(tmpDir, state);
      });
    };

    await Promise.all([runOne("hash-a"), runOne("hash-b")]);

    const finalState = await loadSyncState(tmpDir);
    expect(finalState["proj-1"].syncedContentHashes.slice().sort()).toEqual([
      "hash-a",
      "hash-b",
    ]);
  }, 10_000);

  it("withSyncStateLock releases the lock file after the callback resolves", async () => {
    await withSyncStateLock(tmpDir, async () => {});

    // A second acquisition must not block/timeout if the first one released cleanly.
    await expect(withSyncStateLock(tmpDir, async () => "ok")).resolves.toBe(
      "ok",
    );
  });

  it("withSyncStateLock releases the lock file even when the callback throws", async () => {
    await expect(
      withSyncStateLock(tmpDir, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Lock must have been released despite the throw — otherwise every subsequent sync would
    // hang/time out waiting on a lock nobody will ever release.
    await expect(withSyncStateLock(tmpDir, async () => "ok")).resolves.toBe(
      "ok",
    );
  });
});
