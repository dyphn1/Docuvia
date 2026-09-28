import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import { buildDistCli, type DistCliBuild } from "../../support/sandbox.js";
import {
  aggregateImpactHonesty,
  buildImpactHonestyMarkdown,
} from "../../support/impact-eval-honesty.js";
import {
  PHASE3_ANALYZE_EVENTS,
  PHASE3_CHECKPOINTS,
  PHASE3_FILES,
  PHASE3_TARGETS,
  runPhase3Corpus,
  type Phase3CorpusRun,
} from "../../support/impact-honesty-corpus.phase3.js";
import {
  PHASE3_ERROR_REASONS,
  PHASE3_KNOWN_PRODUCT_DEFECTS,
  assertPhase3ImpactHonestyGates,
  buildPhase3Evaluation,
  buildPhase3TransitionMarkdown,
  incompleteCertaintyRecords,
  isIngestedPhase,
  isStalePhase,
  partitionPhase3KnownDefects,
  phase3DeterminismViolations,
  phase3GateViolations,
  phase3KnownDefectRegistryProblems,
  poisonAccumulatedLink,
  poisonAddDependent,
  poisonDropDependent,
  poisonExactEmpty,
  poisonFreshnessOutOfContract,
  poisonOperationSucceeded,
  poisonPhantomRecord,
  poisonPhase3Observation,
  poisonPhase3Target,
  poisonStaleFreshEmpty,
  poisonStaleReportedFresh,
  poisonStdoutByte,
  type Phase3Evaluation,
  type Phase3GateId,
  type Phase3Observation,
} from "../../support/impact-honesty-transition.phase3.js";

// TDD-SOURCE: issue #508 Phase 3 staleness and graph state-transition robustness
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase3.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md
// TDD-SOURCE: issue #193 graph freshness visibility
// TDD-SOURCE: issue #480 SQLite concurrency (C1)
// TDD-SOURCE: docs/gitbook/adr/platform/PLAT-007-tiered-background-knowledge-evolution.md
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
// TDD-SOURCE: docs/gitbook/guidelines/phase-based-test-quality-hardening.md

/**
 * Two complete transition runs (each: 48 checkpoints of 3-5 concurrent `impact` calls plus
 * `status`, ~30 `analyze` runs, ~11 fresh-`init` oracles, and two 10 s knowledge-lock waits)
 * through the compiled CLI, plus one tsup build. Declared next to the Phase 2 constant pattern.
 */
const PHASE3_CORPUS_SETUP_TIMEOUT_MS = 8 * SUBPROCESS_TEST_TIMEOUT_MS;

const T = PHASE3_TARGETS;
const F = PHASE3_FILES;

function ids(predicate: (id: string) => boolean): string[] {
  return PHASE3_CHECKPOINTS.map((checkpoint) => checkpoint.id).filter(
    predicate,
  );
}

const STALE_IDS = PHASE3_CHECKPOINTS.filter((checkpoint) =>
  isStalePhase(checkpoint.phase),
).map((checkpoint) => checkpoint.id);
const INGESTED_IDS = PHASE3_CHECKPOINTS.filter((checkpoint) =>
  isIngestedPhase(checkpoint.phase),
).map((checkpoint) => checkpoint.id);
const R1_AFTER_IDS = ids((id) => id.startsWith("R1") && id.endsWith("@after"));

/** Checkpoints `ids`, optionally only `target`; lookups still see the whole run. */
function subset(
  evaluation: Phase3Evaluation,
  checkpointIds: readonly string[],
  target?: string,
): Phase3Evaluation {
  const checkpoints = evaluation.checkpoints
    .filter((result) => checkpointIds.includes(result.checkpoint.id))
    .map((result) => {
      if (target === undefined) return result;
      const targets = result.targets.filter((t) => t.golden.target === target);
      return {
        ...result,
        targets,
        records: targets.flatMap((t) => t.records),
      };
    });
  return {
    checkpoints,
    records: checkpoints.flatMap((result) => result.records),
    reference: evaluation.reference,
  };
}

function gatesFor(
  evaluation: Phase3Evaluation,
  checkpointIds: readonly string[],
  target?: string,
) {
  return phase3GateViolations(subset(evaluation, checkpointIds, target), {
    corpusLevel: false,
  });
}

function violationsOf(evaluation: Phase3Evaluation, gate: Phase3GateId) {
  return phase3GateViolations(evaluation).filter(
    (violation) => violation.gate === gate,
  );
}

function poisoned(
  run: Phase3CorpusRun,
  observations: readonly Phase3Observation[],
  checkpointId: string,
  target: string,
): () => void {
  const evaluation = buildPhase3Evaluation(run.checkpoints, observations);
  return () =>
    assertPhase3ImpactHonestyGates(subset(evaluation, [checkpointId], target), {
      corpusLevel: false,
    });
}

describe("Phase 3: impact staleness and graph state-transition robustness (#508)", () => {
  let dist: DistCliBuild;
  let first: Phase3CorpusRun;
  let second: Phase3CorpusRun;
  let merged: Phase3Evaluation;

  beforeAll(async () => {
    dist = await buildDistCli();
    first = await runPhase3Corpus(dist.cliPath);
    second = await runPhase3Corpus(dist.cliPath);
    merged = first.evaluation;
  }, PHASE3_CORPUS_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (dist) await dist.cleanup();
  });

  it("[happy] observes every checkpoint in contract order with <transition>@<phase>:<target>#<intent> accounting", () => {
    expect(
      first.observations.map((observation) => observation.checkpointId),
    ).toEqual(PHASE3_CHECKPOINTS.map((checkpoint) => checkpoint.id));
    for (const record of merged.records) {
      expect(record.scenario).toMatch(
        /^[A-Z0-9a-z]+@[a-zA-Z]+:[A-Za-z0-9]+#[a-z-]+$/,
      );
    }
    const aggregate = aggregateImpactHonesty(merged.records);
    expect(aggregate.epistemic.cases).toBeGreaterThanOrEqual(25);
    expect(buildImpactHonestyMarkdown(aggregate)).toContain(
      `| epistemic | ${aggregate.epistemic.cases} | false-safe rate |`,
    );
    const table = buildPhase3TransitionMarkdown(merged);
    for (const checkpoint of PHASE3_CHECKPOINTS) {
      expect(table).toContain(`| ${checkpoint.id} |`);
    }
  });

  it("[happy] T0 baseline: init yields the golden graph and equals the oracle", () => {
    expect(gatesFor(merged, ["T0@after"])).toEqual([]);
  });

  it("[happy] hooks never ran (H1) and the dirty worktree is recorded, not gated (O1, #523)", () => {
    expect(first.postCommitHookLogExists).toBe(false);
    expect(second.postCommitHookLogExists).toBe(false);
    // Q1 = HEAD-sha freshness: an uncommitted dependent is invisible and the graph reads fresh.
    expect(first.dirtyTree.statusFreshness).toBe("fresh");
    expect(first.dirtyTree.target.run.json).not.toHaveProperty(
      "graphFreshness",
    );
    expect(JSON.stringify(first.dirtyTree.target.entryFiles)).not.toContain(
      F.CALLER_G,
    );
  });

  it("[state-diff] every stale, failed and in-flight checkpoint reports stale + lower-bound, never the old graph as fresh (#508 D8)", () => {
    expect(gatesFor(merged, STALE_IDS)).toEqual([]);
    expect(
      violationsOf(
        partitionPhase3KnownDefects(merged, PHASE3_KNOWN_PRODUCT_DEFECTS).gated,
        "S13",
      ),
    ).toEqual([]);
    const staleTargets = subset(merged, STALE_IDS).checkpoints.flatMap(
      (c) => c.targets,
    );
    expect(staleTargets.every((target) => target.freshness === "stale")).toBe(
      true,
    );
  });

  it("[state-diff] a re-parse keeps incoming edges from unchanged files: T2-T4 exact and static, no dangling rows, no accumulation (#508 D9)", () => {
    expect(gatesFor(merged, ["T2@after", "T3@after", "T4@after"])).toEqual([]);
    for (const id of INGESTED_IDS.filter(
      (i) => !(i in PHASE3_KNOWN_PRODUCT_DEFECTS),
    )) {
      const observation = first.observations.find((o) => o.checkpointId === id);
      expect({ id, dangling: observation?.facts.dangling }).toEqual({
        id,
        dangling: 0,
      });
    }
    expect(
      gatesFor(merged, R1_AFTER_IDS).filter((v) => v.gate === "S11"),
    ).toEqual([]);
    expect(incompleteCertaintyRecords(subset(merged, ["T3@after"]))).toEqual(
      [],
    );
  });

  it("[state-diff] deleted and renamed files leave no per-path rows or edges behind (T5, T6, T7) (#508 D11)", () => {
    expect(gatesFor(merged, ["T5@after", "T6@after", "T7@after"])).toEqual([]);
  });

  it("[state-diff] a deleted candidate or loader leaves no stale candidate and no phantom evidence (T8, T9) (#508 D6)", () => {
    expect(gatesFor(merged, ["T8@after", "T9@after"])).toEqual([]);
  });

  it("[happy] the merged gated corpus passes S0-S13 on real CLI output (#508 D6, D8, D9, D11)", () => {
    const { gated } = partitionPhase3KnownDefects(
      merged,
      PHASE3_KNOWN_PRODUCT_DEFECTS,
    );
    expect(phase3GateViolations(gated)).toEqual([]);
    const aggregate = assertPhase3ImpactHonestyGates(gated);
    expect(aggregate.errorCases).toBe(0);
    expect(aggregate.epistemic.falseSafeRate).toBe(0);
    expect(aggregate.epistemic.wrongCertaintyCases).toBe(0);
    expect(incompleteCertaintyRecords(gated)).toEqual([]);
    expect(aggregate.provenance.mismatches).toBe(0);
  });

  it("[state-diff] T1 afterTierA: a delta that adds a file is partial through the product's own Tier B state", () => {
    expect(gatesFor(merged, ["T1@afterTierA"])).toEqual([]);
    const tierA = merged.checkpoints.find(
      (c) => c.checkpoint.id === "T1@afterTierA",
    );
    expect(
      tierA?.targets.every(
        (t) => t.observation?.run.json?.partialCoverage === true,
      ),
    ).toBe(true);
    expect(tierA?.targets[0].confirmedFiles).toContain(F.CALLER_C);
  });

  it("[state-diff] I1 in-flight: while the lock is held the graph cannot change (meta sha and dependents)", () => {
    const inflight = first.observations.find(
      (o) => o.checkpointId === "I1@inflight",
    );
    const f1 = first.observations.find((o) => o.checkpointId === "F1@after");
    expect(inflight?.metaSha).toBe(f1?.metaSha);
    expect(violationsOf(subset(merged, ["I1@inflight"]), "S7")).toEqual([]);
    const after = first.observations.find((o) => o.checkpointId === "I1@after");
    expect(
      after?.ungatedOperations?.map((operation) => operation.label),
    ).toEqual(["I1-background"]);
  });

  it("[error-handling] F1: a failed ingestion exits non-zero on the lock timeout and does not advance the graph sha", () => {
    const failed = first.observations.find(
      (o) => o.checkpointId === "F1@failed",
    );
    expect(failed?.operation?.exitCode).not.toBe(0);
    expect(failed?.operation?.events).toContain(
      PHASE3_ANALYZE_EVENTS.AUTO_ERROR,
    );
    expect(failed?.metaSha).toBe(failed?.metaShaBeforeOperation);
    expect(failed?.metaSha).not.toBe(failed?.headSha);
    // The failed operation stays a counted row: its records are in the denominators.
    expect(
      merged.records.filter((r) => r.scenario.startsWith("F1@failed:")).length,
    ).toBeGreaterThan(0);
  });

  it("[error-handling] an errored checkpoint stays in the denominator and fails S0", () => {
    const observations = first.observations.filter(
      (o) => o.checkpointId !== "T4@after",
    );
    const evaluation = buildPhase3Evaluation(first.checkpoints, observations);
    expect(evaluation.records).toHaveLength(merged.records.length);
    expect(() =>
      assertPhase3ImpactHonestyGates(subset(evaluation, ["T4@after"]), {
        corpusLevel: false,
      }),
    ).toThrow(/errored/);
  });

  it("[error-handling] every registered defect names its child issue and still fails its gates (D10 #522, D12 #521)", () => {
    expect(
      phase3KnownDefectRegistryProblems(
        PHASE3_KNOWN_PRODUCT_DEFECTS,
        first.checkpoints,
      ),
    ).toEqual([]);
    const { deferred } = partitionPhase3KnownDefects(
      merged,
      PHASE3_KNOWN_PRODUCT_DEFECTS,
    );
    expect(deferred.checkpoints.map((c) => c.checkpoint.id)).toEqual(
      Object.keys(PHASE3_KNOWN_PRODUCT_DEFECTS),
    );
    for (const result of deferred.checkpoints) {
      expect(gatesFor(merged, [result.checkpoint.id])).not.toEqual([]);
    }
  });

  it("[stress] T10: a dependent that grows past MAX_FILE_SIZE_BYTES keeps its stale rows (registered D10, #522)", () => {
    const t10 = first.observations.find((o) => o.checkpointId === "T10@after");
    // grow.ts is tracked but oversized, so it is outside the HEAD tree the graph may describe.
    expect(t10?.facts.headTree).not.toContain(F.GROW);
    expect(t10?.facts.nodePaths).toContain(F.GROW);
    expect(t10?.facts.callSitePaths).toContain(F.GROW);
    expect(t10?.operation?.exitCode).toBe(0);
    expect(violationsOf(subset(merged, ["T10@after"]), "S6")).not.toEqual([]);
  });

  it("[state-diff] T12: a HEAD rewind takes the full-ingestion fallback and leaves phantom state (registered D12, #521)", () => {
    const rewind = first.observations.find(
      (o) => o.checkpointId === "T12@after",
    );
    expect(rewind?.operation?.events).toContain(
      PHASE3_ANALYZE_EVENTS.HEAD_NOT_DESCENDANT,
    );
    expect(violationsOf(subset(merged, ["T12@after"]), "S9")).toEqual([]);
    expect(gatesFor(merged, ["T12@after"]).map((v) => v.gate)).toEqual(
      expect.arrayContaining(["S6", "S8"]),
    );
  });

  it("[invalid-input] T11: a removed symbol is not-found (exit 0) and cannot pass as UNKNOWN or fresh", () => {
    const t11 = merged.checkpoints.find((c) => c.checkpoint.id === "T11@after");
    const other = t11?.targets.find((t) => t.golden.target === T.OTHER);
    expect(other?.observation?.run.exitCode).toBe(0);
    expect(other?.observation?.run.json).toBeNull();
    expect(other?.freshness).toBe("not-applicable");
    expect(
      other?.records.map((r) => [r.intent, r.observedStatus, r.statusCorrect]),
    ).toEqual([["not-found", "not-found", true]]);
  });

  it("[invalid-input] Q10: an out-of-contract freshness value is an error, never fresh", () => {
    const observations = poisonPhase3Target(
      first.observations,
      "T1@before",
      T.TARGET,
      poisonFreshnessOutOfContract,
    );
    const evaluation = buildPhase3Evaluation(first.checkpoints, observations);
    const target = evaluation.checkpoints
      .find((c) => c.checkpoint.id === "T1@before")
      ?.targets.find((t) => t.golden.target === T.TARGET);
    expect(target?.errorReason).toBe(
      PHASE3_ERROR_REASONS.FRESHNESS_OUT_OF_CONTRACT,
    );
    expect(poisoned(first, observations, "T1@before", T.TARGET)).toThrow(
      /errored/,
    );
  });

  it("[stress] three concurrent read passes over T0 equal the sequential observation", () => {
    const t0 = first.observations.find((o) => o.checkpointId === "T0@after")!;
    const sequential = Object.fromEntries(
      t0.targets.map((t) => [t.target, t.run.stdout]),
    );
    expect(first.concurrentReads).toHaveLength(3);
    for (const pass of first.concurrentReads) expect(pass).toEqual(sequential);
  });

  it("[stress] C1: two concurrent analyze runs converge to the oracle after one sequential analyze (#480; #508 D6, D9, D11)", () => {
    expect(first.concurrentExitCodes).toHaveLength(2);
    expect(gatesFor(merged, ["C1@after"])).toEqual([]);
  });

  it("[state-diff] S12 determinism: two clean runs produce identical records, raw stdout, facts and events", () => {
    expect(phase3DeterminismViolations(first, second)).toEqual([]);
  });

  it("[negative-control] Q1: a removed dependent that survives re-ingest fails stale edge (masked by #508 D9)", () => {
    const observations = poisonPhase3Target(
      first.observations,
      "T6@after",
      T.TARGET,
      poisonAddDependent("evalP3CallerA"),
      { evalP3CallerA: [F.CALLER_A] },
    );
    expect(poisoned(first, observations, "T6@after", T.TARGET)).toThrow(
      /stale edge/,
    );
  });

  it("[negative-control] Q2: a stale graph reported fresh and empty fails false-safe", () => {
    const observations = poisonPhase3Target(
      first.observations,
      "T1@before",
      T.TARGET,
      poisonStaleFreshEmpty(F.TARGET),
    );
    expect(poisoned(first, observations, "T1@before", T.TARGET)).toThrow(
      /false-safe/,
    );
  });

  it("[negative-control] Q3: a failed ingestion scored as a clean empty answer fails ingestion failure", () => {
    let observations = poisonPhase3Target(
      first.observations,
      "F1@failed",
      T.TARGET,
      poisonExactEmpty,
    );
    observations = poisonPhase3Observation(
      observations,
      "F1@failed",
      poisonOperationSucceeded,
    );
    expect(poisoned(first, observations, "F1@failed", T.TARGET)).toThrow(
      /ingestion failure/,
    );
  });

  it("[negative-control] Q4: a stale non-empty result reported fresh fails wrong-certainty", () => {
    const observations = poisonPhase3Target(
      first.observations,
      "T1@before",
      T.TARGET,
      poisonStaleReportedFresh,
    );
    expect(poisoned(first, observations, "T1@before", T.TARGET)).toThrow(
      /wrong-certainty/,
    );
  });

  it("[negative-control] Q5: an exact answer missing a HEAD dependent fails incomplete-certainty", () => {
    const observations = poisonPhase3Target(
      first.observations,
      "T3@after",
      T.BASE,
      poisonDropDependent("EvalP3Sub"),
    );
    expect(poisoned(first, observations, "T3@after", T.BASE)).toThrow(
      /incomplete-certainty/,
    );
  });

  it("[negative-control] Q6: a phantom store record fails stale record (masked by #508 D9)", () => {
    const observations = poisonPhase3Observation(
      first.observations,
      "T6@after",
      poisonPhantomRecord(F.CALLER_A),
    );
    expect(poisoned(first, observations, "T6@after", T.TARGET)).toThrow(
      /stale record/,
    );
  });

  it("[negative-control] Q7: one byte of raw stdout differing in run 2 fails determinism", () => {
    const observations = poisonPhase3Observation(
      second.observations,
      "T4@after",
      poisonStdoutByte(T.OTHER),
    );
    const [violation] = phase3DeterminismViolations(first, {
      evaluation: buildPhase3Evaluation(second.checkpoints, observations),
      observations,
    });
    expect(violation?.message).toMatch(/determinism/);
  });

  it("[negative-control] Q8: an extra link after repeated ingestion fails accumulation", () => {
    const observations = poisonPhase3Observation(
      first.observations,
      "R1c2r@after",
      poisonAccumulatedLink,
    );
    expect(poisoned(first, observations, "R1c2r@after", T.TARGET)).toThrow(
      /accumulation/,
    );
  });

  it("[negative-control] Q9: a missing edge addition fails state-diff", () => {
    const observations = poisonPhase3Target(
      first.observations,
      "T4@after",
      T.OTHER,
      poisonDropDependent("evalP3Switch", true),
    );
    expect(poisoned(first, observations, "T4@after", T.OTHER)).toThrow(
      /state-diff/,
    );
  });

  it("[negative-control] unpoisoned poison targets pass every gate on their own (#508 D8, D9, D11)", () => {
    const controls: Array<[string, string]> = [
      ["T6@after", T.TARGET],
      ["T1@before", T.TARGET],
      ["F1@failed", T.TARGET],
      ["T3@after", T.BASE],
      ["R1c2r@after", T.TARGET],
      ["T4@after", T.OTHER],
    ];
    for (const [id, target] of controls) {
      expect({
        id,
        target,
        violations: gatesFor(merged, [id], target),
      }).toEqual({ id, target, violations: [] });
    }
  });
});
