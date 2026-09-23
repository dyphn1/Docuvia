import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync } from "fs";
import { GitConstants } from "@workspace/contracts";
import { GraphStore } from "@workspace/schema";
import { TestSandbox } from "../support/sandbox.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

interface RestoredState {
  projects: number;
  l2Nodes: number;
  totalFiles: number;
  processedFiles: number;
  lastIngestedSourceSha: string | undefined;
}

async function readState(sandbox: TestSandbox): Promise<RestoredState> {
  const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
  const store = await GraphStore.open({ dbPath, readonly: true });
  try {
    const coverage = store.files.getTierBCoverage();
    return {
      projects: store.projects.count(),
      l2Nodes: store.graph.count().l2Nodes,
      totalFiles: coverage.totalFiles,
      processedFiles: coverage.processedFiles,
      lastIngestedSourceSha: store.meta.get(
        GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      ),
    };
  } finally {
    await store.close();
  }
}

// Test-category coverage for this end-to-end persistence regression:
 // [happy] the normal snapshot -> clean -> status/hydrate path succeeds.
 // [invalid-input] clean deliberately removes local.db, so the read path starts from missing local state.
 // [error-handling] status/ensureHydrated self-heals that missing state from the knowledge branch.
 // [stress] forced hydration is repeated to prove metadata restoration stays stable across rebuilds.
 // [state-diff] every restored metric is compared byte-for-value with the pre-clean baseline.
describe("hydrate metadata round-trip (real CLI / git / SQLite)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "package.json": JSON.stringify({ name: "hydrate-metadata-fixture" }),
        "src/a.ts": "export const a = 1;\n",
        "src/b.ts": "export const b = 2;\n",
      },
    });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await sandbox.teardown();
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  it(
    "preserves project count, Tier-B coverage, graph rows, and freshness across snapshot -> clean -> status/hydrate",
    async () => {
      const init = await sandbox.runCli(["init"], { reject: false });
      expect(init.exitCode).toBe(0);

      const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
      const head = (await sandbox.runGit(["rev-parse", "HEAD"])).stdout.trim();

      // Exercise both sides of Tier-B coverage: one processed file and at least one
      // still-unprocessed file. The exact timestamp must survive the round-trip too.
      const writable = await GraphStore.open({ dbPath, readonly: false });
      let processedPath = "";
      try {
        const project = writable.projects.getFirst();
        expect(project).toBeDefined();

        const files = writable.files.getAllHashes();
        expect(files.length).toBeGreaterThanOrEqual(2);
        processedPath = files[0].filePath;
        writable.files.markTierBProcessed({
          projectId: project!.id,
          filePath: processedPath,
          commitSha: head,
          processedAt: "2026-09-23 12:00:00",
        });
      } finally {
        await writable.close();
      }

      const baseline = await readState(sandbox);
      expect(baseline.projects).toBe(1);
      expect(baseline.l2Nodes).toBeGreaterThan(0);
      expect(baseline.totalFiles).toBeGreaterThanOrEqual(2);
      expect(baseline.processedFiles).toBe(1);
      expect(baseline.lastIngestedSourceSha).toBe(head);

      const snapshot = await sandbox.runCli(["snapshot"], { reject: false });
      expect(snapshot.exitCode).toBe(0);

      const clean = await sandbox.runCli(["clean"], { reject: false });
      expect(clean.exitCode).toBe(0);
      expect(existsSync(dbPath)).toBe(false);

      // status is the real read path from #489: ensureHydrated() recreates local.db
      // from the knowledge branch before status opens its readonly connection.
      const status = await sandbox.runCli(["status"], { reject: false });
      expect(status.exitCode).toBe(0);

      const restored = await readState(sandbox);
      expect(restored).toEqual(baseline);

      const restoredStore = await GraphStore.open({
        dbPath,
        readonly: true,
      });
      try {
        expect(restoredStore.files.getTierBFileStatus(processedPath)).toEqual({
          lastProcessedAt: "2026-09-23 12:00:00",
          lastProcessedCommitSha: head,
        });
      } finally {
        await restoredStore.close();
      }

      // Explicit forced hydration must remain idempotent for the metadata covered by #489.
      for (let i = 0; i < 3; i++) {
        const hydrate = await sandbox.runCli(["hydrate", "--force"], {
          reject: false,
        });
        expect(hydrate.exitCode).toBe(0);
        expect(await readState(sandbox)).toEqual(baseline);
      }
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
