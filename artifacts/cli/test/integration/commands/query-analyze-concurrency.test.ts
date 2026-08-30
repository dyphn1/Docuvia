import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

const QUERY_RUNS = 3;
const ANALYZE_RUNS = 3;

/**
 * Regression coverage for docs/gitbook/analysis/roadmap-and-open-items.md item #8, "Race C —
 * `query` (foreground read) vs. `analyze` (background write)" — the one concurrency scenario in
 * that list's lock matrix with no gating test today, unlike `analyze`+`snapshot`
 * (analyze-snapshot-concurrency.test.ts) and `doctor`+`hydrate`
 * (doctor-hydrate-concurrency.test.ts). Follows those tests' real-CLI-process pattern: `query`
 * runs `ensureHydrated` (which may itself open `local.db` read-write to self-heal) and then opens
 * `local.db` readonly to read via `QueryService.query`, while `analyze` auto mode writes under
 * `store.withWriteLock` — exercising WAL's concurrent reader/writer handling (ADR-032) under real
 * concurrent processes, not mocks. Like the sibling `analyze`+`snapshot` test, `init` builds the
 * initial graph, then a real commit moves `HEAD` so every concurrent `analyze` run below resolves
 * a genuine `fromSha -> headSha` delta with a changed file to re-parse, instead of the sha
 * fast-path no-op.
 *
 * The roadmap item frames WAL's non-blocking read/write property as likely making this benign (a
 * stale-but-consistent snapshot, not corruption) but calls that an unverified inference — that's
 * exactly what this test gates: it does NOT assert on `query`'s exact result staleness/content
 * (inherently non-deterministic depending on scheduling), only that a `query` racing a concurrent
 * `analyze` write always exits cleanly and its stdout is a single well-formed
 * `<docuvia_context>...</docuvia_context>` block, never a torn/garbled/partial one.
 */
describe("Command: docuvia query (foreground read) concurrent with docuvia analyze (background write) (real filesystem)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "package.json": JSON.stringify({ name: "fixture-project" }),
        "src/index.ts":
          "export function hello(): string {\n  return 'world';\n}\n",
      },
    });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);

    // `init` builds the initial local graph -- `query`'s read target and `analyze` auto mode's
    // delta baseline both need it to already exist.
    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    // Move HEAD past whatever `init`'s `ensureKnowledgeBranch` stamped, so every concurrent
    // `analyze` run below takes the real delta write path (re-parse + persist under
    // `store.withWriteLock`), not the sha fast-path no-op.
    await writeFile(
      resolve(sandbox.dir, "src/index.ts"),
      "export function hello(): string {\n  return 'world!!!';\n}\n",
      "utf8",
    );
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "change hello"]);
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await sandbox.teardown();
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  it(
    `resolves ${QUERY_RUNS} concurrent query reads and ${ANALYZE_RUNS} concurrent analyze writes without corrupting local.db, both with sane exit codes and well-formed query output`,
    async () => {
      const runs = [
        // `--format=prompt` skips the spinner UI entirely (query.ts's `startQuerySpinner` returns
        // undefined for prompt format) so stdout is exactly the `<docuvia_context>` block written
        // by `ui.log(formatPromptOutput(result))` -- the cleanest structural well-formedness check
        // available for "did this read ever observe/emit a torn or corrupt state".
        ...Array.from({ length: QUERY_RUNS }, () =>
          sandbox.runCli(["query", "hello", "--format=prompt"], {
            reject: false,
          }),
        ),
        ...Array.from({ length: ANALYZE_RUNS }, () =>
          sandbox.runCli(["analyze"], { reject: false }),
        ),
      ];
      const results = await Promise.all(runs);

      for (const result of results) {
        expect(result.exitCode).toBe(0);
      }

      const queryResults = results.slice(0, QUERY_RUNS);
      for (const result of queryResults) {
        const stdout = result.stdout.trim();

        // Well-formed, non-torn, non-garbled: exactly one root `<docuvia_context>` open/close pair,
        // in order, with nothing racing a concurrent `analyze` write left dangling or duplicated in
        // between.
        expect(stdout.startsWith("<docuvia_context>")).toBe(true);
        expect(stdout.endsWith("</docuvia_context>")).toBe(true);
        expect(stdout.split("<docuvia_context>").length - 1).toBe(1);
        expect(stdout.split("</docuvia_context>").length - 1).toBe(1);
      }

      // No DB corruption: a real SQLite integrity check against local.db, plus a project-row
      // consistency check (concurrent readers/writers must not duplicate/corrupt the single
      // project row).
      const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
      expect(existsSync(dbPath)).toBe(true);
      const db = new Database(dbPath, { readonly: true });
      try {
        const integrity = db.pragma("integrity_check", { simple: true });
        expect(integrity).toBe("ok");

        const { count } = db
          .prepare("SELECT COUNT(*) as count FROM projects")
          .get() as { count: number };
        expect(count).toBe(1);
      } finally {
        db.close();
      }
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
