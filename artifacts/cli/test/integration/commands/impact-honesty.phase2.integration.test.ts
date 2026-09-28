import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import { TestSandbox } from "../../support/sandbox.js";
import {
  aggregateImpactHonesty,
  buildImpactHonestyMarkdown,
} from "../../support/impact-eval-honesty.js";
import { dependencyPredictions } from "../../support/impact-honesty-corpus.phase1.js";
import {
  KNOWN_PRODUCT_DEFECTS,
  PHASE2_C1A_FILES,
  PHASE2_C1B_FILES,
  PHASE2_CORRUPTIONS,
  PHASE2_GOLDEN,
  PHASE2_GOLDEN_AB,
  PHASE2_GOLDEN_C,
  PHASE2_O65_FIRST_64_PATHS,
  PHASE2_SANDBOX_A_FILES,
  PHASE2_SANDBOX_B_FILES,
  PHASE2_SANDBOX_C_FILES,
  addFilesAndAnalyze,
  corruptDynamicEvidence,
  evaluatePhase2Stage,
  observePhase2Fixture,
  rawJsonStdout,
  restoreDynamicEvidence,
  sandboxDbPath,
  setupPhase2Sandbox,
  type Phase2StageResult,
} from "../../support/impact-honesty-corpus.phase2.js";
import {
  PHASE2_ERROR_REASONS,
  assertPhase2ImpactHonestyGates,
  buildPhase2Evaluation,
  buildPhase2EvidenceMarkdown,
  knownDefectRegistryProblems,
  mergePhase2Evaluations,
  partitionKnownDefects,
  phase2GateViolations,
  poisonConfidentEmpty,
  poisonFabricatedCertainty,
  poisonMaskedCoverage,
  poisonObservation,
  poisonOutOfContract,
  poisonPromoteCandidate,
  poisonRelabelFallback,
  poisonTruncateOverflow,
  predictionsFor,
  type Phase2Evaluation,
  type Phase2FixtureGolden,
  type Phase2GateId,
  type Phase2JsonMutation,
  type Phase2Observation,
} from "../../support/impact-honesty-epistemic.phase2.js";

// TDD-SOURCE: issue #508 Phase 2 epistemic honesty and dynamic-boundary worst cases
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
// TDD-SOURCE: issue #393 dynamic dependency evidence
// TDD-SOURCE: issue #217 lsp-fallback provenance
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
// TDD-SOURCE: docs/gitbook/guidelines/phase-based-test-quality-hardening.md

/**
 * The corpus beforeAll runs three `init`s, two coverage-seeded evaluation passes per sandbox,
 * two incremental `analyze` runs, three corrupted-artifact states and a snapshot/clean/hydrate
 * round trip — every one a serial batch of spawned `docuvia` processes. Budget one subprocess
 * allowance per stage, as Phase 1 does (plan §8: A 5x, B 3x, C 4x).
 */
const PHASE2_CORPUS_SETUP_TIMEOUT_MS = 12 * SUBPROCESS_TEST_TIMEOUT_MS;
const PHASE2_STRESS_TIMEOUT_MS = 3 * SUBPROCESS_TEST_TIMEOUT_MS;

type CStage = keyof typeof PHASE2_GOLDEN_C;
const C_STAGE_ORDER: readonly CStage[] = [
  "C0",
  "C2a",
  "C2b",
  "C2c",
  "C1a",
  "C1b",
  "C3",
];

async function writeFileEnsuringDir(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function goldenById(id: string): Phase2FixtureGolden {
  const golden = PHASE2_GOLDEN.find((candidate) => candidate.id === id);
  if (!golden) throw new Error(`no Phase 2 golden ${id}`);
  return golden;
}

function gatesFor(evaluation: Phase2Evaluation, ids: readonly string[]) {
  return phase2GateViolations(
    {
      fixtures: evaluation.fixtures.filter((fixture) =>
        ids.includes(fixture.golden.id),
      ),
      records: evaluation.records.filter((record) =>
        ids.includes(record.scenario.split("#")[0]),
      ),
    },
    { corpusLevel: false },
  );
}

function violationsOf(evaluation: Phase2Evaluation, gate: Phase2GateId) {
  return phase2GateViolations(evaluation).filter(
    (violation) => violation.gate === gate,
  );
}

function poisonedSingle(
  observations: readonly Phase2Observation[],
  fixtureId: string,
  mutation: Phase2JsonMutation,
): Phase2Evaluation {
  return buildPhase2Evaluation(
    [goldenById(fixtureId)],
    poisonObservation(observations, fixtureId, mutation),
  );
}

describe("Phase 2: impact epistemic honesty and dynamic-boundary corpus (#508)", () => {
  const sandboxA = new TestSandbox();
  const sandboxB = new TestSandbox();
  const sandboxC = new TestSandbox();
  let a: Phase2StageResult;
  let aRepeat: Phase2StageResult;
  let b: Phase2StageResult;
  let bRepeat: Phase2StageResult;
  const c = {} as Record<CStage, Phase2StageResult>;
  const cRepeat = {} as Record<CStage, Phase2StageResult>;
  let cRestored: Phase2StageResult;
  let merged: Phase2Evaluation;

  beforeAll(async () => {
    await setupPhase2Sandbox(sandboxA, PHASE2_SANDBOX_A_FILES);
    const goldenA = PHASE2_GOLDEN_AB.filter((golden) => golden.sandbox === "A");
    a = await evaluatePhase2Stage(sandboxA, goldenA, { human: true });
    aRepeat = await evaluatePhase2Stage(sandboxA, goldenA);

    await setupPhase2Sandbox(sandboxB, PHASE2_SANDBOX_B_FILES);
    const goldenB = PHASE2_GOLDEN_AB.filter((golden) => golden.sandbox === "B");
    b = await evaluatePhase2Stage(sandboxB, goldenB, { human: true });
    bRepeat = await evaluatePhase2Stage(sandboxB, goldenB);

    await setupPhase2Sandbox(sandboxC, PHASE2_SANDBOX_C_FILES);
    const observeC = async (stage: CStage) => {
      c[stage] = await evaluatePhase2Stage(sandboxC, PHASE2_GOLDEN_C[stage], {
        human: true,
      });
      cRepeat[stage] = await evaluatePhase2Stage(
        sandboxC,
        PHASE2_GOLDEN_C[stage],
      );
    };

    await observeC("C0");
    for (const stage of ["C2a", "C2b", "C2c"] as const) {
      const original = await corruptDynamicEvidence(
        sandboxC,
        PHASE2_CORRUPTIONS[stage],
      );
      await observeC(stage);
      await restoreDynamicEvidence(sandboxC, original);
    }
    cRestored = await evaluatePhase2Stage(sandboxC, PHASE2_GOLDEN_C.C0);

    await addFilesAndAnalyze(sandboxC, PHASE2_C1A_FILES, writeFileEnsuringDir);
    await observeC("C1a");
    await addFilesAndAnalyze(sandboxC, PHASE2_C1B_FILES, writeFileEnsuringDir);
    await observeC("C1b");

    const snapshot = await sandboxC.runCli(["snapshot"], { reject: false });
    expect(snapshot.exitCode).toBe(0);
    const clean = await sandboxC.runCli(["clean"], { reject: false });
    expect(clean.exitCode).toBe(0);
    await observeC("C3");

    merged = mergePhase2Evaluations([
      a.evaluation,
      b.evaluation,
      ...C_STAGE_ORDER.map((stage) => c[stage].evaluation),
    ]);
  }, PHASE2_CORPUS_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await sandboxA.teardown();
    await sandboxB.teardown();
    await sandboxC.teardown();
  });

  it("[happy] executes every golden fixture with stable <fixture>#<intent> accounting", () => {
    const executionOrder = [
      ...PHASE2_GOLDEN_AB.filter((golden) => golden.sandbox === "A"),
      ...PHASE2_GOLDEN_AB.filter((golden) => golden.sandbox === "B"),
      ...C_STAGE_ORDER.flatMap((stage) => PHASE2_GOLDEN_C[stage]),
    ];
    expect(executionOrder).toHaveLength(PHASE2_GOLDEN.length);
    expect(merged.fixtures.map((fixture) => fixture.golden.id)).toEqual(
      executionOrder.map((golden) => golden.id),
    );
    expect(merged.records.map((record) => record.scenario)).toEqual(
      executionOrder.flatMap((golden) =>
        golden.intents.map((intent) => `${golden.id}#${intent}`),
      ),
    );
    const aggregate = aggregateImpactHonesty(merged.records);
    expect(aggregate.epistemic.cases).toBeGreaterThanOrEqual(10);
    expect(buildImpactHonestyMarkdown(aggregate)).toContain(
      `| epistemic | ${aggregate.epistemic.cases} | false-safe rate |`,
    );
    for (const golden of PHASE2_GOLDEN) {
      expect(buildPhase2EvidenceMarkdown(merged)).toContain(`| ${golden.id} |`);
    }
  });

  // #508 D7: red until the product fix lands; that commit flips it.fails -> it.
  it.fails(
    "[happy] the merged real-CLI corpus passes every Phase 2 gate (G1-G9, G11, G12)",
    () => {
      const { gated } = partitionKnownDefects(merged, KNOWN_PRODUCT_DEFECTS);

      expect(phase2GateViolations(gated)).toEqual([]);
      const aggregate = assertPhase2ImpactHonestyGates(gated);
      expect(aggregate.errorCases).toBe(0);
      expect(aggregate.epistemic.falseSafeRate).toBe(0);
      expect(aggregate.epistemic.wrongCertaintyCases).toBe(0);
      expect(aggregate.candidate.coverage).toBe(1);
      expect(aggregate.provenance.mismatches).toBe(0);
    },
  );

  it("[happy] bounded single/literal/multi evidence stays candidate-only and matches golden (E1a, E1b, E2)", () => {
    expect(gatesFor(merged, ["E1a", "E1b", "E2"])).toEqual([]);
    const e2 = merged.fixtures.find((fixture) => fixture.golden.id === "E2");
    expect(e2?.evidence).toMatchObject({
      goldInCandidateSet: true,
      candidateSetSize: 3,
      unrelatedAdmitted: [],
      truncatedOrOverflow: false,
    });
    expect(
      e2?.records.find((record) => record.intent === "confirmed-positive")
        ?.confirmedPredictedFiles,
    ).toEqual(["src/p2/multi/direct-user.ts"]);
  });

  it("[happy] the exact static control is observable as resolved (G4 calibration, E8)", () => {
    const e8 = merged.fixtures.find((fixture) => fixture.golden.id === "E8");
    expect(e8?.epistemicStatus).toBe("resolved");
    expect(e8?.observation?.run.json).not.toHaveProperty("epistemic");
    expect(e8?.observation?.run.json).not.toHaveProperty("riskNote");
    expect(e8?.observation?.run.json).not.toHaveProperty("dynamicEvidence");
    expect(violationsOf(merged, "G4")).toEqual([]);
  });

  it("[happy] lsp-fallback recovery is labeled lsp-fallback, never static (E6, E7 provenance)", () => {
    expect(violationsOf(merged, "G5")).toEqual([]);
    const e6 = merged.fixtures.find((fixture) => fixture.golden.id === "E6");
    expect(e6?.records[0].predictions).toEqual([
      { file: "src/p2/recv/untyped-caller.ts", channel: "lsp-fallback" },
    ]);
  });

  // #508 D7: red until the product fix lands; that commit flips it.fails -> it.
  it.fails(
    "[happy] a computed member call is never reported as verified zero-impact (E7)",
    () => {
      expect(gatesFor(merged, ["E7"])).toEqual([]);
      const [record] = merged.fixtures.find(
        (fixture) => fixture.golden.id === "E7",
      )!.records;
      expect(record.epistemic).toEqual({
        correctUnknown: true,
        falseSafe: false,
        wrongCertainty: false,
      });
    },
  );

  it("[happy] NodeNext `.js` template specifiers bound .ts candidates (E9)", () => {
    expect(gatesFor(merged, ["E9"])).toEqual([]);
  });

  it("[happy] the pure prediction mapping equals Phase 1 dependencyPredictions on real output", () => {
    const db = new Database(sandboxDbPath(sandboxA), { readonly: true });
    try {
      for (const observation of a.observations) {
        if (observation.run.json === null || !observation.targetIdentity) {
          continue;
        }
        expect(predictionsFor(observation)).toEqual(
          dependencyPredictions(
            db,
            observation.run.json as unknown as Parameters<
              typeof dependencyPredictions
            >[1],
            observation.targetIdentity.filePath,
          ),
        );
      }
    } finally {
      db.close();
    }
  });

  it("[invalid-input] an unknown target is not-found and cannot pass as UNKNOWN", async () => {
    const golden: Phase2FixtureGolden = {
      ...goldenById("E7"),
      id: "unknown-target",
      target: "evalP2TargetThatDoesNotExist",
    };
    const observation = await observePhase2Fixture(sandboxA, golden);
    expect(observation.run.json).toBeNull();
    expect(observation.run.exitCode).toBe(0);

    const evaluation = buildPhase2Evaluation([golden], [observation]);
    expect(evaluation.records[0].observedStatus).toBe("not-found");
    expect(evaluation.records[0].epistemic?.correctUnknown).toBe(false);
    expect(() =>
      assertPhase2ImpactHonestyGates(evaluation, { corpusLevel: false }),
    ).toThrow(/unexpected status/);
  });

  it("[invalid-input] P7: a shape outside the documented contract is an error, never exact", () => {
    const poisoned = poisonedSingle(a.observations, "E8", poisonOutOfContract);
    expect(poisoned.fixtures[0].errorReason).toBe(
      PHASE2_ERROR_REASONS.OUT_OF_CONTRACT,
    );
    expect(() =>
      assertPhase2ImpactHonestyGates(poisoned, { corpusLevel: false }),
    ).toThrow(/errored/);
  });

  it("[error-handling] corrupted evidence artifacts degrade to explicit evidence-unavailable (C2a/b/c)", () => {
    for (const stage of ["C2a", "C2b", "C2c"] as const) {
      const [fixture] = c[stage].evaluation.fixtures;
      expect(fixture.observation?.run.exitCode).toBe(0);
      expect(fixture.epistemicStatus).toBe("unknown");
      expect(fixture.evidence.evidenceUnavailableReason).toBe(
        fixture.golden.expectedUnavailableReason,
      );
      expect(gatesFor(c[stage].evaluation, [stage])).toEqual([]);
    }
  });

  it("[error-handling] an errored record stays in the denominator and fails G1", () => {
    const observations = a.observations.map((observation) =>
      observation.fixtureId === "E8"
        ? {
            ...observation,
            run: { ...observation.run, exitCode: 1, json: null },
          }
        : observation,
    );
    const evaluation = buildPhase2Evaluation(
      PHASE2_GOLDEN_AB.filter((golden) => golden.sandbox === "A"),
      observations,
    );
    const aggregate = aggregateImpactHonesty(evaluation.records);

    expect(aggregate.totalCases).toBe(a.evaluation.records.length);
    expect(aggregate.errorCases).toBe(1);
    expect(() =>
      assertPhase2ImpactHonestyGates(evaluation, { corpusLevel: false }),
    ).toThrow(/1 case\(s\) errored/);
  });

  it("[error-handling] every deferred product defect names a child issue and still fails its gate", () => {
    expect(
      knownDefectRegistryProblems(KNOWN_PRODUCT_DEFECTS, PHASE2_GOLDEN),
    ).toEqual([]);
    const { deferred } = partitionKnownDefects(merged, KNOWN_PRODUCT_DEFECTS);
    expect(deferred.fixtures.map((fixture) => fixture.golden.id)).toEqual(
      Object.keys(KNOWN_PRODUCT_DEFECTS),
    );
    for (const fixture of deferred.fixtures) {
      expect(gatesFor(deferred, [fixture.golden.id])).not.toEqual([]);
    }
  });

  it("[stress] 64 candidates stay bounded and 65 take the overflow path (E3, E4a, E4b, G8)", () => {
    expect(violationsOf(merged, "G8")).toEqual([]);
    expect(gatesFor(merged, ["E3", "E4a", "E4b"])).toEqual([]);
    const e3 = merged.fixtures.find((fixture) => fixture.golden.id === "E3");
    expect(e3?.evidence.candidateSetSize).toBe(64);
    const e4a = merged.fixtures.find((fixture) => fixture.golden.id === "E4a");
    expect(e4a?.evidence).toMatchObject({
      candidateSetSize: null,
      goldInCandidateSet: null,
      truncatedOrOverflow: true,
    });
  });

  it("[stress] unbounded runtime imports never produce verified zero-impact (E5a, E5b)", () => {
    expect(gatesFor(merged, ["E5a", "E5b"])).toEqual([]);
  });

  it(
    "[stress] concurrent evaluations over Sandbox A match the sequential baseline",
    async () => {
      const goldenA = PHASE2_GOLDEN_AB.filter(
        (golden) => golden.sandbox === "A",
      );
      const concurrent = await Promise.all(
        [0, 1, 2].map(() => evaluatePhase2Stage(sandboxA, goldenA)),
      );
      for (const run of concurrent) {
        expect(run.evaluation.records).toEqual(aRepeat.evaluation.records);
        expect(rawJsonStdout(run.observations)).toEqual(
          rawJsonStdout(aRepeat.observations),
        );
      }
    },
    PHASE2_STRESS_TIMEOUT_MS,
  );

  it("[state-diff] G10 determinism: two evaluations of every state are identical", () => {
    const pairs: Array<[Phase2StageResult, Phase2StageResult]> = [
      [a, aRepeat],
      [b, bRepeat],
      ...C_STAGE_ORDER.map((stage): [Phase2StageResult, Phase2StageResult] => [
        c[stage],
        cRepeat[stage],
      ]),
    ];
    for (const [first, second] of pairs) {
      expect(second.evaluation.records).toEqual(first.evaluation.records);
      expect(rawJsonStdout(second.observations)).toEqual(
        rawJsonStdout(first.observations),
      );
    }
  });

  it("[state-diff] restoring the corrupted artifact restores the C0 baseline byte-for-byte", () => {
    expect(cRestored.evaluation.records).toEqual(c.C0.evaluation.records);
    expect(rawJsonStdout(cRestored.observations)).toEqual(
      rawJsonStdout(c.C0.observations),
    );
    expect(gatesFor(c.C0.evaluation, ["C0-alpha", "C0-deg64"])).toEqual([]);
  });

  it("[state-diff] a stale candidate universe never creates certainty (C1a, C1b vs C0)", () => {
    expect(gatesFor(c.C1a.evaluation, ["C1a"])).toEqual([]);
    expect(gatesFor(c.C1b.evaluation, ["C1b-p00", "C1b-p64"])).toEqual([]);
    const before = c.C0.evaluation.fixtures.find(
      (fixture) => fixture.golden.id === "C0-deg64",
    );
    const after = c.C1b.evaluation.fixtures.find(
      (fixture) => fixture.golden.id === "C1b-p00",
    );
    expect(before?.evidence.candidateSetSize).toBe(64);
    expect(after?.evidence.truncatedOrOverflow).toBe(true);
  });

  it("[state-diff] snapshot -> clean -> auto-hydrate reports missing evidence, not exact (C3)", () => {
    expect(gatesFor(c.C3.evaluation, ["C3"])).toEqual([]);
    const [fixture] = c.C3.evaluation.fixtures;
    expect(fixture.observation?.run.json).not.toHaveProperty("partialCoverage");
    expect(fixture.epistemicStatus).toBe("unknown");
  });

  it("[negative-control] P1: a promoted dynamic candidate fails provenance (and positive) gates", () => {
    const poisoned = poisonedSingle(
      a.observations,
      "E2",
      poisonPromoteCandidate,
    );
    expect(() =>
      assertPhase2ImpactHonestyGates(poisoned, { corpusLevel: false }),
    ).toThrow(/provenance/);
    expect(
      phase2GateViolations(poisoned, { corpusLevel: false }).map(
        (violation) => violation.gate,
      ),
    ).toEqual(expect.arrayContaining(["G5", "G6", "G11"]));
  });

  it("[negative-control] P2: UNKNOWN rewritten as a confident empty answer fails false-safe", () => {
    const poisoned = poisonedSingle(
      a.observations,
      "E4a",
      poisonConfidentEmpty,
    );
    expect(() =>
      assertPhase2ImpactHonestyGates(poisoned, { corpusLevel: false }),
    ).toThrow(/false-safe/);
  });

  it("[negative-control] P3: overflow truncated to a bounded set fails the overflow gate", () => {
    const poisoned = poisonedSingle(
      a.observations,
      "E4a",
      poisonTruncateOverflow(PHASE2_O65_FIRST_64_PATHS),
    );
    expect(() =>
      assertPhase2ImpactHonestyGates(poisoned, { corpusLevel: false }),
    ).toThrow(/overflow/);
  });

  it("[negative-control] P4: fabricated certainty on a non-empty result fails wrong-certainty", () => {
    const poisoned = poisonedSingle(
      a.observations,
      "E2",
      poisonFabricatedCertainty,
    );
    expect(() =>
      assertPhase2ImpactHonestyGates(poisoned, { corpusLevel: false }),
    ).toThrow(/wrong-certainty/);
  });

  it("[negative-control] P5: lsp-fallback relabeled static fails provenance", () => {
    const poisoned = poisonedSingle(
      a.observations,
      "E6",
      poisonRelabelFallback,
    );
    expect(() =>
      assertPhase2ImpactHonestyGates(poisoned, { corpusLevel: false }),
    ).toThrow(/provenance/);
  });

  it("[negative-control] P6: masked coverage fails G1 as coverage-masked", () => {
    const poisoned = poisonedSingle(a.observations, "E8", poisonMaskedCoverage);
    expect(() =>
      assertPhase2ImpactHonestyGates(poisoned, { corpusLevel: false }),
    ).toThrow(/coverage-masked/);
  });

  it("[negative-control] unpoisoned poison targets pass on their own (the controls are not vacuous)", () => {
    for (const id of ["E2", "E4a", "E6", "E8"]) {
      expect(gatesFor(merged, [id])).toEqual([]);
    }
  });
});
