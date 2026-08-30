import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { TestSandbox } from "../../support/sandbox.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

const FIXTURE_FILES = {
  "package.json": JSON.stringify({ name: "fixture-project" }),
  "src/index.ts": "export function hello(): string {\n  return 'world';\n}\n",
  "src/other.ts": "export function other(): string {\n  return 'other';\n}\n",
};

interface L3Row {
  source: string;
  title: string;
  commit_hash: string | null;
}

function queryL3Rows(dbPath: string): L3Row[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare("SELECT source, title, commit_hash FROM l3_nodes ORDER BY title")
      .all() as L3Row[];
  } finally {
    db.close();
  }
}

function pendingFilePath(sandboxDir: string): string {
  return path.resolve(sandboxDir, ".docuvia/pending-l3-decisions.json");
}

function readPendingDecisions(sandboxDir: string): unknown[] {
  const filePath = pendingFilePath(sandboxDir);
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Array.isArray(parsed?.decisions) ? parsed.decisions : [];
}

/**
 * `docuvia init` installs a real post-commit hook whose two backgrounded (`&`) lines would
 * otherwise fire for real on every subsequent `git commit` this test makes (this sandbox runs a
 * real `git`, not a mock) -- racing this test's own explicit `analyze --flush-staged-l3`
 * invocation with a second, hook-triggered one. Removed right after `init` so every commit this
 * test makes afterward is inert with respect to Docuvia's hooks; the flush step under test is the
 * *only* thing that ever flushes, matching the "manually invoke the flush" approach the task
 * itself calls for (a real post-commit hook can't easily be triggered deterministically from a
 * test/agent session the same way `git commit` triggers it interactively).
 */
function removePostCommitHook(sandboxDir: string): void {
  fs.rmSync(path.resolve(sandboxDir, ".git/hooks/post-commit"), {
    force: true,
  });
}

/**
 * End-to-end coverage for the stage-and-flush design (issue #42, Decision 2 §8): a real temp git
 * repo, a real `init` (populated graph), a real `--stage` write, a real second commit, and a
 * real `--flush-staged-l3` invocation, with a direct `local.db` query -- the same shape
 * `agent-authored-analyze.integration.test.ts` uses for the direct-write path.
 */
describe("analyze --agent-authored --stage / --flush-staged-l3 (issue #42 §8): real end-to-end stage-and-flush", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    "flushes a staged decision once its file is part of the triggering commit, tagged with that commit's real sha, and empties the staging file",
    async () => {
      const sandbox = new TestSandbox();
      await sandbox.setup({ initGit: true, files: FIXTURE_FILES });
      tempDirs.push(sandbox.dir);
      await sandbox.runGit(["add", "-A"]);
      await sandbox.runGit(["commit", "-m", "initial"]);

      const initResult = await sandbox.runCli(["init"], { reject: false });
      expect(initResult.exitCode).toBe(0);
      removePostCommitHook(sandbox.dir);

      const payload = JSON.stringify({
        decisions: [
          {
            title: "Staged via --stage",
            content: "Staged before commit, flushed after.",
            nodeType: "decision",
            confidence: 0.8,
          },
        ],
      });
      const stageResult = await sandbox.runCli(
        ["analyze", "src/index.ts", "--agent-authored", "--stage"],
        { reject: false, input: payload },
      );
      expect(stageResult.exitCode).toBe(0);
      expect(readPendingDecisions(sandbox.dir)).toHaveLength(1);

      // Second commit that touches src/index.ts -- the same file the decision was staged against.
      fs.appendFileSync(
        path.resolve(sandbox.dir, "src/index.ts"),
        "\nexport const extra = 1;\n",
      );
      await sandbox.runGit(["add", "-A"]);
      await sandbox.runGit(["commit", "-m", "touch index.ts"]);
      const { stdout: headShaRaw } = await sandbox.runGit([
        "rev-parse",
        "HEAD",
      ]);
      const headSha = headShaRaw.trim();

      const flushResult = await sandbox.runCli(
        ["analyze", "--flush-staged-l3"],
        {
          reject: false,
        },
      );
      expect(flushResult.exitCode).toBe(0);

      const dbPath = path.resolve(sandbox.dir, ".docuvia/local.db");
      const rows = queryL3Rows(dbPath);
      const staged = rows.find((r) => r.title === "Staged via --stage");
      expect(staged).toBeDefined();
      expect(staged?.source).toBe("agent-authored");
      expect(staged?.commit_hash).toBe(headSha);

      expect(readPendingDecisions(sandbox.dir)).toEqual([]);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "leaves a staged decision untouched in the staging file when its file isn't part of the triggering commit",
    async () => {
      const sandbox = new TestSandbox();
      await sandbox.setup({ initGit: true, files: FIXTURE_FILES });
      tempDirs.push(sandbox.dir);
      await sandbox.runGit(["add", "-A"]);
      await sandbox.runGit(["commit", "-m", "initial"]);

      const initResult = await sandbox.runCli(["init"], { reject: false });
      expect(initResult.exitCode).toBe(0);
      removePostCommitHook(sandbox.dir);

      const payload = JSON.stringify({
        decisions: [
          {
            title: "Staged for index.ts, never committed again",
            content: "content",
            nodeType: "context",
            confidence: 0.6,
          },
        ],
      });
      const stageResult = await sandbox.runCli(
        ["analyze", "src/index.ts", "--agent-authored", "--stage"],
        { reject: false, input: payload },
      );
      expect(stageResult.exitCode).toBe(0);

      // This commit touches a DIFFERENT file -- src/index.ts is not in its diff.
      fs.appendFileSync(
        path.resolve(sandbox.dir, "src/other.ts"),
        "\nexport const extraOther = 1;\n",
      );
      await sandbox.runGit(["add", "-A"]);
      await sandbox.runGit(["commit", "-m", "touch other.ts"]);

      const flushResult = await sandbox.runCli(
        ["analyze", "--flush-staged-l3"],
        {
          reject: false,
        },
      );
      expect(flushResult.exitCode).toBe(0);

      const dbPath = path.resolve(sandbox.dir, ".docuvia/local.db");
      const rows = queryL3Rows(dbPath);
      expect(
        rows.find(
          (r) => r.title === "Staged for index.ts, never committed again",
        ),
      ).toBeUndefined();

      const stillStaged = readPendingDecisions(sandbox.dir);
      expect(stillStaged).toHaveLength(1);
      expect(stillStaged[0]).toMatchObject({
        filePath: "src/index.ts",
        title: "Staged for index.ts, never committed again",
      });
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "docuvia hooks disable commit-l3-write makes --flush-staged-l3 a genuine no-op: nothing written to l3_nodes, staging file byte-identical",
    async () => {
      const sandbox = new TestSandbox();
      await sandbox.setup({ initGit: true, files: FIXTURE_FILES });
      tempDirs.push(sandbox.dir);
      await sandbox.runGit(["add", "-A"]);
      await sandbox.runGit(["commit", "-m", "initial"]);

      const initResult = await sandbox.runCli(["init"], { reject: false });
      expect(initResult.exitCode).toBe(0);
      removePostCommitHook(sandbox.dir);

      const disableResult = await sandbox.runCli(
        ["hooks", "disable", "commit-l3-write"],
        { reject: false },
      );
      expect(disableResult.exitCode).toBe(0);

      const payload = JSON.stringify({
        decisions: [
          {
            title: "Should never land while disabled",
            content: "content",
            nodeType: "decision",
            confidence: 0.5,
          },
        ],
      });
      await sandbox.runCli(
        ["analyze", "src/index.ts", "--agent-authored", "--stage"],
        { reject: false, input: payload },
      );

      fs.appendFileSync(
        path.resolve(sandbox.dir, "src/index.ts"),
        "\nexport const extra = 1;\n",
      );
      await sandbox.runGit(["add", "-A"]);
      await sandbox.runGit(["commit", "-m", "touch index.ts"]);

      const beforeFlushRaw = fs.readFileSync(
        pendingFilePath(sandbox.dir),
        "utf-8",
      );

      const flushResult = await sandbox.runCli(
        ["analyze", "--flush-staged-l3"],
        {
          reject: false,
        },
      );
      expect(flushResult.exitCode).toBe(0);

      const dbPath = path.resolve(sandbox.dir, ".docuvia/local.db");
      const rows = queryL3Rows(dbPath);
      expect(
        rows.find((r) => r.title === "Should never land while disabled"),
      ).toBeUndefined();

      const afterFlushRaw = fs.readFileSync(
        pendingFilePath(sandbox.dir),
        "utf-8",
      );
      expect(afterFlushRaw).toBe(beforeFlushRaw);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
