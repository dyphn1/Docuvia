import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";

/**
 * Python analogue of `analyze-escalate-lsp-degradation.test.ts` (multi-language-lsp-support plan,
 * Slice 1): proves the `.py` dispatch entry (`tier-b-language-dispatch.ts`) actually routes to
 * the registered `PythonLspEdgeProvider` (not skipped as an unsupported language anymore), and
 * that it degrades honestly -- AST edges untouched, JSONL-logged, exit 0 -- when `pyright` is not
 * installed/resolvable in this sandbox (confirmed manually: `npx --no-install --package pyright
 * pyright-langserver` fails cleanly with no network install attempted, same "not installed
 * anywhere docuvia bundles" assumption the TS/JS degradation test already documents and relies
 * on). A genuine LSP-precision cross-file edge for Python was verified separately during this
 * slice's implementation via a real `pyright-langserver` spawn (outside this automated suite,
 * since it requires a live network install and is not deterministic/fast enough to commit as a
 * CI-run test) -- see this slice's own report for the manual verification details.
 */
describe("Command: docuvia analyze --escalate-to-lsp (Python, real filesystem, no pyright installed)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "pyproject.toml": '[project]\nname = "fixture-project"\n',
        "src/main.py": "def hello():\n    return 'world'\n",
        "README.md": "# fixture\n",
      },
    });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    // Seed the queue with one Python entry (routed to the Python LSP provider, then degrades) and
    // one non-dispatched entry (skipped by language dispatch before ever reaching a provider).
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    const db = new Database(dbPath);
    try {
      db.prepare(
        "INSERT OR REPLACE INTO docuvia_meta (key, value) VALUES ('tierBQueue', ?)",
      ).run(
        JSON.stringify([
          { file: "src/main.py", commitSha: "deadbeef" },
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
