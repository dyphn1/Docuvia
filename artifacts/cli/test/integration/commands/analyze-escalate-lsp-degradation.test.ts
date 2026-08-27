import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";

/**
 * Gating tests 3 and 4 (docs/gitbook/analysis/phase1-decision-integration.md §8j):
 *   3. Degradation: LSP absent -> AST edges untouched, JSONL event written, exit 0.
 *   4. Language dispatch: non-TS entry skipped with a log line; TS entry processed (attempted).
 * Both are naturally exercised by the same real CLI run: no `typescript-language-server` is
 * installed in this sandbox (confirmed manually: `npx --no-install typescript-language-server`
 * fails cleanly, no network install attempted), so the TS entry reaches the provider and
 * degrades honestly, while the non-TS entry never reaches the provider at all (skipped by the
 * language dispatch table before that point).
 */
describe("Command: docuvia analyze --escalate-to-lsp (real filesystem, no LSP installed)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "package.json": JSON.stringify({ name: "fixture-project" }),
        "src/index.ts":
          "export function hello(): string {\n  return 'world';\n}\n",
        "README.md": "# fixture\n",
      },
    });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    // Seed the queue with one TS entry (routed to the LSP provider, then degrades) and one
    // non-TS entry (skipped by language dispatch before ever reaching the provider).
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    const db = new Database(dbPath);
    try {
      db.prepare(
        "INSERT OR REPLACE INTO docuvia_meta (key, value) VALUES ('tierBQueue', ?)",
      ).run(
        JSON.stringify([
          { file: "src/index.ts", commitSha: "deadbeef" },
          { file: "README.md", commitSha: "deadbeef" },
        ]),
      );
    } finally {
      db.close();
    }
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("exits 0, logs the language-skip and degradation events, and leaves the graph's node_links untouched", async () => {
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    const countLinks = () => {
      const db = new Database(dbPath, { readonly: true });
      try {
        return (
          db.prepare("SELECT COUNT(*) as c FROM node_links").get() as {
            c: number;
          }
        ).c;
      } finally {
        db.close();
      }
    };
    const linksBefore = countLinks();

    const result = await sandbox.runCli(
      ["analyze", "--escalate-to-lsp", "--fallback-ast"],
      { reject: false },
    );

    expect(result.exitCode).toBe(0);
    expect(countLinks()).toBe(linksBefore);

    const logPath = resolve(sandbox.dir, ".docuvia/logs/analyze.log");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const languageSkip = lines.find(
      (l) =>
        l.event === "analyze.tierB.file_skipped_language" &&
        l.file === "README.md",
    );
    expect(languageSkip).toBeDefined();
    expect(languageSkip!.event).toBe("analyze.tierB.file_skipped_language");
    expect(languageSkip!.file).toBe("README.md");

    const degraded = lines.find((l) => l.event === "analyze.tierB.degraded");
    expect(degraded).toBeDefined();
    expect(typeof degraded!.reason).toBe("string");
    expect(degraded!.reason.length).toBeGreaterThanOrEqual(1);

    const summary = lines.find((l) => l.event === "analyze.tierB.summary");
    expect(summary).toBeDefined();
    expect(summary!.event).toBe("analyze.tierB.summary");
    expect(summary.degraded).toBe(true);
    expect(summary.edgesApplied).toBe(0);
    expect(summary.filesSkippedLanguage).toBe(1);
  }, 60000);
});
