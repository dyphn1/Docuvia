import { describe, expect, it } from "vitest";
import type { RawImpactRun } from "./impact-honesty-epistemic.phase2.js";
import {
  PHASE3_ERROR_REASONS,
  PHASE3_KNOWN_PRODUCT_DEFECTS,
  PHASE3_PHASES,
  assertPhase3ImpactHonestyGates,
  buildPhase3Evaluation,
  buildPhase3TransitionMarkdown,
  incompleteCertaintyRecords,
  intentsFor,
  normalizeImpactForOracle,
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
  projectFreshness,
  staleRecordProblems,
  type Phase3Checkpoint,
  type Phase3Observation,
  type Phase3StoreFacts,
  type Phase3TargetGolden,
  type Phase3TargetObservation,
} from "./impact-honesty-transition.phase3.js";

// TDD-SOURCE: issue #508 Phase 3 staleness and graph state-transition robustness
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase3.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md
// TDD-SOURCE: issue #193 graph freshness visibility
// TDD-SOURCE: docs/gitbook/adr/platform/PLAT-007-tiered-background-knowledge-evolution.md
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
// TDD-SOURCE: docs/gitbook/guidelines/phase-based-test-quality-hardening.md

const SHA_OLD = "a".repeat(40);
const SHA_NEW = "b".repeat(40);
const SHA_NEWER = "c".repeat(40);

const T_FILE = "src/core/target.ts";
const CTRL_FILE = "src/ctrl/target.ts";

function run(json: Record<string, unknown> | null, exitCode = 0): RawImpactRun {
  return {
    exitCode,
    stdout: JSON.stringify(json),
    stderr: "",
    json,
    parseError: false,
  };
}

function staleFields(graphSha: string, headSha: string) {
  return {
    epistemic: "lower-bound",
    riskNote: `The knowledge graph reflects ${graphSha.slice(0, 7)} but HEAD is ${headSha.slice(0, 7)}`,
    graphFreshness: { state: "stale", graphSourceSha: graphSha, headSha },
  };
}

function impactJson(
  ownFile: string,
  dependents: readonly string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    blastRadius: [
      { name: ownFile, type: "module" },
      ...dependents.map((name) => ({ name, type: "module" })),
    ],
    riskLevel: "MEDIUM",
    ...extra,
  };
}

/** Dependent symbol `evalUserX` lives in `src/users/x.ts`; the control's user in `src/ctrl/user.ts`. */
function fileOf(dependent: string): string {
  if (dependent === "evalCtrlUser") return "src/ctrl/user.ts";
  return `src/users/${dependent.replace("evalUser", "").toLowerCase()}.ts`;
}

function targetObservation(
  target: string,
  ownFile: string,
  json: Record<string, unknown> | null,
  human?: string,
): Phase3TargetObservation {
  const names = Array.isArray(json?.blastRadius)
    ? (json!.blastRadius as Array<{ name: string }>).map((entry) => entry.name)
    : [];
  return {
    target,
    run: run(json),
    ...(human === undefined ? {} : { human: { ...run(null), stdout: human } }),
    targetIdentity:
      json === null
        ? null
        : { identity: `${ownFile}#${target}`, filePath: ownFile },
    entryFiles: Object.fromEntries(
      names.map((name) => [name, [name === ownFile ? ownFile : fileOf(name)]]),
    ),
  };
}

const TREE = [
  T_FILE,
  CTRL_FILE,
  "src/ctrl/user.ts",
  "src/users/a.ts",
  "src/users/b.ts",
  "src/users/c.ts",
];

function facts(
  overrides: Partial<Phase3StoreFacts> = {},
  tree: readonly string[] = TREE,
): Phase3StoreFacts {
  return {
    counts: {
      l2Nodes: 10,
      nodeLinks: 8,
      callSites: 4,
      projectFiles: tree.length,
      evidenceRecords: 0,
    },
    dangling: 0,
    nodePaths: [...tree],
    callSitePaths: [...tree],
    projectFilePaths: [...tree],
    evidencePaths: [],
    callResolutionPaths: [...tree],
    headTree: [...tree],
    ...overrides,
  };
}

function golden(
  target: string,
  targetFile: string,
  confirmed: readonly string[],
): Phase3TargetGolden {
  return {
    target,
    targetFile,
    expectedConfirmedFiles: confirmed,
    expectedCandidateFiles: [],
    expectedEvidence: [],
    expectedEpistemic: "exact",
  };
}

const CTRL = golden("evalCtrl", CTRL_FILE, ["src/ctrl/user.ts"]);
const TARGET_T0 = golden("evalTarget", T_FILE, [
  "src/users/a.ts",
  "src/users/b.ts",
]);
const TARGET_T1 = golden("evalTarget", T_FILE, [
  "src/users/a.ts",
  "src/users/b.ts",
  "src/users/c.ts",
]);
const TARGET_T2 = golden("evalTarget", T_FILE, [
  "src/users/b.ts",
  "src/users/c.ts",
]);

function ctrlJson(extra: Record<string, unknown> = {}) {
  return { ...impactJson(CTRL_FILE, ["evalCtrlUser"]), ...extra };
}

const CHECKPOINTS: Phase3Checkpoint[] = [
  {
    id: "T0@after",
    transition: "T0",
    phase: "after",
    expectedFreshness: "fresh",
    expectedCoverage: "complete",
    targets: [TARGET_T0, CTRL],
    oracle: true,
    operation: "success",
  },
  {
    id: "T1@before",
    transition: "T1",
    phase: "before",
    expectedFreshness: "stale",
    expectedCoverage: "complete",
    targets: [
      { ...TARGET_T0, expectedEpistemic: "lower-bound" },
      { ...CTRL, expectedEpistemic: "lower-bound" },
    ],
    previousFresh: "T0@after",
  },
  {
    id: "T1@after",
    transition: "T1",
    phase: "after",
    expectedFreshness: "fresh",
    expectedCoverage: "complete",
    targets: [TARGET_T1, CTRL],
    previousFresh: "T0@after",
    operation: "success",
  },
  {
    id: "T2@after",
    transition: "T2",
    phase: "after",
    expectedFreshness: "fresh",
    expectedCoverage: "complete",
    targets: [TARGET_T2, CTRL],
    previousFresh: "T1@after",
    mustDisappear: { "*": ["src/users/a.ts"] },
    operation: "success",
  },
  {
    id: "F1@failed",
    transition: "F1",
    phase: "failed",
    expectedFreshness: "stale",
    expectedCoverage: "complete",
    targets: [
      { ...TARGET_T2, expectedEpistemic: "lower-bound" },
      { ...CTRL, expectedEpistemic: "lower-bound" },
    ],
    previousFresh: "T2@after",
    operation: "failure",
  },
  {
    id: "R1@after",
    transition: "R1",
    phase: "after",
    expectedFreshness: "fresh",
    expectedCoverage: "complete",
    targets: [TARGET_T2, CTRL],
    previousFresh: "T2@after",
    accumulationReference: "T2@after",
    operation: "success",
  },
];

const FRESH_NOTE_FREE = "Blast radius\nRisk level: MEDIUM\n";
const STALE_HUMAN = "Blast radius\nNote: stale\nRisk level: MEDIUM\n";

function observation(
  checkpointId: string,
  headSha: string,
  metaSha: string,
  targets: Phase3TargetObservation[],
  extra: Partial<Phase3Observation> = {},
  tree: readonly string[] = TREE,
): Phase3Observation {
  return {
    checkpointId,
    headSha,
    metaSha,
    statusFreshness: headSha === metaSha ? "fresh" : "stale",
    targets,
    facts: facts({}, tree),
    ...extra,
  };
}

function freshTarget(dependents: readonly string[]) {
  return targetObservation(
    "evalTarget",
    T_FILE,
    impactJson(T_FILE, dependents),
    FRESH_NOTE_FREE,
  );
}

function staleTarget(
  dependents: readonly string[],
  graph: string,
  head: string,
) {
  return targetObservation(
    "evalTarget",
    T_FILE,
    impactJson(T_FILE, dependents, staleFields(graph, head)),
    STALE_HUMAN,
  );
}

function freshCtrl() {
  return targetObservation("evalCtrl", CTRL_FILE, ctrlJson());
}

function staleCtrl(graph: string, head: string) {
  return targetObservation(
    "evalCtrl",
    CTRL_FILE,
    ctrlJson(staleFields(graph, head)),
  );
}

function oracleFor(targets: Phase3TargetObservation[]): Record<string, string> {
  return Object.fromEntries(
    targets.map((target) => [
      target.target,
      normalizeImpactForOracle(target.run.json),
    ]),
  );
}

function honestObservations(): Phase3Observation[] {
  const t0 = [freshTarget(["evalUserA", "evalUserB"]), freshCtrl()];
  return [
    observation("T0@after", SHA_OLD, SHA_OLD, t0, {
      oracle: oracleFor(t0),
      operation: { label: "init", exitCode: 0, events: [] },
    }),
    observation("T1@before", SHA_NEW, SHA_OLD, [
      staleTarget(["evalUserA", "evalUserB"], SHA_OLD, SHA_NEW),
      staleCtrl(SHA_OLD, SHA_NEW),
    ]),
    observation(
      "T1@after",
      SHA_NEW,
      SHA_NEW,
      [freshTarget(["evalUserA", "evalUserB", "evalUserC"]), freshCtrl()],
      {
        operation: {
          label: "analyze",
          exitCode: 0,
          events: ["analyze.delta.summary"],
        },
      },
    ),
    observation(
      "T2@after",
      SHA_NEWER,
      SHA_NEWER,
      [freshTarget(["evalUserB", "evalUserC"]), freshCtrl()],
      { operation: { label: "analyze", exitCode: 0, events: [] } },
      TREE.filter((path) => path !== "src/users/a.ts"),
    ),
    observation(
      "F1@failed",
      SHA_NEW,
      SHA_NEWER,
      [
        staleTarget(["evalUserB", "evalUserC"], SHA_NEWER, SHA_NEW),
        staleCtrl(SHA_NEWER, SHA_NEW),
      ],
      {
        metaShaBeforeOperation: SHA_NEWER,
        operation: {
          label: "analyze",
          exitCode: 1,
          events: ["analyze.auto.error"],
        },
      },
    ),
    observation(
      "R1@after",
      SHA_NEWER,
      SHA_NEWER,
      [freshTarget(["evalUserB", "evalUserC"]), freshCtrl()],
      { operation: { label: "analyze", exitCode: 0, events: [] } },
      TREE.filter((path) => path !== "src/users/a.ts"),
    ),
  ];
}

function evaluate(observations: readonly Phase3Observation[]) {
  return buildPhase3Evaluation(CHECKPOINTS, observations);
}

function gatesOf(observations: readonly Phase3Observation[]) {
  return phase3GateViolations(evaluate(observations), {
    corpusLevel: false,
  }).map((violation) => violation.gate);
}

function assertSubset(observations: readonly Phase3Observation[]) {
  return () =>
    assertPhase3ImpactHonestyGates(evaluate(observations), {
      corpusLevel: false,
    });
}

describe("Phase 3 freshness projection (contract §1.1)", () => {
  it("[happy] an absent graphFreshness is fresh and a well-formed stale object is stale", () => {
    expect(projectFreshness(run(impactJson(T_FILE, ["evalUserA"])))).toBe(
      "fresh",
    );
    expect(
      projectFreshness(
        run(impactJson(T_FILE, ["evalUserA"], staleFields(SHA_OLD, SHA_NEW))),
      ),
    ).toBe("stale");
  });

  it("[invalid-input] not-found and failed runs are not-applicable", () => {
    expect(projectFreshness(run(null))).toBe("not-applicable");
    expect(projectFreshness(run(impactJson(T_FILE, []), 1))).toBe(
      "not-applicable",
    );
  });

  it.each([
    [
      "state fresh",
      {
        graphFreshness: {
          state: "fresh",
          graphSourceSha: SHA_OLD,
          headSha: SHA_NEW,
        },
      },
    ],
    ["state unknown", { graphFreshness: { state: "unknown" } }],
    ["non-object", { graphFreshness: "stale" }],
    [
      "short sha",
      {
        graphFreshness: {
          state: "stale",
          graphSourceSha: "abc",
          headSha: SHA_NEW,
        },
      },
    ],
    [
      "equal shas",
      {
        graphFreshness: {
          state: "stale",
          graphSourceSha: SHA_NEW,
          headSha: SHA_NEW,
        },
      },
    ],
  ])("[invalid-input] %s is out of contract (error)", (_label, fields) => {
    const json = impactJson(T_FILE, ["evalUserA"], {
      ...staleFields(SHA_OLD, SHA_NEW),
      ...fields,
    });
    expect(projectFreshness(run(json))).toBe("error");
  });

  it("[invalid-input] a stale result that is exact or has no note is out of contract", () => {
    const { epistemic: _e, ...noEpistemic } = staleFields(SHA_OLD, SHA_NEW);
    expect(
      projectFreshness(run(impactJson(T_FILE, ["evalUserA"], noEpistemic))),
    ).toBe("error");
    expect(
      projectFreshness(
        run(
          impactJson(T_FILE, ["evalUserA"], {
            ...staleFields(SHA_OLD, SHA_NEW),
            riskNote: "",
          }),
        ),
      ),
    ).toBe("error");
  });
});

describe("Phase 3 per-checkpoint Phase 0 records (contract §1.3)", () => {
  it("[happy] stale phases contribute only #epistemic-unknown; after derives intents from the golden", () => {
    for (const phase of [
      PHASE3_PHASES.BEFORE,
      PHASE3_PHASES.FAILED,
      PHASE3_PHASES.INFLIGHT,
      PHASE3_PHASES.AFTER_TIER_A,
    ]) {
      expect(intentsFor(phase, TARGET_T0)).toEqual(["epistemic-unknown"]);
    }
    expect(intentsFor("after", TARGET_T0)).toEqual(["confirmed-positive"]);
    expect(
      intentsFor("after", { ...TARGET_T0, expectedEpistemic: "lower-bound" }),
    ).toEqual(["confirmed-positive", "epistemic-unknown"]);
    expect(
      intentsFor("after", { ...TARGET_T0, expectedConfirmedFiles: [] }),
    ).toEqual(["negative", "epistemic-unknown"]);
    expect(
      intentsFor("after", {
        ...TARGET_T0,
        expectedCandidateFiles: ["src/loader.ts"],
      }),
    ).toEqual(["candidate-boundary", "epistemic-unknown"]);
    expect(intentsFor("after", { ...TARGET_T0, notFound: true })).toEqual([
      "not-found",
    ]);
  });

  it("[happy] the honest synthetic transition sequence passes every gate", () => {
    const evaluation = evaluate(honestObservations());
    expect(phase3GateViolations(evaluation, { corpusLevel: false })).toEqual(
      [],
    );
    expect(evaluation.records.map((record) => record.scenario)).toContain(
      "T1@before:evalTarget#epistemic-unknown",
    );
    expect(buildPhase3TransitionMarkdown(evaluation)).toContain(
      "| T1@before |",
    );
  });

  it("[error-handling] corpus-level non-vacuity minimums fail a tiny evaluation", () => {
    const messages = phase3GateViolations(evaluate(honestObservations())).map(
      (violation) => violation.message,
    );
    expect(
      messages.some((message) => /false-safe gate is vacuous/.test(message)),
    ).toBe(true);
    expect(
      messages.some((message) => /freshness gate is vacuous/.test(message)),
    ).toBe(true);
  });

  it("[error-handling] a missing observation stays in the denominator and errors", () => {
    const observations = honestObservations().filter(
      (observation) => observation.checkpointId !== "T1@before",
    );
    const evaluation = evaluate(observations);
    expect(evaluation.records).toHaveLength(
      evaluate(honestObservations()).records.length,
    );
    expect(assertSubset(observations)).toThrow(/errored/);
  });

  it("[error-handling] coverage-mismatch is reported by name", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@after",
      "evalTarget",
      (json) => ({
        ...json,
        partialCoverage: true,
        epistemic: "lower-bound",
        riskNote: "partial",
      }),
    );
    const result = evaluate(poisoned).checkpoints.find(
      (c) => c.checkpoint.id === "T1@after",
    );
    expect(result?.targets[0].errorReason).toBe(
      PHASE3_ERROR_REASONS.COVERAGE_MISMATCH,
    );
    expect(assertSubset(poisoned)).toThrow(/coverage-mismatch/);
  });
});

describe("Phase 3 gates and poisoned controls (contract §4, §5)", () => {
  it("[negative-control] Q1: a removed dependent that survives re-ingest fails stale edge", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T2@after",
      "evalTarget",
      poisonAddDependent("evalUserA"),
      { evalUserA: ["src/users/a.ts"] },
    );
    expect(assertSubset(poisoned)).toThrow(/stale edge/);
    expect(gatesOf(poisoned)).toEqual(
      expect.arrayContaining(["S5", "S7", "S10"]),
    );
  });

  it("[negative-control] Q2: a stale graph reported fresh and empty fails false-safe", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@before",
      "evalTarget",
      poisonStaleFreshEmpty(T_FILE),
    );
    expect(assertSubset(poisoned)).toThrow(/false-safe/);
    expect(gatesOf(poisoned)).toContain("S1");
  });

  it("[negative-control] Q3: a failed ingestion scored as clean empty fails ingestion failure", () => {
    let poisoned = poisonPhase3Target(
      honestObservations(),
      "F1@failed",
      "evalTarget",
      poisonExactEmpty,
    );
    poisoned = poisonPhase3Observation(
      poisoned,
      "F1@failed",
      poisonOperationSucceeded,
    );
    expect(assertSubset(poisoned)).toThrow(/ingestion failure/);
    expect(gatesOf(poisoned)).toContain("S2");
  });

  it("[negative-control] S9 also rejects a failed operation that advanced the meta sha", () => {
    const poisoned = poisonPhase3Observation(
      honestObservations(),
      "F1@failed",
      (observation) => ({
        ...observation,
        metaShaBeforeOperation: SHA_NEW,
      }),
    );
    expect(assertSubset(poisoned)).toThrow(/ingestion failure/);
  });

  it("[negative-control] Q4: a stale non-empty result reported fresh fails wrong-certainty (and freshness)", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@before",
      "evalTarget",
      poisonStaleReportedFresh,
    );
    expect(assertSubset(poisoned)).toThrow(/wrong-certainty/);
    expect(gatesOf(poisoned)).toContain("S1");
  });

  it("[negative-control] Q5: an exact answer that omits a HEAD dependent fails incomplete-certainty", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@after",
      "evalTarget",
      poisonDropDependent("evalUserC"),
    );
    expect(incompleteCertaintyRecords(evaluate(poisoned))).toHaveLength(1);
    expect(assertSubset(poisoned)).toThrow(/incomplete-certainty/);
  });

  it("[negative-control] Q6: a phantom store record fails stale record", () => {
    const poisoned = poisonPhase3Observation(
      honestObservations(),
      "T2@after",
      poisonPhantomRecord("src/users/a.ts"),
    );
    expect(assertSubset(poisoned)).toThrow(/stale record/);
  });

  it("[negative-control] Q7: one byte of raw stdout differing between runs fails determinism", () => {
    const first = honestObservations();
    const second = poisonPhase3Observation(
      first,
      "T2@after",
      poisonStdoutByte("evalTarget"),
    );
    expect(
      phase3DeterminismViolations(
        { evaluation: evaluate(first), observations: first },
        { evaluation: evaluate(first), observations: first },
      ),
    ).toEqual([]);
    const [violation] = phase3DeterminismViolations(
      { evaluation: evaluate(first), observations: first },
      { evaluation: evaluate(second), observations: second },
    );
    expect(violation.message).toMatch(/determinism/);
    expect(violation.checkpoints).toEqual(["T2@after"]);
  });

  it("[negative-control] Q8: an extra link after repeated ingestion fails accumulation", () => {
    const poisoned = poisonPhase3Observation(
      honestObservations(),
      "R1@after",
      poisonAccumulatedLink,
    );
    expect(assertSubset(poisoned)).toThrow(/accumulation/);
  });

  it("[negative-control] Q9: a missing edge addition fails state-diff (and positive)", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@after",
      "evalTarget",
      poisonDropDependent("evalUserC", true),
    );
    expect(assertSubset(poisoned)).toThrow(/state-diff/);
    expect(gatesOf(poisoned)).toContain("S10");
  });

  it("can remove both an exact caller and its file context from a poisoned result", () => {
    const mutation = poisonDropDependent(["evalUserC", "src/users/c.ts"], true);
    const poisoned = mutation({
      blastRadius: [
        { name: "evalUserC" },
        { name: "src/users/c.ts" },
        { name: "src/users/keep.ts" },
      ],
    });

    expect(poisoned.blastRadius).toEqual([{ name: "src/users/keep.ts" }]);
  });

  it("[negative-control] Q10: an out-of-contract freshness value is an error, never fresh", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@before",
      "evalTarget",
      poisonFreshnessOutOfContract,
    );
    const result = evaluate(poisoned).checkpoints.find(
      (c) => c.checkpoint.id === "T1@before",
    );
    expect(result?.targets[0].errorReason).toBe(
      PHASE3_ERROR_REASONS.FRESHNESS_OUT_OF_CONTRACT,
    );
    expect(assertSubset(poisoned)).toThrow(/errored/);
  });

  it("[negative-control] a stale graph whose graphSourceSha differs from the meta fact fails freshness", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@before",
      "evalTarget",
      (json) => ({
        ...json,
        graphFreshness: {
          state: "stale",
          graphSourceSha: SHA_NEWER,
          headSha: SHA_NEW,
        },
      }),
    );
    expect(assertSubset(poisoned)).toThrow(/freshness/);
  });

  it("[negative-control] a status row that disagrees with the golden fails freshness", () => {
    const poisoned = poisonPhase3Observation(
      honestObservations(),
      "T1@before",
      (observation) => ({
        ...observation,
        statusFreshness: "fresh",
      }),
    );
    expect(assertSubset(poisoned)).toThrow(/freshness/);
  });

  it("[negative-control] a human run without the Note: line fails freshness parity", () => {
    const poisoned = poisonPhase3Observation(
      honestObservations(),
      "T1@before",
      (observation) => ({
        ...observation,
        targets: observation.targets.map((target) =>
          target.human
            ? { ...target, human: { ...target.human, stdout: FRESH_NOTE_FREE } }
            : target,
        ),
      }),
    );
    expect(assertSubset(poisoned)).toThrow(/freshness/);
  });

  it("[negative-control] an oracle mismatch fails the oracle gate", () => {
    const poisoned = poisonPhase3Observation(
      honestObservations(),
      "T0@after",
      (observation) => ({
        ...observation,
        oracle: { ...observation.oracle, evalTarget: "null" },
      }),
    );
    expect(assertSubset(poisoned)).toThrow(/oracle/);
  });

  it("[negative-control] a calibration control that is not exact fails calibration", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@after",
      "evalCtrl",
      (json) => ({
        ...json,
        epistemic: "lower-bound",
        riskNote: "not exact",
      }),
    );
    const renamed = buildPhase3Evaluation(
      CHECKPOINTS.map((checkpoint) => ({
        ...checkpoint,
        targets: checkpoint.targets.map((target) =>
          target.target === "evalCtrl"
            ? { ...target, target: "evalP3CtrlTarget" }
            : target,
        ),
      })),
      poisoned.map((observation) => ({
        ...observation,
        targets: observation.targets.map((target) =>
          target.target === "evalCtrl"
            ? { ...target, target: "evalP3CtrlTarget" }
            : target,
        ),
      })),
    );
    expect(
      phase3GateViolations(renamed, { corpusLevel: false }).map((v) => v.gate),
    ).toContain("S13");
  });

  it("[negative-control] an exact golden observed lower-bound is an unexpected status", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@after",
      "evalCtrl",
      (json) => ({
        ...json,
        epistemic: "lower-bound",
        riskNote: "why",
      }),
    );
    expect(assertSubset(poisoned)).toThrow(/unexpected status/);
  });

  it("[negative-control] an evidence record the golden does not declare fails the evidence-state check", () => {
    const poisoned = poisonPhase3Target(
      honestObservations(),
      "T1@after",
      "evalTarget",
      (json) => ({
        ...json,
        epistemic: "lower-bound",
        riskNote: "dynamic",
        dynamicEvidence: [
          {
            sourceFile: "src/users/b.ts",
            status: "bounded",
            reason: "bounded-local-pattern",
            candidatePaths: [T_FILE],
          },
        ],
      }),
    );
    const messages = phase3GateViolations(evaluate(poisoned), {
      corpusLevel: false,
    }).map((violation) => violation.message);
    expect(
      messages.some((message) =>
        /positive evidence state differs/.test(message),
      ),
    ).toBe(true);
  });

  it("[state-diff] mustDisappear is per target: a path banned for one target may stay under another", () => {
    const checkpoints = CHECKPOINTS.map((checkpoint) =>
      checkpoint.id === "T2@after"
        ? { ...checkpoint, mustDisappear: { evalCtrl: ["src/users/b.ts"] } }
        : checkpoint,
    );
    expect(
      phase3GateViolations(
        buildPhase3Evaluation(checkpoints, honestObservations()),
        {
          corpusLevel: false,
        },
      ),
    ).toEqual([]);
    const banned = CHECKPOINTS.map((checkpoint) =>
      checkpoint.id === "T2@after"
        ? { ...checkpoint, mustDisappear: { evalTarget: ["src/users/b.ts"] } }
        : checkpoint,
    );
    expect(() =>
      assertPhase3ImpactHonestyGates(
        buildPhase3Evaluation(banned, honestObservations()),
        {
          corpusLevel: false,
        },
      ),
    ).toThrow(/stale edge/);
  });

  it("[negative-control] unpoisoned poison targets pass on their own (the controls are not vacuous)", () => {
    expect(() => assertSubset(honestObservations())()).not.toThrow();
  });
});

describe("Phase 3 stale-record invariants and registry (contract §3, §8)", () => {
  it("[state-diff] R1-R6 report every stale path and dangling link", () => {
    expect(staleRecordProblems(facts())).toEqual([]);
    const problems = staleRecordProblems({
      ...facts({
        dangling: 2,
        nodePaths: [...TREE, "src/gone.ts"],
        callSitePaths: [...TREE, "src/gone-call.ts"],
        projectFilePaths: [...TREE, "src/gone-row.ts"],
        evidencePaths: ["src/gone-plugin.ts"],
      }),
      callResolutionPaths: [...TREE, "src/gone-call-resolution.ts"],
    } as Phase3StoreFacts);
    expect(problems).toEqual([
      "R1 dangling node_links: 2",
      "R2 l2_nodes: src/gone.ts",
      "R3 ast_call_sites: src/gone-call.ts",
      "R4 project_files: src/gone-row.ts",
      "R5 evidence: src/gone-plugin.ts",
      "R6 call-resolution: src/gone-call-resolution.ts",
    ]);
  });

  it("[error-handling] registry problems name unknown checkpoints and missing child issues", () => {
    expect(
      phase3KnownDefectRegistryProblems(
        { "T9@after": { defect: "DX", issue: 0 } },
        CHECKPOINTS,
      ),
    ).toEqual([
      "T9@after: unknown checkpoint",
      "T9@after: DX has no child issue number",
    ]);
    expect(PHASE3_KNOWN_PRODUCT_DEFECTS).toEqual({});
  });

  it("[state-diff] partitioning keeps registered checkpoints out of the gated set but visible to lookups", () => {
    const evaluation = evaluate(honestObservations());
    const { gated, deferred } = partitionPhase3KnownDefects(evaluation, {
      "T1@after": { defect: "DX", issue: 1 },
    });
    expect(deferred.checkpoints.map((c) => c.checkpoint.id)).toEqual([
      "T1@after",
    ]);
    expect(gated.checkpoints.map((c) => c.checkpoint.id)).not.toContain(
      "T1@after",
    );
    expect(gated.reference).toHaveLength(evaluation.checkpoints.length);
    expect(phase3GateViolations(gated, { corpusLevel: false })).toEqual([]);
  });

  it("[state-diff] the oracle normalization is order-insensitive over the blast radius", () => {
    const a = impactJson(T_FILE, ["evalUserA", "evalUserB"]);
    const b = {
      ...a,
      blastRadius: [...(a.blastRadius as unknown[])].reverse(),
    };
    expect(normalizeImpactForOracle(a)).toBe(normalizeImpactForOracle(b));
    expect(normalizeImpactForOracle(null)).toBe("null");
  });
});
