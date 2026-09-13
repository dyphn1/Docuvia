import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";
import { CORPUS_FILES, GOLDEN_CASES } from "../../support/impact-corpus.js";
import {
  aggregateCases,
  assertImpactEvalRegressionFloor,
  buildCsv,
  buildMarkdownSummary,
  errorCase,
  scoreCase,
  type ImpactEvalCaseResult,
} from "../../support/impact-eval-scorer.js";

// TDD-SOURCE: issue #192 impact accuracy acceptance criteria

const RESULTS_DIR = resolve(__dirname, "../../../../../evaluate/results");

interface NodePathRow {
  path_patterns: string | null;
}

interface ImpactJsonResult {
  blastRadius: Array<{ name: string }>;
}

function parsePathPatterns(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function exactNodePaths(db: Database.Database, name: string): string[] {
  const row = db
    .prepare("SELECT path_patterns FROM l2_nodes WHERE name = ? LIMIT 1")
    .get(name) as NodePathRow | undefined;
  return parsePathPatterns(row?.path_patterns ?? null);
}

function dependentFilesFromImpactResult(
  db: Database.Database,
  target: string,
  result: ImpactJsonResult | null,
): string[] {
  if (!result) return [];

  const targetFiles = new Set(exactNodePaths(db, target));
  const predicted = new Set<string>();
  for (const entry of result.blastRadius) {
    const paths = exactNodePaths(db, entry.name);
    if (paths.length === 0) {
      throw new Error(
        `impact entry '${entry.name}' cannot be mapped to an exact L2 node`,
      );
    }
    for (const filePath of paths) {
      // `docuvia impact` intentionally reports the symbol's containing file as context. The
      // accuracy corpus scores DEPENDENTS, so the definition's own file is not a prediction.
      if (!targetFiles.has(filePath)) predicted.add(filePath);
    }
  }
  return [...predicted].sort();
}

async function evaluateCorpus(
  sandbox: TestSandbox,
  db: Database.Database,
): Promise<ImpactEvalCaseResult[]> {
  const results: ImpactEvalCaseResult[] = [];

  for (const golden of GOLDEN_CASES) {
    try {
      const run = await sandbox.runCli(
        ["impact", golden.target, "--format=json"],
        { reject: false },
      );
      if (run.exitCode !== 0) {
        results.push(
          errorCase(
            golden.scenario,
            golden.target,
            golden.expectedDependentFiles,
          ),
        );
        continue;
      }

      const stdout = run.stdout.trim();
      const impact = JSON.parse(stdout) as ImpactJsonResult | null;
      results.push(
        scoreCase(
          golden.scenario,
          golden.target,
          dependentFilesFromImpactResult(db, golden.target, impact),
          golden.expectedDependentFiles,
        ),
      );
    } catch {
      results.push(
        errorCase(
          golden.scenario,
          golden.target,
          golden.expectedDependentFiles,
        ),
      );
    }
  }

  return results;
}

describe("Phase 6: real docuvia impact accuracy regression gate (#192)", () => {
  let sandbox: TestSandbox;
  let db: Database.Database;
  let results: ImpactEvalCaseResult[];
  let repeatedResults: ImpactEvalCaseResult[];

  beforeAll(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({ initGit: true, files: CORPUS_FILES });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "impact-eval-corpus"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    db = new Database(join(sandbox.dir, ".docuvia/local.db"), {
      readonly: true,
    });

    results = await evaluateCorpus(sandbox, db);
    repeatedResults = await evaluateCorpus(sandbox, db);

    const aggregate = aggregateCases(results);
    assertImpactEvalRegressionFloor(aggregate);

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
  }, 240_000);

  afterAll(() => {
    db?.close();
    return sandbox?.teardown();
  });

  it("scores the real docuvia impact JSON result for every golden case", () => {
    expect(results).toHaveLength(GOLDEN_CASES.length);
    expect(results.every((result) => result.status === "ok")).toBe(true);
  });

  it("produced a scored row for every golden case (errors included, never dropped)", () => {
    expect(results.map((result) => result.scenario)).toEqual(
      GOLDEN_CASES.map((golden) => golden.scenario),
    );
  });

  it("keeps the harness honest: no case silently errored", () => {
    expect(results.filter((result) => result.status === "error")).toEqual([]);
  });

  it("scores the control static-call case perfectly", () => {
    const control = results.find(
      (result) => result.scenario === "control-static-call",
    );
    expect(control).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });

  it("recovers unresolved receiver and typed method calls through the shipped impact fallback", () => {
    for (const scenario of [
      "unresolved-receiver-call",
      "unresolved-method-call",
    ]) {
      const result = results.find(
        (candidate) => candidate.scenario === scenario,
      );
      expect(result).toMatchObject({ precision: 1, recall: 1, f1: 1 });
    }
  });

  it("produces identical scores across repeated impact evaluation of the same corpus", () => {
    expect(repeatedResults).toEqual(results);
  });

  it("keeps the corrected product-path aggregate above the active regression floor", () => {
    expect(() =>
      assertImpactEvalRegressionFloor(aggregateCases(results)),
    ).not.toThrow();
  });

  it("wrote dated CSV + markdown reports to evaluate/results/", () => {
    const date = new Date().toISOString().slice(0, 10);
    expect(
      existsSync(join(RESULTS_DIR, `impact_accuracy_${date}.csv`)),
    ).toBe(true);
    expect(
      existsSync(join(RESULTS_DIR, `impact_accuracy_${date}.summary.md`)),
    ).toBe(true);
  });
});
