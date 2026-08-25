import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";
import { CORPUS_FILES, GOLDEN_CASES } from "../../support/impact-corpus.js";
import {
  aggregateCases,
  buildCsv,
  buildMarkdownSummary,
  errorCase,
  scoreCase,
  type ImpactEvalCaseResult,
} from "../../support/impact-eval-scorer.js";

/**
 * Issue #192's impact-accuracy eval: ingests the human-labeled regression corpus
 * (`impact-corpus.ts`) through the REAL `docuvia init` pipeline in a sandbox, then scores the
 * graph's blast-radius answers against golden ground truth per case (file-level
 * precision/recall/F1).
 *
 * Report-only by design (mirrors CRG's eval.yml stance): this test asserts *harness integrity*
 * -- every case produced a row, and the static-call control case must be perfect or the harness
 * itself is broken -- but asserts NO F1 threshold yet. Gating activates once baseline history
 * accumulates (#192 acceptance criterion 2's second half is deliberately deferred).
 *
 * Results are written to `evaluate/results/` (dated CSV + markdown summary) so runs are
 * comparable over time; CI uploads them as artifacts and posts the summary to PRs.
 */

const RESULTS_DIR = resolve(__dirname, "../../../../../evaluate/results");

interface NodeRow {
  id: number;
  path_patterns: string | null;
}

function parseFirstPathPattern(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? String(parsed[0])
      : undefined;
  } catch {
    return undefined;
  }
}

describe("Command: impact accuracy eval over the regression corpus (#192)", () => {
  let sandbox: TestSandbox;
  let db: Database.Database;
  let results: ImpactEvalCaseResult[];

  beforeAll(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({ initGit: true, files: CORPUS_FILES });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "corpus"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    db = new Database(join(sandbox.dir, ".docuvia/local.db"), {
      readonly: true,
    });

    results = [];
    for (const golden of GOLDEN_CASES) {
      try {
        const exact = db
          .prepare("SELECT id FROM l2_nodes WHERE name = ? LIMIT 1")
          .get(golden.target) as { id: number } | undefined;

        if (!exact) {
          // Target unresolved by the graph itself -- scored as an EMPTY PREDICTION (a real
          // analyzer coverage failure: `docuvia impact` would print "No matching node"), never
          // a harness error.
          results.push(
            scoreCase(
              golden.scenario,
              golden.target,
              [],
              golden.expectedDependentFiles,
            ),
          );
          continue;
        }

        // `contains` is excluded here even though the shipped `impact` command intentionally
        // reports it (IMPT-001's single-hop heuristic): this benchmark measures DEPENDENCY-edge
        // accuracy -- a symbol's own containing file is not a dependent, and counting it would
        // award every case a free true-positive.
        const rows = db
          .prepare(
            `SELECT DISTINCT n.path_patterns AS path_patterns
             FROM node_links l
             JOIN l2_nodes n ON n.id = l.source_node_id
             WHERE l.target_node_id = ? AND l.link_type != 'contains'`,
          )
          .all(exact.id) as NodeRow[];

        const predictedFiles = rows
          .map((r) => parseFirstPathPattern(r.path_patterns))
          .filter((f): f is string => !!f);

        results.push(
          scoreCase(
            golden.scenario,
            golden.target,
            predictedFiles,
            golden.expectedDependentFiles,
          ),
        );
      } catch {
        // CRG-style failure semantics: an errored case stays visible as an error row instead of
        // silently inflating (or zeroing) the aggregate.
        results.push(
          errorCase(
            golden.scenario,
            golden.target,
            golden.expectedDependentFiles,
          ),
        );
      }
    }

    const aggregate = aggregateCases(results);
    await mkdir(RESULTS_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    await writeFile(
      join(RESULTS_DIR, `impact_accuracy_${date}.csv`),
      buildCsv(results),
      "utf8",
    );
    await writeFile(
      join(RESULTS_DIR, `impact_accuracy_${date}.summary.md`),
      buildMarkdownSummary(results, aggregate),
      "utf8",
    );
  }, 180_000);

  afterAll(() => {
    db?.close();
    return sandbox?.teardown();
  });

  it("produced a scored row for every golden case (errors included, never dropped)", () => {
    expect(results).toHaveLength(GOLDEN_CASES.length);
    for (const result of results) {
      expect(["ok", "error"]).toContain(result.status);
    }
  });

  it("keeps the harness honest: no case silently errored", () => {
    const errored = results.filter((r) => r.status === "error");
    expect(errored.map((r) => `${r.scenario}:${r.target}`)).toEqual([]);
  });

  it("scores the control static-call case perfectly -- a control miss means the harness (not the analyzer) is broken", () => {
    const control = results.find((r) => r.scenario === "control-static-call");
    expect(control).toBeDefined();
    expect(control?.status).toBe("ok");
    expect(control?.recall).toBe(1);
    expect(control?.precision).toBe(1);
  });

  it("wrote dated CSV + markdown reports to evaluate/results/", () => {
    const date = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(RESULTS_DIR, `impact_accuracy_${date}.csv`))).toBe(
      true,
    );
    expect(
      existsSync(join(RESULTS_DIR, `impact_accuracy_${date}.summary.md`)),
    ).toBe(true);
  });
});
