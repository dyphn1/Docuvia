import { describe, expect, it } from "vitest";
import { aggregateImpactHonesty } from "./impact-eval-honesty.js";
import {
  KNOWN_PRODUCT_DEFECTS,
  PHASE2_GOLDEN,
  PHASE2_GOLDEN_C,
  PHASE2_O65_FIRST_64_PATHS,
} from "./impact-honesty-corpus.phase2.js";
import {
  PHASE2_ERROR_REASONS,
  PHASE2_MAX_BOUNDED_CANDIDATES,
  PHASE2_OVERFLOW_REASON,
  assertPhase2ImpactHonestyGates,
  buildPhase2Evaluation,
  buildPhase2EvidenceMarkdown,
  humanParityFailure,
  knownDefectRegistryProblems,
  observeEvidence,
  parseHumanSourceColumn,
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
  projectEpistemic,
  projectResolution,
  type Phase2FixtureGolden,
  type Phase2JsonMutation,
  type Phase2Observation,
  type RawImpactRun,
} from "./impact-honesty-epistemic.phase2.js";

// TDD-SOURCE: issue #508 Phase 2 epistemic honesty and dynamic-boundary worst cases
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
// TDD-SOURCE: issue #393 dynamic dependency evidence
// TDD-SOURCE: issue #217 lsp-fallback provenance
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
// TDD-SOURCE: docs/gitbook/guidelines/phase-based-test-quality-hardening.md

function run(json: Record<string, unknown> | null, exitCode = 0): RawImpactRun {
  return { exitCode, stdout: "", stderr: "", json, parseError: false };
}

function golden(id: string): Phase2FixtureGolden {
  const found = PHASE2_GOLDEN.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no golden ${id}`);
  return found;
}

function expectedChannel(fixture: Phase2FixtureGolden, file: string): string {
  const declared = [
    ...(fixture.expectedPredictions ?? []),
    ...(fixture.optionalPredictions ?? []),
  ].find((prediction) => prediction.file === file);
  return declared?.channel ?? "static";
}

/** The JSON the product *should* emit for a golden fixture (intended behavior). */
function idealJson(fixture: Phase2FixtureGolden): Record<string, unknown> {
  const evidence = fixture.expectedEvidence.map((record) => ({
    sourceFile: record.sourceFile,
    kind: "dynamic-import",
    expression: "`./plugins/${n}`",
    startLine: 1,
    startColumn: 9,
    status: record.status,
    candidatePaths: [...record.candidatePaths],
    reason: record.reason,
  }));
  const confirmed = fixture.expectedConfirmedFiles.map((file) => {
    const channel = expectedChannel(fixture, file);
    return channel === "static"
      ? { name: file, type: "module" }
      : { name: file, type: "module", edgeSource: channel };
  });
  const candidates = fixture.expectedCandidateFiles.map((file) => ({
    name: file,
    type: "module",
    edgeSource: "dynamic-candidate",
    dynamicEvidence: evidence[0],
  }));
  const lowerBound = !fixture.calibration && fixture.id !== "E6";
  const unavailable = fixture.expectedUnavailableReason;
  const noteReason = unavailable ?? evidence[0]?.reason ?? "static-edges-only";
  return {
    blastRadius: [
      { name: fixture.targetFile, type: "module" },
      ...confirmed,
      ...candidates,
    ],
    riskLevel: confirmed.length === 0 ? "UNKNOWN" : "MEDIUM",
    ...(lowerBound
      ? { epistemic: "lower-bound", riskNote: `lower bound [${noteReason}]` }
      : {}),
    ...(evidence.length > 0 ? { dynamicEvidence: evidence } : {}),
    ...(unavailable
      ? { dynamicEvidenceUnavailable: { reason: unavailable } }
      : {}),
  };
}

function idealHuman(json: Record<string, unknown>): RawImpactRun {
  const entries = json.blastRadius as Array<Record<string, unknown>>;
  const hasSource = entries.some((entry) => entry.edgeSource !== undefined);
  const row = (cells: string[]) => `│ ${cells.join(" │ ")} │`;
  const stdout = [
    row(["Name", "Type", ...(hasSource ? ["Source"] : [])]),
    ...entries.map((entry) =>
      row([
        String(entry.name),
        "module",
        ...(hasSource ? [String(entry.edgeSource ?? "static")] : []),
      ]),
    ),
    "",
    `Risk level: ${String(json.riskLevel)}`,
  ].join("\n");
  const stderr = json.riskNote ? `⚠ Note: ${String(json.riskNote)}` : "";
  return { exitCode: 0, stdout, stderr, json: null, parseError: false };
}

function idealObservation(fixture: Phase2FixtureGolden): Phase2Observation {
  const json = idealJson(fixture);
  const names = (json.blastRadius as Array<{ name: string }>).map(
    (entry) => entry.name,
  );
  return {
    fixtureId: fixture.id,
    run: { ...run(json), stdout: JSON.stringify(json, null, 2) },
    ...(fixture.humanParity ? { human: idealHuman(json) } : {}),
    targetIdentity: {
      identity: `${fixture.targetFile}#${fixture.target}`,
      filePath: fixture.targetFile,
    },
    entryFiles: Object.fromEntries(names.map((name) => [name, [name]])),
  };
}

const IDEAL = PHASE2_GOLDEN.map(idealObservation);

function poisoned(id: string, mutation: Phase2JsonMutation) {
  return buildPhase2Evaluation(
    [golden(id)],
    poisonObservation(IDEAL, id, mutation),
  );
}

function single(id: string, observation: Phase2Observation) {
  return buildPhase2Evaluation([golden(id)], [observation]);
}

function withJson(
  id: string,
  mutate: (json: Record<string, unknown>) => Record<string, unknown>,
): Phase2Observation {
  const base = IDEAL.find((observation) => observation.fixtureId === id)!;
  return {
    ...base,
    run: { ...base.run, json: mutate({ ...base.run.json! }) },
  };
}

const SUBSET = { corpusLevel: false } as const;

describe("Phase 2 projections (#508)", () => {
  it("[happy] resolution projection mirrors Phase 1's runImpact mapping", () => {
    expect(projectResolution(run({ riskLevel: "LOW" }))).toBe("resolved");
    expect(projectResolution(run(null))).toBe("not-found");
  });

  it("[happy] epistemic projection: lower-bound or UNKNOWN is unknown, exact is resolved", () => {
    expect(
      projectEpistemic(
        run({ riskLevel: "MEDIUM", epistemic: "lower-bound", riskNote: "why" }),
      ),
    ).toBe("unknown");
    expect(
      projectEpistemic(
        run({
          riskLevel: "UNKNOWN",
          epistemic: "lower-bound",
          riskNote: "why",
        }),
      ),
    ).toBe("unknown");
    expect(projectEpistemic(run({ riskLevel: "HIGH" }))).toBe("resolved");
    expect(projectEpistemic(run(null))).toBe("not-found");
  });

  it("[error-handling] both projections fail closed on process and parse errors", () => {
    expect(projectResolution(run({ riskLevel: "LOW" }, 1))).toBe("error");
    expect(projectEpistemic(run({ riskLevel: "LOW" }, 1))).toBe("error");
    const parseError: RawImpactRun = { ...run(null), parseError: true };
    expect(projectResolution(parseError)).toBe("error");
    expect(projectEpistemic(parseError)).toBe("error");
  });

  it("[invalid-input] every out-of-contract shape projects to error", () => {
    expect(projectEpistemic(run({ riskLevel: "SEVERE" }))).toBe("error");
    expect(projectEpistemic(run({}))).toBe("error");
    expect(
      projectEpistemic(run({ riskLevel: "LOW", epistemic: "exact" })),
    ).toBe("error");
    // #192 invariant: UNKNOWN must always carry lower-bound.
    expect(projectEpistemic(run({ riskLevel: "UNKNOWN" }))).toBe("error");
    expect(
      projectEpistemic(run({ riskLevel: "LOW", epistemic: "lower-bound" })),
    ).toBe("error");
    expect(
      projectEpistemic(
        run({ riskLevel: "LOW", epistemic: "lower-bound", riskNote: "" }),
      ),
    ).toBe("error");
  });
});

describe("Phase 2 evidence observation (#508)", () => {
  it("[happy] reports gold-in-set, size and unrelated candidates for a bounded set", () => {
    const observed = observeEvidence(
      run({
        dynamicEvidence: [
          {
            sourceFile: "s/loader.ts",
            status: "bounded",
            reason: "bounded-local-pattern",
            candidatePaths: ["s/p/b.ts", "s/p/a.ts", "s/p/README.md"],
          },
        ],
      }),
      {
        targetFile: "s/p/a.ts",
        expectedEvidence: [
          {
            sourceFile: "s/loader.ts",
            status: "bounded",
            reason: "bounded-local-pattern",
            candidatePaths: ["s/p/a.ts", "s/p/b.ts"],
          },
        ],
      },
    );
    expect(observed).toEqual({
      records: [
        {
          sourceFile: "s/loader.ts",
          status: "bounded",
          reason: "bounded-local-pattern",
          candidatePaths: ["s/p/README.md", "s/p/a.ts", "s/p/b.ts"],
          overflow: false,
        },
      ],
      goldInCandidateSet: true,
      candidateSetSize: 3,
      unrelatedAdmitted: ["s/p/README.md"],
      truncatedOrOverflow: false,
      evidenceUnavailable: false,
      evidenceUnavailableReason: null,
    });
  });

  it("[happy] overflow has no candidate-set size and no gold-in-set verdict", () => {
    const observed = observeEvidence(
      run({
        dynamicEvidence: [
          {
            sourceFile: "s/loader.ts",
            status: "unresolved",
            reason: PHASE2_OVERFLOW_REASON,
            candidatePaths: [],
          },
        ],
      }),
      { targetFile: "s/p/p64.ts", expectedEvidence: [] },
    );
    expect(PHASE2_MAX_BOUNDED_CANDIDATES).toBe(64);
    expect(observed.truncatedOrOverflow).toBe(true);
    expect(observed.candidateSetSize).toBeNull();
    expect(observed.goldInCandidateSet).toBeNull();
    expect(observed.records[0].overflow).toBe(true);
  });

  it("[error-handling] an explicit evidence-unavailable state is observed with its reason", () => {
    const observed = observeEvidence(
      run({ dynamicEvidenceUnavailable: { reason: "corrupt-json" } }),
      { targetFile: "s/a.ts", expectedEvidence: [] },
    );
    expect(observed.evidenceUnavailable).toBe(true);
    expect(observed.evidenceUnavailableReason).toBe("corrupt-json");
    expect(observed.records).toEqual([]);
  });

  it("[invalid-input] malformed evidence payloads never throw", () => {
    const observed = observeEvidence(
      run({ dynamicEvidence: "nope", dynamicEvidenceUnavailable: {} }),
      { targetFile: "s/a.ts", expectedEvidence: [] },
    );
    expect(observed.records).toEqual([]);
    expect(observed.evidenceUnavailable).toBe(true);
    expect(observed.evidenceUnavailableReason).toBeNull();
  });
});

describe("Phase 2 gates on ideal output (#508)", () => {
  it("[happy] the ideal output of every golden fixture passes every gate", () => {
    const evaluation = buildPhase2Evaluation(PHASE2_GOLDEN, IDEAL);
    expect(phase2GateViolations(evaluation)).toEqual([]);
    const aggregate = assertPhase2ImpactHonestyGates(evaluation);
    expect(aggregate.epistemic.cases).toBeGreaterThanOrEqual(10);
    expect(aggregate.candidate.coverage).toBe(1);
    expect(aggregate.provenance.mismatches).toBe(0);
  });

  it("[happy] the evidence markdown has one row per fixture and no blended score", () => {
    const markdown = buildPhase2EvidenceMarkdown(
      buildPhase2Evaluation(PHASE2_GOLDEN, IDEAL),
    );
    for (const fixture of PHASE2_GOLDEN) {
      expect(markdown).toContain(`| ${fixture.id} |`);
    }
    expect(markdown).not.toMatch(/overall/i);
  });

  it("[happy] the human table parser reads the Source column", () => {
    expect(
      parseHumanSourceColumn(
        ["│ Name │ Type │ Source │", "│ a.ts │ module │ lsp-fallback │"].join(
          "\n",
        ),
      ),
    ).toEqual({ "a.ts": "lsp-fallback" });
    expect(
      parseHumanSourceColumn("│ Name │ Type │\n│ a.ts │ module │"),
    ).toBeNull();
  });

  it("[invalid-input] a missing observation is an error that stays in the denominator", () => {
    const evaluation = buildPhase2Evaluation([golden("E8")], []);
    expect(evaluation.fixtures[0].errorReason).toBe(
      PHASE2_ERROR_REASONS.MISSING_OBSERVATION,
    );
    expect(aggregateImpactHonesty(evaluation.records).errorCases).toBe(1);
    expect(() => assertPhase2ImpactHonestyGates(evaluation, SUBSET)).toThrow(
      /errored/,
    );
  });

  it("[invalid-input] an unknown edgeSource is a harness error, never a silent channel", () => {
    const evaluation = single(
      "E8",
      withJson("E8", (json) => ({
        ...json,
        blastRadius: [
          ...(json.blastRadius as unknown[]),
          { name: "x.ts", type: "module", edgeSource: "guess" },
        ],
      })),
    );
    expect(evaluation.fixtures[0].errorReason).toBe(
      PHASE2_ERROR_REASONS.EDGE_SOURCE,
    );
    expect(() => assertPhase2ImpactHonestyGates(evaluation, SUBSET)).toThrow(
      /errored/,
    );
  });

  it("[invalid-input] a not-found target cannot pass as UNKNOWN", () => {
    const evaluation = single("E4a", {
      ...IDEAL[0],
      fixtureId: "E4a",
      run: run(null),
    });
    expect(evaluation.records[0].observedStatus).toBe("not-found");
    expect(evaluation.records[0].epistemic?.correctUnknown).toBe(false);
    expect(() => assertPhase2ImpactHonestyGates(evaluation, SUBSET)).toThrow(
      /unexpected status/,
    );
  });

  it("[error-handling] G2 fails a vacuous corpus and G4 fails a missing calibration control", () => {
    const tiny = buildPhase2Evaluation([golden("E2")], IDEAL);
    expect(() => assertPhase2ImpactHonestyGates(tiny)).toThrow(/vacuous/);
    expect(() => assertPhase2ImpactHonestyGates(tiny, SUBSET)).not.toThrow();
    const noControl = buildPhase2Evaluation(
      PHASE2_GOLDEN.filter((fixture) => !fixture.calibration),
      IDEAL,
    );
    expect(() => assertPhase2ImpactHonestyGates(noControl)).toThrow(
      /calibration/,
    );
  });

  it("[error-handling] G4 fails when the calibration control carries a lower-bound note", () => {
    const evaluation = single(
      "E8",
      withJson("E8", (json) => ({
        ...json,
        epistemic: "lower-bound",
        riskNote: "why",
      })),
    );
    expect(() => assertPhase2ImpactHonestyGates(evaluation, SUBSET)).toThrow(
      /calibration/,
    );
  });

  it("[error-handling] G5 fails when a declared provenance file is never surfaced", () => {
    const evaluation = single(
      "E6",
      withJson("E6", (json) => ({
        ...json,
        blastRadius: (json.blastRadius as unknown[]).slice(0, 1),
      })),
    );
    expect(() => assertPhase2ImpactHonestyGates(evaluation, SUBSET)).toThrow(
      /provenance checked 0 < declared 1/,
    );
  });

  it("[error-handling] G7 fails on an admitted non-source decoy and on a missing unavailable reason", () => {
    const decoy = single(
      "E2",
      withJson("E2", (json) => ({
        ...json,
        dynamicEvidence: (
          json.dynamicEvidence as Array<Record<string, unknown>>
        ).map((record) => ({
          ...record,
          candidatePaths: [
            ...(record.candidatePaths as string[]),
            "src/p2/multi/plugins/README.md",
          ],
        })),
      })),
    );
    expect(decoy.fixtures[0].evidence.unrelatedAdmitted).toEqual([
      "src/p2/multi/plugins/README.md",
    ]);
    expect(() => assertPhase2ImpactHonestyGates(decoy, SUBSET)).toThrow(
      /evidence state/,
    );

    const silent = single(
      "C2a",
      withJson("C2a", (json) => {
        const { dynamicEvidenceUnavailable: _dropped, ...rest } = json;
        return rest;
      }),
    );
    expect(() => assertPhase2ImpactHonestyGates(silent, SUBSET)).toThrow(
      /evidence state|degradation/,
    );
  });

  it("[error-handling] G9 fails when a degradation note does not name the reason", () => {
    const evaluation = single(
      "C2b",
      withJson("C2b", (json) => ({ ...json, riskNote: "something vague" })),
    );
    expect(() => assertPhase2ImpactHonestyGates(evaluation, SUBSET)).toThrow(
      /degradation/,
    );
  });

  it("[error-handling] G11 fails when a confirmed dependent is missing", () => {
    const evaluation = single(
      "E4b",
      withJson("E4b", (json) => ({
        ...json,
        blastRadius: (json.blastRadius as unknown[]).slice(0, 1),
        riskLevel: "UNKNOWN",
      })),
    );
    expect(() => assertPhase2ImpactHonestyGates(evaluation, SUBSET)).toThrow(
      /positive/,
    );
  });

  it("[error-handling] G12 fails when human output drops the note or mislabels a source", () => {
    const e2 = IDEAL.find((observation) => observation.fixtureId === "E2")!;
    const noNote = single("E2", {
      ...e2,
      human: { ...e2.human!, stderr: "" },
    });
    expect(humanParityFailure(noNote.fixtures[0])).toBe("note presence");
    expect(() => assertPhase2ImpactHonestyGates(noNote, SUBSET)).toThrow(
      /human parity/,
    );

    const mislabeled = single("E2", {
      ...e2,
      human: {
        ...e2.human!,
        stdout: e2.human!.stdout.replace("dynamic-candidate", "static"),
      },
    });
    expect(humanParityFailure(mislabeled.fixtures[0])).toBe(
      "source label for src/p2/multi/loader.ts",
    );
  });
});

describe("Phase 2 poisoned controls P1-P7 (#508)", () => {
  it("[error-handling] P1 promote dynamic-candidate -> static fails provenance", () => {
    const evaluation = poisoned("E2", poisonPromoteCandidate);
    expect(() => assertPhase2ImpactHonestyGates(evaluation, SUBSET)).toThrow(
      /provenance/,
    );
    expect(
      phase2GateViolations(evaluation, SUBSET).map(
        (violation) => violation.gate,
      ),
    ).toEqual(expect.arrayContaining(["G5", "G6", "G11"]));
  });

  it("[error-handling] P2 UNKNOWN -> confident empty fails false-safe", () => {
    expect(() =>
      assertPhase2ImpactHonestyGates(
        poisoned("E4a", poisonConfidentEmpty),
        SUBSET,
      ),
    ).toThrow(/false-safe/);
  });

  it("[error-handling] P3 overflow truncated to bounded fails the overflow gate", () => {
    expect(PHASE2_O65_FIRST_64_PATHS).toHaveLength(64);
    expect(() =>
      assertPhase2ImpactHonestyGates(
        poisoned("E4a", poisonTruncateOverflow(PHASE2_O65_FIRST_64_PATHS)),
        SUBSET,
      ),
    ).toThrow(/overflow/);
  });

  it("[error-handling] P4 fabricated certainty on a non-empty result fails wrong-certainty", () => {
    expect(() =>
      assertPhase2ImpactHonestyGates(
        poisoned("E2", poisonFabricatedCertainty),
        SUBSET,
      ),
    ).toThrow(/wrong-certainty/);
  });

  it("[error-handling] P5 lsp-fallback relabeled static fails provenance", () => {
    expect(() =>
      assertPhase2ImpactHonestyGates(
        poisoned("E6", poisonRelabelFallback),
        SUBSET,
      ),
    ).toThrow(/provenance/);
  });

  it("[error-handling] P6 masked coverage fails G1 as coverage-masked", () => {
    expect(() =>
      assertPhase2ImpactHonestyGates(
        poisoned("E8", poisonMaskedCoverage),
        SUBSET,
      ),
    ).toThrow(/coverage-masked/);
  });

  it("[invalid-input] P7 a shape outside the contract projects to error and fails G1", () => {
    const evaluation = poisoned("E8", poisonOutOfContract);
    expect(evaluation.fixtures[0].epistemicStatus).toBe("error");
    expect(() => assertPhase2ImpactHonestyGates(evaluation, SUBSET)).toThrow(
      /errored/,
    );
  });

  it("[invalid-input] poisoning an absent fixture is rejected", () => {
    expect(() =>
      poisonObservation(IDEAL, "nope", poisonMaskedCoverage),
    ).toThrow(/no observation for nope/);
  });

  it("[state-diff] poisons never mutate their input observations", () => {
    const before = JSON.stringify(IDEAL);
    poisonObservation(IDEAL, "E2", poisonPromoteCandidate);
    poisonObservation(IDEAL, "E4a", poisonConfidentEmpty);
    expect(JSON.stringify(IDEAL)).toBe(before);
  });
});

describe("Phase 2 deferred-defect registry (#508)", () => {
  it("[happy] the shipped registry is well-formed", () => {
    expect(
      knownDefectRegistryProblems(KNOWN_PRODUCT_DEFECTS, PHASE2_GOLDEN),
    ).toEqual([]);
  });

  it("[error-handling] an entry without a child issue number, or for an unknown fixture, is a failure", () => {
    expect(
      knownDefectRegistryProblems(
        { E9: { defect: "D3", issue: 0 }, ZZ: { defect: "D9", issue: 12 } },
        PHASE2_GOLDEN,
      ),
    ).toEqual(["E9: D3 has no child issue number", "ZZ: unknown fixture"]);
  });

  it("[state-diff] registered fixtures move out of the gated set and nothing else does", () => {
    const evaluation = buildPhase2Evaluation(PHASE2_GOLDEN, IDEAL);
    const { gated, deferred } = partitionKnownDefects(evaluation, {
      E9: { defect: "D3", issue: 1 },
    });
    expect(deferred.fixtures.map((fixture) => fixture.golden.id)).toEqual([
      "E9",
    ]);
    expect(gated.fixtures).toHaveLength(PHASE2_GOLDEN.length - 1);
    expect(gated.records.length + deferred.records.length).toBe(
      evaluation.records.length,
    );
  });
});

describe("Phase 2 determinism (#508)", () => {
  it("[state-diff] C3 golden preserves the dynamic evidence present before snapshot", () => {
    const [beforeSnapshot] = PHASE2_GOLDEN_C.C1a;
    const [afterHydration] = PHASE2_GOLDEN_C.C3;

    expect(afterHydration.expectedEvidence).toEqual(
      beforeSnapshot.expectedEvidence,
    );
  });

  it("[stress] 50 rebuilds of the full evaluation are identical", () => {
    const baseline = buildPhase2Evaluation(PHASE2_GOLDEN, IDEAL);
    for (let index = 0; index < 50; index++) {
      expect(buildPhase2Evaluation(PHASE2_GOLDEN, IDEAL)).toEqual(baseline);
    }
  });
});
