import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";
import { CORPUS_FILES, GOLDEN_CASES } from "../../support/impact-corpus.js";
import { aggregateImpactHonesty } from "../../support/impact-eval-honesty.js";
import {
  PHASE1_CORPUS_FILES,
  PHASE1_GOLDEN_CASES,
  assertPhase1ImpactHonestyGates,
  evaluateLegacyImpactCorpus,
  evaluatePhase1ImpactHonesty,
  poisonNegativePrediction,
  poisonObservedStatus,
  poisonTargetIdentity,
  runImpact,
} from "../../support/impact-honesty-corpus.phase1.js";

// TDD-SOURCE: issue #508 Phase 1 negative + ambiguity adversarial corpus
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase1.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md

describe("Phase 1: impact benchmark negative/ambiguity adversarial corpus (#508)", () => {
  let sandbox: TestSandbox;
  let db: Database.Database;
  let results: Awaited<ReturnType<typeof evaluatePhase1ImpactHonesty>>;
  let repeatedResults: Awaited<ReturnType<typeof evaluatePhase1ImpactHonesty>>;
  let legacyResults: Awaited<ReturnType<typeof evaluateLegacyImpactCorpus>>;
  let repeatedLegacyResults: Awaited<
    ReturnType<typeof evaluateLegacyImpactCorpus>
  >;

  beforeAll(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: { ...CORPUS_FILES, ...PHASE1_CORPUS_FILES },
    });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "impact-honesty-phase1-corpus"]);

    const init = await sandbox.runCli(["init"], { reject: false });
    expect(init.exitCode).toBe(0);

    db = new Database(join(sandbox.dir, ".docuvia/local.db"), {
      readonly: true,
    });

    results = await evaluatePhase1ImpactHonesty(sandbox, db);
    repeatedResults = await evaluatePhase1ImpactHonesty(sandbox, db);
    legacyResults = await evaluateLegacyImpactCorpus(sandbox, db);
    repeatedLegacyResults = await evaluateLegacyImpactCorpus(sandbox, db);
  }, 240_000);

  afterAll(() => {
    db?.close();
    return sandbox?.teardown();
  });

  it("[happy] executes every adversarial case with stable scenario accounting", () => {
    expect(results.map((result) => result.scenario)).toEqual(
      PHASE1_GOLDEN_CASES.map((golden) => golden.scenario),
    );
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.observedStatus !== "error")).toBe(
      true,
    );
  });

  it("[negative] keeps specificity perfect and false-positive rate at zero", () => {
    const aggregate = assertPhase1ImpactHonestyGates(results);

    expect(aggregate.negative.specificity).toBe(1);
    expect(aggregate.negative.falsePositiveRate).toBe(0);
  });

  it("[ambiguity] resolves identity-checked cases to the intended node_key", () => {
    const aggregate = assertPhase1ImpactHonestyGates(results);

    expect(aggregate.targetResolution.wrongTargetCases).toBe(0);
    expect(aggregate.targetResolution.wrongTargetRate).toBe(0);
    expect(
      results
        .filter((result) => result.expectedTargetIdentity !== undefined)
        .every((result) => result.targetResolution.correct),
    ).toBe(true);
  });

  it("[positive] returns only labeled dependents in positive adversarial cases", () => {
    const positives = results.filter(
      (result) => result.intent === "confirmed-positive",
    );

    expect(positives.length).toBeGreaterThan(0);
    for (const result of positives) {
      expect(result.positive).toMatchObject({
        precision: 1,
        recall: 1,
        f1: 1,
      });
    }
  });

  it("[compatibility] preserves all eight existing positive golden cases", () => {
    expect(legacyResults).toHaveLength(GOLDEN_CASES.length);
    expect(legacyResults.map((result) => result.scenario)).toEqual(
      GOLDEN_CASES.map((golden) => golden.scenario),
    );
    expect(legacyResults.every((result) => result.status === "ok")).toBe(true);
  });

  it("[determinism] repeats both adversarial and legacy normalized results exactly", () => {
    expect(repeatedResults).toEqual(results);
    expect(repeatedLegacyResults).toEqual(legacyResults);
  });

  it("[negative-control] poisoned dependency evidence fails the Phase 1 gate", () => {
    const poisoned = poisonNegativePrediction(results);

    expect(() => assertPhase1ImpactHonestyGates(poisoned)).toThrow(
      /negative specificity|false-positive rate/,
    );
  });

  it("[negative-control] poisoned target identity fails the wrong-target gate", () => {
    const poisoned = poisonTargetIdentity(results);

    expect(() => assertPhase1ImpactHonestyGates(poisoned)).toThrow(
      /wrong-target/,
    );
  });

  it("[invalid-input] an unknown target is not-found and cannot pass as a true negative", async () => {
    const run = await runImpact(sandbox, "evalTargetThatDoesNotExist");
    expect(run).toEqual({ status: "not-found", impact: null });

    const poisoned = poisonObservedStatus(results, "not-found");
    const aggregate = aggregateImpactHonesty(poisoned);
    expect(aggregate.totalCases).toBe(results.length);
    expect(aggregate.statusCounts["not-found"]).toBe(1);
    expect(aggregate.negative.trueNegativeCases).toBe(
      aggregateImpactHonesty(results).negative.trueNegativeCases - 1,
    );
    expect(() => assertPhase1ImpactHonestyGates(poisoned)).toThrow(
      /unexpected status in zero-dependents/,
    );
  });

  it("[error-handling] an errored case stays in the denominator and fails the gate", () => {
    const poisoned = poisonObservedStatus(results, "error");
    const aggregate = aggregateImpactHonesty(poisoned);

    expect(aggregate.totalCases).toBe(results.length);
    expect(aggregate.errorCases).toBe(1);
    expect(() => assertPhase1ImpactHonestyGates(poisoned)).toThrow(
      /1 case\(s\) errored/,
    );
  });

  it("[stress] concurrent evaluations over the shared graph match the sequential baseline", async () => {
    const concurrent = await Promise.all(
      [0, 1, 2].map(() => evaluatePhase1ImpactHonesty(sandbox, db)),
    );

    expect(concurrent).toHaveLength(3);
    for (const run of concurrent) expect(run).toEqual(results);
  }, 240_000);
});

describe("Phase 1: impact honesty gate tracks graph changes (#508)", () => {
  let sandbox: TestSandbox;
  let db: Database.Database;

  beforeAll(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({ initGit: true, files: PHASE1_CORPUS_FILES });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "impact-honesty-phase1-corpus"]);
    const init = await sandbox.runCli(["init"], { reject: false });
    expect(init.exitCode).toBe(0);
    db = new Database(join(sandbox.dir, ".docuvia/local.db"), {
      readonly: true,
    });
  }, 240_000);

  afterAll(() => {
    db?.close();
    return sandbox?.teardown();
  });

  it("[state-diff] a new real caller turns the zero-dependents true negative into a caught false positive", async () => {
    const zeroDependents = (
      results: Awaited<ReturnType<typeof evaluatePhase1ImpactHonesty>>,
    ) => results.find((result) => result.scenario === "zero-dependents");

    const before = await evaluatePhase1ImpactHonesty(sandbox, db);
    expect(zeroDependents(before)?.predictions).toEqual([]);
    expect(() => assertPhase1ImpactHonestyGates(before)).not.toThrow();

    writeFileSync(
      join(sandbox.dir, "src/adversarial/unused-caller.ts"),
      [
        'import { evalUnusedTarget } from "./unused";',
        "",
        "export function evalUnusedCaller(): string {",
        "  return evalUnusedTarget();",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "add caller for unused target"]);
    const analyze = await sandbox.runCli(["analyze"], { reject: false });
    expect(analyze.exitCode).toBe(0);

    const after = await evaluatePhase1ImpactHonesty(sandbox, db);
    expect(zeroDependents(after)?.predictions).toEqual([
      { file: "src/adversarial/unused-caller.ts", channel: "static" },
    ]);
    expect(() => assertPhase1ImpactHonestyGates(after)).toThrow(
      /negative specificity|false-positive rate/,
    );
    // Only the mutated scenario changed; every other case is byte-identical.
    expect(
      after.filter((result) => result.scenario !== "zero-dependents"),
    ).toEqual(before.filter((result) => result.scenario !== "zero-dependents"));
  }, 240_000);
});
