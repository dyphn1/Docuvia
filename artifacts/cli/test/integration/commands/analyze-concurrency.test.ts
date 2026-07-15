import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { TestSandbox } from "../../support/sandbox.js";

const CONCURRENT_RUNS = 5;

/**
 * Regression coverage for docs/cli-test-analysis/analyze.md claim 6, retargeted per
 * analyze-status.md's B.1 verdict: AnalyzeWorkflow's config-scan path never opens the SQLite
 * store (no TOKENS.GraphStoreOpener call), so it cannot race with `init`'s DB/migration writes
 * the way init-concurrency-status.md's bug did. The real, cheaply-testable risk here is N
 * concurrent `analyze` runs all appending to the same `.docuvia/logs/analyze.log` file via
 * `fs.appendFile` -- this test proves that produces N well-formed, non-interleaved JSONL run
 * pairs rather than corrupted/merged lines.
 */
describe("Command: docuvia analyze (concurrent runs, real filesystem)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      files: {
        "package.json": JSON.stringify({ name: "fixture-project" }),
      },
    });
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it(`resolves all ${CONCURRENT_RUNS} concurrent analyze runs without throwing and writes well-formed, uncorrupted JSONL log lines`, async () => {
    const runs = Array.from({ length: CONCURRENT_RUNS }, () =>
      sandbox.runCli(["analyze"], { reject: false }),
    );
    const results = await Promise.all(runs);

    for (const result of results) {
      expect(result.exitCode).toBe(0);
    }

    const logPath = resolve(sandbox.dir, ".docuvia/logs/analyze.log");
    expect(existsSync(logPath)).toBe(true);
    const rawLines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);

    // Every line must parse as a single well-formed JSON object -- a corrupted/interleaved
    // concurrent write would produce a line that fails JSON.parse or merges two events together.
    const parsedLines = rawLines.map((line) => JSON.parse(line));

    const startEvents = parsedLines.filter((l) => l.event === "analyze.start");
    const summaryEvents = parsedLines.filter(
      (l) => l.event === "analyze.summary",
    );
    expect(startEvents.length).toBe(CONCURRENT_RUNS);
    expect(summaryEvents.length).toBe(CONCURRENT_RUNS);
    expect(parsedLines.length).toBe(CONCURRENT_RUNS * 2);
  }, 60000);
});
