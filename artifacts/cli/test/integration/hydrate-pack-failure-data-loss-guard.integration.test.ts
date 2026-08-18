import { describe, it, expect } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  docuviaMemory,
  docuviaFactory,
  TOKENS,
  MemoryKeys,
  createMockLogger,
  type IGitProvider,
} from "@workspace/contracts";
import { docuviaApi, resolveDbPath } from "@workspace/ui-core";
import { GraphStore } from "@workspace/schema";
import { GitLocalProvider } from "@workspace/git-local";
import { GitConstants } from "@workspace/contracts";
import "../../src/registration.js";

const execFileAsync = promisify(execFile);

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string }> {
  return execFileAsync("git", args, { cwd });
}
// A thin spy around a real GitLocalProvider (per the plan's own explicit allowance -- the point
// under test is Docuvia's own reaction to a pack failure, not git fast-import's internal Windows
// crash mechanics): every method delegates to the real provider except packDirectoryToBranch,
// which reproduces this session's actual reported root cause (see the implementation plan's
// section on the unresolved crash mechanics): git fast-import partially completing (advancing the
// knowledge branch ref to a valid-but-empty-tree commit) before crashing, rather than simply
// leaving the ref untouched. A plain rejection with no ref movement would not reproduce the
// reported bug at all -- isStale() would stay false and hydrate() would never even be triggered.
function makeBreakingGitProvider(real: IGitProvider): IGitProvider {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "packDirectoryToBranch") {
        return async (
          cwd: string,
          _sourceDir: string,
          branchName: string,
          commitMessage: string,
        ) => {
          const emptySha = await target.commitEmptyTree(cwd, commitMessage);
          await target.updateBranchRef(cwd, branchName, emptySha);
          throw new Error(
            "simulated git fast-import crash STATUS_DLL_INIT_FAILED",
          );
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
// Real, short-lived read-write GraphStore connection, mirroring
// l3-distribution.integration.test.ts's insertDecision helper -- inserts count synthetic L2 nodes
// directly, simulating a subsequent analyze/init-style local write that happened after the last
// successful knowledge-branch pack.
async function insertExtraNodes(dbPath: string, count: number): Promise<void> {
  const store = await GraphStore.open({ dbPath });
  try {
    const project = store.projects.getFirst();
    if (!project) throw new Error("insertExtraNodes: no project row found");
    for (let i = 0; i < count; i++) {
      store.graph.insertNode({
        projectId: project.id,
        name: "extra-" + i + ".ts",
        pathPatterns: ["extra-" + i + ".ts"],
      });
    }
  } finally {
    await store.close();
  }
}

async function readMeta(
  dbPath: string,
  key: string,
): Promise<string | undefined> {
  const store = await GraphStore.open({ dbPath, readonly: true });
  try {
    return store.meta.get(key);
  } finally {
    await store.close();
  }
}

async function readL2NodeCount(dbPath: string): Promise<number> {
  const store = await GraphStore.open({ dbPath, readonly: true });
  try {
    return store.graph.count().l2Nodes;
  } finally {
    await store.close();
  }
}
// Real-repo regression coverage for the 2026-08 vscode-scale data-loss finding
// (docs/ai_plans/implement_hydration-pack-failure-data-loss-guard.md section 5.3): "local write
// succeeds, pack fails, next read-path command runs" against a small synthetic repo -- the
// deterministic, fast equivalent of the real ~292,770-node repro, using a real temp git repo, a
// real GraphStore, and a real GitLocalProvider (only packDirectoryToBranch is spied for the one
// simulated failure), exactly as the plan's section 5.3 calls for.
describe("HydrationService.hydrate() destructive-rebuild guard: real pack-failure repro", () => {
  it("refuses to wipe local.db when this workspace's own last knowledge-branch pack attempt failed to land", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-pack-failure-guard-"),
    );
    const scopeId = "pack-failure-guard-test";

    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "fixture-project" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "src", "index.ts"),
      'export function hello(): string {\n  return "world";\n}\n',
      "utf8",
    );

    await runGit(tmpDir, ["init"]);
    await runGit(tmpDir, ["config", "user.name", "Test User"]);
    await runGit(tmpDir, ["config", "user.email", "test@example.com"]);
    await runGit(tmpDir, ["add", "-A"]);
    await runGit(tmpDir, ["commit", "-m", "initial"]);

    docuviaMemory.createScope(scopeId);
    docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, tmpDir);

    const logger = createMockLogger();
    const dbPath = resolveDbPath(tmpDir);
    try {
      // Step 1: a real init -- creates the knowledge branch, parses+persists the fixture, packs
      // the initial graph onto the branch, and (per this plan's own reordering fix) marks synced
      // only after that pack succeeds. Establishes a baseline where git and local.db agree.
      const initResult = await docuviaApi.init(scopeId, logger);
      expect(initResult.success).toBe(true);

      const baselineNodes = await readL2NodeCount(dbPath);
      expect(baselineNodes).toBeGreaterThan(0);

      // Step 2: a subsequent local write (simulating a later analyze run) that has NOT yet been
      // packed onto the knowledge branch.
      const EXTRA_NODES = 10;
      await insertExtraNodes(dbPath, EXTRA_NODES);
      const totalNodes = await readL2NodeCount(dbPath);
      expect(totalNodes).toBe(baselineNodes + EXTRA_NODES);

      // Force the next pack attempt to fail exactly like the reported Windows git fast-import
      // crash: the branch ref still advances (to a valid-but-empty-tree commit) before the
      // failure surfaces to Docuvia's own code.
      docuviaFactory.register(TOKENS.GitProvider, () =>
        makeBreakingGitProvider(new GitLocalProvider()),
      );

      await expect(docuviaApi.snapshot(scopeId, logger)).rejects.toThrow(
        "simulated git fast-import crash",
      );
      // The pack attempt failed -- the pending-write flag must be left "true" (pack-current-graph.ts
      // sets it before attempting the pack and only clears it on success).
      expect(
        await readMeta(dbPath, GitConstants.META_KEY_KNOWLEDGE_PACK_PENDING),
      ).toBe("true");

      // Restore the real (working) git provider -- a subsequent read-path command (e.g. the next
      // status/query) would not know anything about the broken one above.
      docuviaFactory.register(TOKENS.GitProvider, () => new GitLocalProvider());

      // Step 3: exactly what ensureHydrated() does on every read-path command -- isStale() then,
      // if true, hydrate().
      const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, {
        logger,
      });

      const store = await GraphStore.open({ dbPath, readonly: false });
      try {
        expect(await hydrationService.isStale(tmpDir, store)).toBe(true);

        const hydrateResult = await hydrationService.hydrate(tmpDir, store);

        expect(hydrateResult.refused).toBe(true);
        expect(hydrateResult.refusalReason).toBe("pending-local-write");
      } finally {
        await store.close();
      }

      // The regression is pinned: local.db's node count is unchanged, not wiped to 0.
      expect(await readL2NodeCount(dbPath)).toBe(totalNodes);
    } finally {
      docuviaFactory.register(TOKENS.GitProvider, () => new GitLocalProvider());
      docuviaMemory.deleteScope(scopeId);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});
