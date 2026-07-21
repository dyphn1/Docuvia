import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { GraphStore } from "@workspace/schema";
import { TestSandbox } from "../../support/sandbox.js";

const execFileAsync = promisify(execFile);

const FIXTURE_FILES = {
  "package.json": JSON.stringify({ name: "fixture-project" }),
  "src/index.ts": "export function hello(): string {\n  return 'world';\n}\n",
};
const FIXTURE_NODE_KEY = "src/index.ts";

async function git(cwd: string, args: string[]): Promise<{ stdout: string }> {
  return execFileAsync("git", args, { cwd });
}

/**
 * Inserts an L3 decision via the real `GraphStore`/`L3NodesRepo.upsertDecision` path (the same
 * write path `analyze <targetPath>` uses) against `dbPath`'s already-`init`-ed local.db, anchored
 * on `FIXTURE_NODE_KEY`'s L2 node. Returns the row's `content_hash`, so tests can assert on the
 * exact `knowledge/_l3/<content_hash>.md` card the next `snapshot` produces.
 */
async function insertDecision(
  dbPath: string,
  input: { title: string; content: string; commitSha: string | null },
): Promise<{ contentHash: string }> {
  const store = await GraphStore.open({ dbPath });
  try {
    const project = store.projects.getFirst();
    if (!project) throw new Error("insertDecision: no project row found");
    const l2NodeId = store.graph.findNodeIdByNodeKey(FIXTURE_NODE_KEY);
    if (l2NodeId === undefined) {
      throw new Error(
        `insertDecision: no l2_nodes row for node_key "${FIXTURE_NODE_KEY}" -- init's ingestion shape may have changed`,
      );
    }
    const result = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId,
      title: input.title,
      content: input.content,
      nodeType: "decision",
      confidence: 0.9,
      commitSha: input.commitSha,
      extractionModel: "test-model",
      sourceFiles: [FIXTURE_NODE_KEY],
    });
    const row = store.l3.getById(result.id)!;
    return { contentHash: row.content_hash! };
  } finally {
    await store.close();
  }
}

function listL3CardPaths(
  repoDir: string,
  branch = "docuvia-knowledge",
): Promise<string[]> {
  return git(repoDir, ["ls-tree", "-r", "--name-only", branch]).then(
    ({ stdout }) =>
      stdout
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.startsWith("knowledge/_l3/")),
  );
}

function queryL3Titles(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db.prepare("SELECT title FROM l3_nodes ORDER BY title").all() as {
        title: string;
      }[]
    ).map((r) => r.title);
  } finally {
    db.close();
  }
}

describe("L3 distribution (phase2-l3-distribution.md): git-branch round trip", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fresh single-developer round trip: a locally-written L3 decision survives snapshot -> real git clone -> hydrate", async () => {
    const sandbox = new TestSandbox();
    await sandbox.setup({ initGit: true, files: FIXTURE_FILES });
    tempDirs.push(sandbox.dir);
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);
    const { stdout: headSha } = await sandbox.runGit(["rev-parse", "HEAD"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    const dbPath = path.resolve(sandbox.dir, ".docuvia/local.db");
    const { contentHash } = await insertDecision(dbPath, {
      title: "Uses named exports throughout",
      content: "This module exports functions by name, not default.",
      commitSha: headSha.trim(),
    });

    const snapshotResult = await sandbox.runCli(["snapshot"], {
      reject: false,
    });
    expect(snapshotResult.exitCode).toBe(0);

    // The card landed on the knowledge branch under knowledge/_l3/<content_hash>.md.
    const cardPaths = await listL3CardPaths(sandbox.dir);
    expect(cardPaths).toEqual([`knowledge/_l3/${contentHash}.md`]);
    const { stdout: cardContent } = await git(sandbox.dir, [
      "show",
      `docuvia-knowledge:knowledge/_l3/${contentHash}.md`,
    ]);
    expect(cardContent).toContain('"l2_path": "knowledge/src/index.ts.md"');
    expect(cardContent).toContain(
      "This module exports functions by name, not default.",
    );

    // Real `git clone` -- a genuinely fresh clone with no local.db of its own yet. `git clone`
    // only materializes a local branch for the checked-out default branch; docuvia-knowledge
    // lands as a remote-tracking ref only (`refs/remotes/origin/docuvia-knowledge`), so a
    // real developer's next step is `sync-knowledge` (which adopts it as a local branch, per
    // KnowledgeGitService's "no local copy existed" fast-forward case) before `hydrate` has
    // anything under `refs/heads/docuvia-knowledge` to resolve against -- this is pre-existing
    // STOR-002 behavior, not specific to L3.
    const cloneDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-l3dist-clone-"),
    );
    tempDirs.push(cloneDir);
    await execFileAsync("git", ["clone", sandbox.dir, cloneDir]);

    const cloneSandbox = new TestSandbox();
    cloneSandbox.dir = cloneDir;

    expect(
      (await cloneSandbox.runCli(["sync-knowledge"], { reject: false }))
        .exitCode,
    ).toBe(0);

    const hydrateResult = await cloneSandbox.runCli(["hydrate"], {
      reject: false,
    });
    expect(hydrateResult.exitCode).toBe(0);

    // hydrate() bulk-loads L2 into l2_nodes and, in the very same write-locked step, imports
    // the L3 card that resolves against those freshly-hydrated node_key rows (L3DIST-007) --
    // no separate step the clone has to know about beyond the standard sync-knowledge/hydrate
    // pair.
    const cloneDbPath = path.resolve(cloneDir, ".docuvia/local.db");
    const titles = queryL3Titles(cloneDbPath);
    expect(titles).toEqual(["Uses named exports throughout"]);
  }, 120000);
});

describe("L3 distribution: two-diverged-branches merge (Tree-Adoption) survives L3 from both sides", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("L3DIST-005/006/007's self-healing dance (sync-knowledge's import + a follow-up snapshot) recovers the merge-losing side's card, not just the newest-commit-wins side", async () => {
    const remoteDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-l3dist-remote-"),
    );
    tempDirs.push(remoteDir);
    await execFileAsync("git", ["init", "--bare", remoteDir]);

    // Developer A: independent workspace, own knowledge branch, own decision.
    const devA = new TestSandbox();
    await devA.setup({ initGit: true, files: FIXTURE_FILES });
    tempDirs.push(devA.dir);
    await devA.runGit(["add", "-A"]);
    await devA.runGit(["commit", "-m", "initial (A)"]);
    const { stdout: headShaA } = await devA.runGit(["rev-parse", "HEAD"]);
    await devA.runGit(["remote", "add", "origin", remoteDir]);

    expect((await devA.runCli(["init"], { reject: false })).exitCode).toBe(0);
    const dbPathA = path.resolve(devA.dir, ".docuvia/local.db");
    const decisionA = await insertDecision(dbPathA, {
      title: "Decision A: named exports",
      content: "Developer A's independently-authored decision.",
      commitSha: headShaA.trim(),
    });
    expect((await devA.runCli(["snapshot"], { reject: false })).exitCode).toBe(
      0,
    );
    // Publish A's knowledge branch first -- the remote's only copy so far.
    await devA.runGit(["push", "origin", "docuvia-knowledge"]);

    // Developer B: a *separate* workspace that never fetched A's knowledge branch before its
    // own `init` -- genuinely independent root commits on `docuvia-knowledge`, the real
    // Tree-Adoption divergence scenario (not a fast-forward).
    const devB = new TestSandbox();
    await devB.setup({ initGit: true, files: FIXTURE_FILES });
    tempDirs.push(devB.dir);
    await devB.runGit(["add", "-A"]);
    await devB.runGit(["commit", "-m", "initial (B)"]);
    const { stdout: headShaB } = await devB.runGit(["rev-parse", "HEAD"]);
    await devB.runGit(["remote", "add", "origin", remoteDir]);

    expect((await devB.runCli(["init"], { reject: false })).exitCode).toBe(0);
    const dbPathB = path.resolve(devB.dir, ".docuvia/local.db");
    const decisionB = await insertDecision(dbPathB, {
      title: "Decision B: named exports (independent)",
      content: "Developer B's independently-authored decision.",
      commitSha: headShaB.trim(),
    });
    expect((await devB.runCli(["snapshot"], { reject: false })).exitCode).toBe(
      0,
    );

    // B's docuvia-knowledge and A's (already on the remote) are genuinely diverged root
    // commits -- sync-knowledge must fall through to a tree-adoption merge. This picks ONE
    // side's tree wholesale (STOR-001 point 3) and pushes the merge commit back, so only the
    // *winning* side's card is guaranteed to be in the merged tree/import at this point --
    // asserted structurally below (whichever side won) rather than assuming a fixed winner.
    const syncResultB = await devB.runCli(["sync-knowledge"], {
      reject: false,
    });
    expect(syncResultB.exitCode).toBe(0);

    const cardPathsAfterMerge = (await listL3CardPaths(devB.dir)).sort();
    expect(cardPathsAfterMerge).toHaveLength(1);
    expect([
      `knowledge/_l3/${decisionA.contentHash}.md`,
      `knowledge/_l3/${decisionB.contentHash}.md`,
    ]).toContainEqual(cardPathsAfterMerge[0]);

    // L3DIST-005/006/007's self-healing dance for whichever side lost that merge: the merge
    // commit's *other* parent is that side's own prior tip (STOR-001 point 3's tree-adoption
    // merge always parents on both `localSha`/`remoteSha`), so that side's next
    // `sync-knowledge` is a plain fast-forward (never another divergence) -- and its L3-import
    // step (run as part of that same call, §3 wiring) absorbs the winner's card into its local
    // `l3_nodes`, alongside its own card that was never lost from local.db to begin with. Its
    // very next `snapshot` then re-renders that now-complete union back onto the branch,
    // restoring the loser's card the merge dropped from the tree -- without either side ever
    // needing to know who "won".
    const syncResultA = await devA.runCli(["sync-knowledge"], {
      reject: false,
    });
    expect(syncResultA.exitCode).toBe(0);

    const titlesAfterSyncA = queryL3Titles(dbPathA).sort();
    expect(titlesAfterSyncA).toEqual(
      [
        "Decision A: named exports",
        "Decision B: named exports (independent)",
      ].sort(),
    );

    expect((await devA.runCli(["snapshot"], { reject: false })).exitCode).toBe(
      0,
    );

    const cardPathsAfterHeal = (await listL3CardPaths(devA.dir)).sort();
    expect(cardPathsAfterHeal).toEqual(
      [decisionA.contentHash, decisionB.contentHash]
        .map((hash) => `knowledge/_l3/${hash}.md`)
        .sort(),
    );
  }, 180000);
});
