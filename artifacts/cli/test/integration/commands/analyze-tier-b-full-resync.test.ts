import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";

/**
 * End-to-end scenario for the Tier B full-resync + "not yet processed" coverage hint
 * (docs/ai_plans/implement_tier-b-full-resync.md §9.4; typescript-cli-benchmark.md §5.3/§5.7
 * items 1-2). Real CLI process, real `local.db`, real `query --format=prompt` rendering.
 *
 * No `typescript-language-server` is resolvable inside this sandbox (confirmed precedent
 * throughout this suite -- see analyze-escalate-lsp-degradation.test.ts's own doc comment), so a
 * genuine `analyze --escalate-to-lsp --full` run in this environment always degrades honestly
 * (`checkAvailability()` fails before any file is attempted) and never calls
 * `markTierBProcessed` for any file -- there is no way to observe real edge resolution here,
 * exactly like every other Tier B integration test in this suite. What *is* exercised for real
 * through the actual CLI process:
 *   1. `--full` queues every currently-tracked file (not just what a prior ingestion queued),
 *      verified via the real `analyze.tierB.full_resync_queued` JSONL line against the real
 *      `project_files` row count.
 *   2. The "unprocessed" coverage hint (`resolveTierBCoverageHint` -> `query.service.ts` ->
 *      `query.ts`'s XML rendering) appears for real once `init` has parsed files but before any
 *      Tier B batch has ever succeeded, and disappears once every tracked file's
 *      `last_tier_b_processed_at` is set -- the second half is driven by a direct `project_files`
 *      write standing in for "a `--full` run against a real LSP just succeeded" (the same
 *      raw-SQLite-seeding pattern this suite's own degradation/concurrency tests already use for
 *      states a real LSP-less sandbox can't otherwise produce), so the hint's disappearance is
 *      exercised through the real `query` CLI process and real SQLite state, not re-implemented
 *      in-memory.
 */
describe("Command: docuvia analyze --escalate-to-lsp --full + docuvia query's Tier B coverage hint (real filesystem)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "package.json": JSON.stringify({ name: "fixture-project" }),
        "src/a.ts": "export function helper(): string {\n  return 'hi';\n}\n",
        "src/b.ts":
          "import { helper } from './a.js';\n\nexport function caller(): string {\n  return helper();\n}\n",
      },
    });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("shows the unprocessed hint before any Tier B batch has succeeded, queues every tracked file on --full, then the hint disappears once every file is (simulated as) Tier B-processed", async () => {
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    const countProjectFiles = (): number => {
      const db = new Database(dbPath, { readonly: true });
      try {
        return (
          db.prepare("SELECT COUNT(*) as c FROM project_files").get() as {
            c: number;
          }
        ).c;
      } finally {
        db.close();
      }
    };

    // 1. Before any Tier B batch has ever succeeded: init's own Tier A parse never resolves
    // cross-file `calls` edges (that's Tier B's job), and no file has a `last_tier_b_processed_at`
    // stamp yet -- both directions read as "not yet processed", not "confirmed zero".
    const beforeResult = await sandbox.runCli(
      ["query", "helper", "--format=prompt"],
      { reject: false },
    );
    expect(beforeResult.exitCode).toBe(0);
    expect(beforeResult.stdout).toContain('tier_b_status="unprocessed"');
    expect(beforeResult.stdout).toContain("--escalate-to-lsp --full");

    // 2. --full queues every currently-tracked file, not just whatever init's own full-ingestion
    // queueing already staged -- verified against the real project_files row count.
    const totalTrackedFiles = countProjectFiles();
    expect(totalTrackedFiles).toBeGreaterThanOrEqual(2);

    const fullResult = await sandbox.runCli(
      ["analyze", "--escalate-to-lsp", "--full", "--fallback-ast"],
      { reject: false },
    );
    expect(fullResult.exitCode).toBe(0);

    const logPath = resolve(sandbox.dir, ".docuvia/logs/analyze.log");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const fullResyncLine = lines.find(
      (l) => l.event === "analyze.tierB.full_resync_queued",
    );
    expect(fullResyncLine).toBeDefined();
    expect(fullResyncLine!.event).toBe("analyze.tierB.full_resync_queued");
    expect(fullResyncLine.filesQueued).toBe(totalTrackedFiles);

    // 3. Simulate a --full run that *did* have a real LSP available (this sandbox has none --
    // see this file's own doc comment) by stamping every tracked file as Tier B-processed
    // directly, mirroring this suite's existing precedent of seeding docuvia_meta/local.db state
    // a real LSP-less sandbox can't otherwise produce.
    const db = new Database(dbPath);
    try {
      db.prepare(
        "UPDATE project_files SET last_tier_b_processed_at = CURRENT_TIMESTAMP, last_tier_b_commit_sha = 'simulated'",
      ).run();
    } finally {
      db.close();
    }

    const afterResult = await sandbox.runCli(
      ["query", "helper", "--format=prompt"],
      { reject: false },
    );
    expect(afterResult.exitCode).toBe(0);
    expect(afterResult.stdout).not.toContain("tier_b_status");
  }, 90000);
});
