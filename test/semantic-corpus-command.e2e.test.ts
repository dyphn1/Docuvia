import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  truncateSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusSample } from "../lib/core/src/semantic/semantic-corpus-test-fixtures.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-corpus.md#p1-03--offline-audit-command
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
import { SUBPROCESS_TEST_TIMEOUT_MS } from "../lib/contracts/src/testing/timeouts.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = join(root, "scripts/semantic-corpus-audit.mts");
let temporary: string;
let input: string;
let output: string;

function run(args = ["--input", input, "--output", output], preload?: string) {
  const child = spawnSync(
    process.execPath,
    [
      ...(preload ? ["--require", preload] : []),
      "--import",
      "tsx",
      command,
      ...args,
    ],
    { cwd: root, encoding: "utf8", timeout: 20_000 },
  );
  expect(child.error).toBe(undefined);
  expect(child.signal).toBe(null);
  return child;
}
function inputValue() {
  return {
    schemaVersion: 1,
    corpusId: "synthetic-cli",
    corpusVersion: "1",
    splitSeed: "fixed",
    samples: [corpusSample()],
  };
}
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "docuvia-semantic-audit-"));
  input = join(temporary, "corpus.json");
  output = join(temporary, "nested/report.json");
  writeFileSync(input, JSON.stringify(inputValue()));
});
afterEach(() => rmSync(temporary, { recursive: true, force: true }));

describe("offline semantic corpus command", () => {
  it(
    "[happy] replays the whole synthetic report twice with an honest insufficient exit",
    () => {
      const first = run();
      expect(first.status).toBe(2);
      expect(first.stderr).toBe("");
      const bytes = readFileSync(output, "utf8");
      const report = JSON.parse(bytes);
      expect(report.corpusId).toBe("synthetic-cli");
      expect(report.gates).toEqual({
        sampleSize: "insufficient-evidence",
        candidateRecall: "insufficient-evidence",
      });
      expect(report.synthetic).toEqual({
        requests: 1,
        trustedGoldRequests: 1,
        goldTargets: 2,
        coveredTargets: 1,
        fullyCoveredRequests: 0,
        candidateRecall: 0.5,
        setCoverage: 0,
      });
      expect(report.results).toEqual([
        {
          sampleId: "sample-1",
          reason: "ready",
          labels: [
            {
              candidateId: " option a ",
              targetId: "src/a.ts#target",
              label: "confirmed-positive",
            },
            {
              candidateId: "b",
              targetId: "src/b.ts#target",
              label: "confirmed-negative",
            },
            {
              candidateId: "c",
              targetId: "src/c.ts#target",
              label: "unresolved",
            },
          ],
          goldTargetIds: ["src/a.ts#target", "src/missing.ts#target"],
          missingTargetIds: ["src/missing.ts#target"],
        },
      ]);
      expect(JSON.parse(first.stdout)).toEqual({
        corpusId: report.corpusId,
        datasetHash: report.datasetHash,
        gates: report.gates,
      });
      const second = run();
      expect(second.status).toBe(first.status);
      expect(second.stdout).toBe(first.stdout);
      expect(second.stderr).toBe(first.stderr);
      expect(readFileSync(output, "utf8")).toBe(bytes);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
  it.each([
    { args: [] },
    { args: ["--input"] },
    { args: ["--input", "a", "--output", "b", "--unknown"] },
    { args: ["--input", "a", "--input", "b", "--output", "c"] },
  ])(
    "[invalid-input] rejects malformed arguments %j",
    ({ args }) => {
      const child = run(args);
      expect(child.status).toBe(1);
      expect(child.stdout).toBe("");
      expect(JSON.parse(child.stderr).code).toBe("SEMANTIC_CORPUS_INVALID");
      expect(existsSync(output)).toBe(false);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
  it(
    "[invalid-input] preserves the input when output names the same file",
    () => {
      const before = readFileSync(input, "utf8");
      const child = run(["--input", input, "--output", input]);
      expect(child.status).toBe(1);
      expect(JSON.parse(child.stderr).code).toBe("SEMANTIC_CORPUS_INVALID");
      expect(readFileSync(input, "utf8")).toBe(before);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
  it.each(["not-json", JSON.stringify({ schemaVersion: 99 })])(
    "[error-handling] preserves prior report for invalid corpus %s",
    (text) => {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, "prior-report");
      writeFileSync(input, text);
      const child = run();
      expect(child.status).toBe(1);
      expect(JSON.parse(child.stderr).code).toBe("SEMANTIC_CORPUS_INVALID");
      expect(readFileSync(output, "utf8")).toBe("prior-report");
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
  it(
    "[boundary] rejects oversized input before parsing and invalid UTF-8",
    () => {
      truncateSync(input, 64 * 1024 * 1024 + 1);
      const oversized = run();
      expect(oversized.status).toBe(1);
      expect(JSON.parse(oversized.stderr)).toEqual({
        code: "SEMANTIC_CORPUS_INVALID",
        message: "Corpus JSON exceeds 64 MiB",
      });
      writeFileSync(input, Buffer.from([0xff, 0xfe]));
      const invalidUtf8 = run();
      expect(invalidUtf8.status).toBe(1);
      expect(JSON.parse(invalidUtf8.stderr)).toEqual({
        code: "SEMANTIC_CORPUS_INVALID",
        message: "Corpus must contain valid UTF-8 JSON",
      });
      expect(existsSync(output)).toBe(false);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[negative] reads the opened snapshot if the pathname changes after its size check",
    () => {
      const hook = join(temporary, "swap-after-stat.cjs");
      const saved = join(temporary, "original.json");
      writeFileSync(
        hook,
        `
      const fs = require("node:fs");
      const originalStat = fs.statSync;
      const originalFstat = fs.fstatSync;
      const input = ${JSON.stringify(input)};
      const identity = originalStat(input);
      let swapped = false;
      function swap(stats) {
        if (!swapped && stats.ino === identity.ino && stats.dev === identity.dev) {
          swapped = true;
          fs.renameSync(input, ${JSON.stringify(saved)});
          fs.writeFileSync(input, "corrupt replacement");
        }
        return stats;
      }
      fs.statSync = (...args) => swap(originalStat(...args));
      fs.fstatSync = (...args) => swap(originalFstat(...args));
      require("node:module").syncBuiltinESMExports();
    `,
      );
      const child = run(undefined, hook);
      expect(readFileSync(input, "utf8")).toBe("corrupt replacement");
      expect(child.status).toBe(2);
      expect(child.stderr).toBe("");
      expect(JSON.parse(readFileSync(output, "utf8")).corpusId).toBe(
        "synthetic-cli",
      );
      expect(JSON.parse(readFileSync(saved, "utf8"))).toEqual(inputValue());
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[negative] refuses leaked data without writing a report",
    () => {
      const data = inputValue();
      const first = data.samples[0];
      data.samples.push({
        ...first,
        sampleId: "other",
        source: { ...first.source, callSiteId: "other", split: "test" },
      });
      writeFileSync(input, JSON.stringify(data));
      const child = run();
      expect(child.status).toBe(1);
      expect(JSON.parse(child.stderr).code).toBe("SEMANTIC_CORPUS_LEAKAGE");
      expect(existsSync(output)).toBe(false);
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
  it(
    "[error-handling] reports input/output I/O errors without a successful summary",
    () => {
      const missing = run([
        "--input",
        join(temporary, "missing.json"),
        "--output",
        output,
      ]);
      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stderr).code).toBe("SEMANTIC_CORPUS_IO_FAILED");
      expect(missing.stdout).toBe("");
      mkdirSync(output, { recursive: true });
      const failedOutput = run();
      expect(failedOutput.status).toBe(1);
      expect(JSON.parse(failedOutput.stderr).code).toBe(
        "SEMANTIC_CORPUS_IO_FAILED",
      );
      expect(failedOutput.stdout).toBe("");
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
