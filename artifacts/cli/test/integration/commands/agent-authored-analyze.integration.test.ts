import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { TestSandbox } from "../../support/sandbox.js";

const FIXTURE_FILES = {
  "package.json": JSON.stringify({ name: "fixture-project" }),
  "src/index.ts": "export function hello(): string {\n  return 'world';\n}\n",
};

function queryL3Rows(dbPath: string): Array<{ source: string; title: string }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare("SELECT source, title FROM l3_nodes ORDER BY title")
      .all() as Array<{ source: string; title: string }>;
  } finally {
    db.close();
  }
}

/**
 * End-to-end coverage for `analyze <targetPath> --agent-authored` (issue #42, roadmap items
 * 32-34): a real temp git repo, a real `init` (populated graph), a real CLI subprocess piping/
 * reading a decisions JSON payload, and a direct `local.db` query -- the same shape
 * `l3-distribution.integration.test.ts` uses for its own real `store.l3.upsertDecision` path.
 */
describe("analyze <targetPath> --agent-authored (issue #42): real end-to-end write path", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists a valid stdin payload with source='agent-authored' and prints the standard decisionExtraction summary", async () => {
    const sandbox = new TestSandbox();
    await sandbox.setup({ initGit: true, files: FIXTURE_FILES });
    tempDirs.push(sandbox.dir);
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    const payload = JSON.stringify({
      decisions: [
        {
          title: "Uses named exports throughout",
          content: "This module exports functions by name, not default.",
          nodeType: "decision",
          confidence: 0.9,
        },
      ],
    });

    const analyzeResult = await sandbox.runCli(
      ["analyze", "src/index.ts", "--agent-authored"],
      { reject: false, input: payload },
    );

    expect(analyzeResult.exitCode).toBe(0);
    // ora's spinner.succeed() writes to stderr by default -- printFocusedResult()'s per-decision
    // lines (ui.info/ui.log -> console.log) land on stdout.
    expect(analyzeResult.stderr).toContain("Decision extraction complete.");
    expect(analyzeResult.stdout).toContain(
      "Uses named exports throughout (decision, confidence: 0.9)",
    );
    expect(analyzeResult.stdout).toContain("1 persisted, 0 deduplicated");

    const dbPath = path.resolve(sandbox.dir, ".docuvia/local.db");
    const rows = queryL3Rows(dbPath);
    expect(rows).toEqual([
      { source: "agent-authored", title: "Uses named exports throughout" },
    ]);
  }, 120000);

  it("persists a valid --decisions-file payload with source='agent-authored'", async () => {
    const sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        ...FIXTURE_FILES,
        "decisions.json": JSON.stringify({
          decisions: [
            {
              title: "From a file, not stdin",
              content: "content",
              nodeType: "rule",
              confidence: 0.5,
            },
          ],
        }),
      },
    });
    tempDirs.push(sandbox.dir);
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    const analyzeResult = await sandbox.runCli(
      [
        "analyze",
        "src/index.ts",
        "--agent-authored",
        "--decisions-file=decisions.json",
      ],
      { reject: false },
    );

    expect(analyzeResult.exitCode).toBe(0);

    const dbPath = path.resolve(sandbox.dir, ".docuvia/local.db");
    const rows = queryL3Rows(dbPath);
    expect(rows).toEqual([
      { source: "agent-authored", title: "From a file, not stdin" },
    ]);
  }, 120000);

  it("hard-fails (non-zero exit, clear error) on an invalid nodeType instead of silently coercing it, and persists nothing", async () => {
    const sandbox = new TestSandbox();
    await sandbox.setup({ initGit: true, files: FIXTURE_FILES });
    tempDirs.push(sandbox.dir);
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    const badPayload = JSON.stringify({
      decisions: [
        {
          title: "Bad decision",
          content: "content",
          nodeType: "not-a-real-type",
          confidence: 0.9,
        },
      ],
    });

    const analyzeResult = await sandbox.runCli(
      ["analyze", "src/index.ts", "--agent-authored"],
      { reject: false, input: badPayload },
    );

    expect(analyzeResult.exitCode).not.toBe(0);
    expect(analyzeResult.stderr + analyzeResult.stdout).toContain(
      "does not match the expected shape",
    );

    const dbPath = path.resolve(sandbox.dir, ".docuvia/local.db");
    expect(queryL3Rows(dbPath)).toEqual([]);
  }, 120000);
});
