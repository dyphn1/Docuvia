/**
 * Issue #508 Phase 2: pure epistemic projections, evidence-layer observation, gates and poisoned
 * controls over real `docuvia impact` output.
 *
 * Everything here is pure: no subprocess, no SQLite. The corpus module
 * (`impact-honesty-corpus.phase2.ts`) runs the real CLI and snapshots the database facts this
 * module needs (`targetIdentity`, `entryFiles`) into a `Phase2Observation`. Poisons mutate the raw
 * JSON *before* projection, so the projections themselves are exercised. Phase 0 scoring
 * (`scoreImpactHonestyCase` / `aggregateImpactHonesty`) is used unchanged.
 *
 * TDD-SOURCE: issue #508 Phase 2 epistemic honesty and dynamic-boundary worst cases
 * TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md
 * TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
 * TDD-SOURCE: issue #393 dynamic dependency evidence
 * TDD-SOURCE: issue #217 lsp-fallback provenance
 * TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
 * TDD-SOURCE: docs/gitbook/guidelines/phase-based-test-quality-hardening.md
 */

import {
  IMPACT_HONESTY_SCHEMA_VERSION,
  aggregateImpactHonesty,
  scoreImpactHonestyCase,
  type ImpactHonestyAggregate,
  type ImpactHonestyCaseResult,
  type ImpactHonestyObservedStatus,
  type ImpactHonestyPrediction,
} from "./impact-eval-honesty.js";
import { mapEvidenceChannel } from "./impact-honesty-corpus.phase1.js";

/**
 * Test-side mirror of the product's `MAX_BOUNDED_CANDIDATES` in
 * `lib/core/src/impact/dynamic-dependency-evidence.ts`. Deliberately not imported: the benchmark
 * observes the product from the outside and must not change if that constant is exported or moved.
 */
export const PHASE2_MAX_BOUNDED_CANDIDATES = 64;
export const PHASE2_OVERFLOW_REASON = `candidate-set-exceeds-${PHASE2_MAX_BOUNDED_CANDIDATES}`;

/** The documented `docuvia impact --format=json` contract values the projections observe. */
export const PHASE2_JSON = {
  RISK_LEVELS: ["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"],
  RISK_UNKNOWN: "UNKNOWN",
  LOWER_BOUND: "lower-bound",
  STATUS_BOUNDED: "bounded",
  STATUS_UNRESOLVED: "unresolved",
  EDGE_SOURCE_DYNAMIC_CANDIDATE: "dynamic-candidate",
  EDGE_SOURCE_STATIC_LABEL: "static",
} as const;

/** Why a whole fixture observation was recorded as `error`. */
export const PHASE2_ERROR_REASONS = {
  EXIT_NONZERO: "exit-nonzero",
  PARSE_ERROR: "parse-error",
  NOT_FOUND: "not-found",
  COVERAGE_MASKED: "coverage-masked",
  OUT_OF_CONTRACT: "out-of-contract",
  TARGET_IDENTITY: "target-identity",
  EDGE_SOURCE: "unknown-edge-source",
  MISSING_OBSERVATION: "missing-observation",
} as const;
export type Phase2ErrorReason =
  (typeof PHASE2_ERROR_REASONS)[keyof typeof PHASE2_ERROR_REASONS];

/** Human-mode markers (artifacts/cli/src/constants/ui-messages.ts), observed from outside. */
export const PHASE2_HUMAN = {
  RISK_LINE: /Risk level: ([A-Z]+)/,
  NOTE_PREFIX: "Note: ",
  TABLE_ROW_PREFIX: "│",
  COL_NAME: "Name",
  COL_SOURCE: "Source",
} as const;

export interface RawImpactRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: Record<string, unknown> | null;
  readonly parseError: boolean;
}

export type Phase2ResolutionStatus = "resolved" | "not-found" | "error";
export type Phase2EpistemicStatus =
  "resolved" | "unknown" | "not-found" | "error";

/** Resolution projection — identical to Phase 1's runImpact() mapping (contract §1.1). */
export function projectResolution(run: RawImpactRun): Phase2ResolutionStatus {
  if (run.exitCode !== 0) return "error";
  if (run.parseError) return "error";
  if (run.json === null) return "not-found";
  return "resolved";
}

/** Fail-closed contract check behind `projectEpistemic` (contract §1.1). */
function isOutsideEpistemicContract(json: Record<string, unknown>): boolean {
  const { riskLevel, epistemic, riskNote } = json;
  if (!(PHASE2_JSON.RISK_LEVELS as readonly unknown[]).includes(riskLevel)) {
    return true;
  }
  if (epistemic !== undefined && epistemic !== PHASE2_JSON.LOWER_BOUND) {
    return true;
  }
  // #192 invariant
  if (
    riskLevel === PHASE2_JSON.RISK_UNKNOWN &&
    epistemic !== PHASE2_JSON.LOWER_BOUND
  ) {
    return true;
  }
  return (
    epistemic === PHASE2_JSON.LOWER_BOUND &&
    !(typeof riskNote === "string" && riskNote.length > 0)
  );
}

/** Epistemic projection — FROZEN false-safe observation contract (contract §1.1). */
export function projectEpistemic(run: RawImpactRun): Phase2EpistemicStatus {
  const base = projectResolution(run);
  if (base !== "resolved") return base;
  const json = run.json as Record<string, unknown>;
  // fail closed on any shape outside the documented contract
  if (isOutsideEpistemicContract(json)) return "error";
  return json.epistemic === PHASE2_JSON.LOWER_BOUND ||
    json.riskLevel === PHASE2_JSON.RISK_UNKNOWN
    ? "unknown"
    : "resolved";
}

export type Phase2Intent = Extract<
  ImpactHonestyCaseResult["intent"],
  "confirmed-positive" | "candidate-boundary" | "epistemic-unknown"
>;

export interface Phase2EvidenceGolden {
  readonly sourceFile: string;
  readonly status: "bounded" | "unresolved";
  readonly reason: string;
  readonly candidatePaths: readonly string[];
}

export type Phase2OverflowExpectation = "bounded-max" | "overflow";

export interface Phase2FixtureGolden {
  readonly id: string;
  readonly sandbox: "A" | "B" | "C";
  readonly target: string;
  /** File that defines `target`; identity is `${targetFile}#${target}` (STOR-005 node_key). */
  readonly targetFile: string;
  readonly intents: readonly Phase2Intent[];
  readonly expectedConfirmedFiles: readonly string[];
  /** Dependent files expected only through the `dynamic-candidate` channel. */
  readonly expectedCandidateFiles: readonly string[];
  /** Provenance that must be observed (counted into G5's declared minimum). */
  readonly expectedPredictions?: readonly ImpactHonestyPrediction[];
  /** Provenance checked only if the file is surfaced at all (E7). */
  readonly optionalPredictions?: readonly ImpactHonestyPrediction[];
  readonly expectedEvidence: readonly Phase2EvidenceGolden[];
  /** D1/D5: the explicit evidence-unavailable reason the product must report. */
  readonly expectedUnavailableReason?: string;
  readonly overflowExpectation?: Phase2OverflowExpectation;
  /** E8: exact-calibration control (G4). */
  readonly calibration?: boolean;
  /** C*: degradation fixture (G9). */
  readonly degradation?: boolean;
  /** Human-output parity checked (G12). */
  readonly humanParity?: boolean;
}

/** One real CLI observation plus the database facts snapshotted by the corpus module. */
export interface Phase2Observation {
  readonly fixtureId: string;
  readonly run: RawImpactRun;
  readonly human?: RawImpactRun;
  /** Phase 1 `inferObservedTarget` result; null when identity could not be established. */
  readonly targetIdentity: { identity: string; filePath: string } | null;
  /** `l2_nodes.path_patterns` for every blast-radius entry name. */
  readonly entryFiles: Readonly<Record<string, readonly string[]>>;
}

export interface Phase2EvidenceRecord {
  readonly sourceFile: string;
  readonly status: string;
  readonly reason: string;
  readonly candidatePaths: string[];
  readonly overflow: boolean;
}

export interface Phase2EvidenceObservation {
  readonly records: Phase2EvidenceRecord[];
  readonly goldInCandidateSet: boolean | null;
  readonly candidateSetSize: number | null;
  readonly unrelatedAdmitted: string[];
  readonly truncatedOrOverflow: boolean;
  readonly evidenceUnavailable: boolean;
  readonly evidenceUnavailableReason: string | null;
}

export interface Phase2FixtureResult {
  readonly golden: Phase2FixtureGolden;
  readonly observation: Phase2Observation | null;
  readonly errorReason: Phase2ErrorReason | null;
  readonly resolutionStatus: Phase2ResolutionStatus;
  readonly epistemicStatus: Phase2EpistemicStatus;
  readonly evidence: Phase2EvidenceObservation;
  readonly records: ImpactHonestyCaseResult[];
}

export interface Phase2Evaluation {
  readonly fixtures: Phase2FixtureResult[];
  readonly records: ImpactHonestyCaseResult[];
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

function blastRadiusOf(run: RawImpactRun): Record<string, unknown>[] {
  return asRecordArray(run.json?.blastRadius);
}

/** Evidence-layer observation (contract §1.2). */
export function observeEvidence(
  run: RawImpactRun,
  golden: Pick<Phase2FixtureGolden, "targetFile" | "expectedEvidence">,
): Phase2EvidenceObservation {
  const records = asRecordArray(run.json?.dynamicEvidence)
    .map((item) => {
      const reason = String(item.reason);
      return {
        sourceFile: String(item.sourceFile),
        status: String(item.status),
        reason,
        candidatePaths: sortedUnique(
          Array.isArray(item.candidatePaths)
            ? item.candidatePaths.map(String)
            : [],
        ),
        overflow: reason === PHASE2_OVERFLOW_REASON,
      };
    })
    .sort(
      (a, b) =>
        compareText(a.sourceFile, b.sourceFile) ||
        compareText(a.reason, b.reason),
    );

  const bounded = records.filter(
    (record) => record.status === PHASE2_JSON.STATUS_BOUNDED,
  );
  const boundedUnion = sortedUnique(
    bounded.flatMap((record) => record.candidatePaths),
  );
  const expectedUnion = new Set(
    golden.expectedEvidence.flatMap((record) => record.candidatePaths),
  );
  const unavailable = run.json?.dynamicEvidenceUnavailable;
  const unavailableReason =
    typeof unavailable === "object" &&
    unavailable !== null &&
    typeof (unavailable as Record<string, unknown>).reason === "string"
      ? String((unavailable as Record<string, unknown>).reason)
      : null;

  return {
    records,
    goldInCandidateSet:
      bounded.length === 0 ? null : boundedUnion.includes(golden.targetFile),
    candidateSetSize:
      bounded.length === 0
        ? null
        : Math.max(...bounded.map((record) => record.candidatePaths.length)),
    unrelatedAdmitted: boundedUnion.filter((file) => !expectedUnion.has(file)),
    truncatedOrOverflow: records.some((record) => record.overflow),
    evidenceUnavailable: unavailable !== undefined,
    evidenceUnavailableReason: unavailableReason,
  };
}

function fixtureError(
  observation: Phase2Observation | null,
): Phase2ErrorReason | null {
  if (observation === null) return PHASE2_ERROR_REASONS.MISSING_OBSERVATION;
  const { run } = observation;
  if (run.exitCode !== 0) return PHASE2_ERROR_REASONS.EXIT_NONZERO;
  if (run.parseError) return PHASE2_ERROR_REASONS.PARSE_ERROR;
  if (run.json === null) return PHASE2_ERROR_REASONS.NOT_FOUND;
  // Contract §1.1 masking guard: partial coverage would pre-empt every dynamic cause.
  if (run.json.partialCoverage !== undefined) {
    return PHASE2_ERROR_REASONS.COVERAGE_MASKED;
  }
  if (projectEpistemic(run) === "error") {
    return PHASE2_ERROR_REASONS.OUT_OF_CONTRACT;
  }
  if (observation.targetIdentity === null) {
    return PHASE2_ERROR_REASONS.TARGET_IDENTITY;
  }
  return null;
}

/** Phase 1 `dependencyPredictions` semantics over the snapshotted `entryFiles` map. */
export function predictionsFor(
  observation: Phase2Observation,
): ImpactHonestyPrediction[] {
  const targetFile = observation.targetIdentity?.filePath;
  const predictions: ImpactHonestyPrediction[] = [];
  for (const entry of blastRadiusOf(observation.run)) {
    const edgeSource =
      entry.edgeSource === undefined ? undefined : String(entry.edgeSource);
    const channel = mapEvidenceChannel(edgeSource);
    for (const file of observation.entryFiles[String(entry.name)] ?? []) {
      if (file === targetFile) continue;
      predictions.push({ file, channel });
    }
  }
  return predictions;
}

function recordFor(
  golden: Phase2FixtureGolden,
  intent: Phase2Intent,
  observedStatus: ImpactHonestyObservedStatus,
  observation: Phase2Observation | null,
  predictions: readonly ImpactHonestyPrediction[],
): ImpactHonestyCaseResult {
  return scoreImpactHonestyCase({
    schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
    scenario: `${golden.id}#${intent}`,
    target: golden.target,
    expectedTargetIdentity: `${golden.targetFile}#${golden.target}`,
    observedTargetIdentity: observation?.targetIdentity?.identity,
    intent,
    expectedStatus: intent === "epistemic-unknown" ? "unknown" : "resolved",
    expectedConfirmedFiles: golden.expectedConfirmedFiles,
    expectedCandidateFiles: golden.expectedCandidateFiles,
    expectedPredictions: [
      ...(golden.expectedPredictions ?? []),
      ...(golden.optionalPredictions ?? []),
    ],
    observedStatus,
    predictions,
  });
}

const EMPTY_RUN: RawImpactRun = {
  exitCode: 1,
  stdout: "",
  stderr: "",
  json: null,
  parseError: false,
};

/** A whole-fixture error forces both projections to `error` (not-found stays observable). */
function projectedStatuses(
  run: RawImpactRun | undefined,
  errorReason: Phase2ErrorReason | null,
): { resolution: Phase2ResolutionStatus; epistemic: Phase2EpistemicStatus } {
  const forcedError =
    errorReason !== null && errorReason !== PHASE2_ERROR_REASONS.NOT_FOUND;
  if (forcedError || run === undefined) {
    return { resolution: "error", epistemic: "error" };
  }
  return {
    resolution: projectResolution(run),
    epistemic: projectEpistemic(run),
  };
}

function safePredictions(
  observation: Phase2Observation | null,
  errorReason: Phase2ErrorReason | null,
): {
  predictions: ImpactHonestyPrediction[];
  errorReason: Phase2ErrorReason | null;
} {
  if (errorReason !== null || observation === null) {
    return { predictions: [], errorReason };
  }
  try {
    return { predictions: predictionsFor(observation), errorReason: null };
  } catch {
    return { predictions: [], errorReason: PHASE2_ERROR_REASONS.EDGE_SOURCE };
  }
}

/** One Phase 0 case record per asserted intent (`<fixture>#<intent>`), contract §1.1. */
export function buildPhase2FixtureResult(
  golden: Phase2FixtureGolden,
  observation: Phase2Observation | null,
): Phase2FixtureResult {
  const { predictions, errorReason } = safePredictions(
    observation,
    fixtureError(observation),
  );
  const run = observation?.run;
  const statuses = projectedStatuses(run, errorReason);
  const records = golden.intents.map((intent) =>
    recordFor(
      golden,
      intent,
      intent === "epistemic-unknown" ? statuses.epistemic : statuses.resolution,
      observation,
      predictions,
    ),
  );

  return {
    golden,
    observation,
    errorReason,
    resolutionStatus: statuses.resolution,
    epistemicStatus: statuses.epistemic,
    evidence: observeEvidence(run ?? EMPTY_RUN, golden),
    records,
  };
}

export function buildPhase2Evaluation(
  goldens: readonly Phase2FixtureGolden[],
  observations: readonly Phase2Observation[],
): Phase2Evaluation {
  const byId = new Map(
    observations.map((observation) => [observation.fixtureId, observation]),
  );
  const fixtures = goldens.map((golden) =>
    buildPhase2FixtureResult(golden, byId.get(golden.id) ?? null),
  );
  return { fixtures, records: fixtures.flatMap((fixture) => fixture.records) };
}

/** Concatenates stage evaluations (sandboxes A/B and each Sandbox C state) into one corpus. */
export function mergePhase2Evaluations(
  evaluations: readonly Phase2Evaluation[],
): Phase2Evaluation {
  return {
    fixtures: evaluations.flatMap((evaluation) => evaluation.fixtures),
    records: evaluations.flatMap((evaluation) => evaluation.records),
  };
}

// ─── Gates (contract §4) ────────────────────────────────────────────────────────────────────

export type Phase2GateId =
  "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8" | "G9" | "G11" | "G12";

/** `corpusLevel: false` evaluates a subset (one sandbox stage or one poisoned fixture): the
 *  corpus-wide non-vacuity checks (G2 >= 10 epistemic cases, G4 control present) are skipped. */
export interface Phase2GateOptions {
  readonly corpusLevel?: boolean;
}

export const PHASE2_MIN_EPISTEMIC_CASES = 10;

export interface Phase2GateViolation {
  readonly gate: Phase2GateId;
  readonly fixtures: string[];
  readonly message: string;
}

function fixtureIdOf(scenario: string): string {
  return scenario.split("#")[0];
}

function violation(
  gate: Phase2GateId,
  fixtures: readonly string[],
  detail: string,
): Phase2GateViolation {
  const ids = sortedUnique(fixtures);
  return {
    gate,
    fixtures: ids,
    message: `Phase 2 impact honesty gate ${gate}: ${detail} in ${ids.join(", ")}`,
  };
}

function gateCoverageAndErrors(
  evaluation: Phase2Evaluation,
  aggregate: ImpactHonestyAggregate,
): Phase2GateViolation[] {
  const masked = evaluation.fixtures.filter(
    (fixture) => fixture.errorReason === PHASE2_ERROR_REASONS.COVERAGE_MASKED,
  );
  if (masked.length > 0) {
    return [
      violation(
        "G1",
        masked.map((fixture) => fixture.golden.id),
        "coverage-masked result (partialCoverage present)",
      ),
    ];
  }
  if (aggregate.errorCases > 0) {
    const errored = evaluation.records.filter(
      (record) => record.observedStatus === "error",
    );
    const reasons = sortedUnique(
      evaluation.fixtures
        .filter((fixture) => fixture.errorReason !== null)
        .map((fixture) => `${fixture.golden.id}=${fixture.errorReason}`),
    );
    return [
      violation(
        "G1",
        errored.map((record) => fixtureIdOf(record.scenario)),
        `${aggregate.errorCases} case(s) errored [${reasons.join(", ")}]`,
      ),
    ];
  }
  return [];
}

function gateEpistemic(
  evaluation: Phase2Evaluation,
  aggregate: ImpactHonestyAggregate,
  corpusLevel: boolean,
): Phase2GateViolation[] {
  const violations: Phase2GateViolation[] = [];
  const falseSafe = evaluation.records.filter(
    (record) => record.epistemic?.falseSafe === true,
  );
  if (falseSafe.length > 0) {
    violations.push(
      violation(
        "G2",
        falseSafe.map((record) => fixtureIdOf(record.scenario)),
        `false-safe rate ${String(aggregate.epistemic.falseSafeRate)} is not 0 (verified zero-impact claim)`,
      ),
    );
  }
  if (corpusLevel && aggregate.epistemic.cases < PHASE2_MIN_EPISTEMIC_CASES) {
    violations.push(
      violation(
        "G2",
        ["corpus"],
        `false-safe gate is vacuous: only ${aggregate.epistemic.cases} epistemic case(s), need >= ${PHASE2_MIN_EPISTEMIC_CASES}`,
      ),
    );
  }
  const wrongCertainty = evaluation.records.filter(
    (record) => record.epistemic?.wrongCertainty === true,
  );
  if (wrongCertainty.length > 0) {
    violations.push(
      violation(
        "G3",
        wrongCertainty.map((record) => fixtureIdOf(record.scenario)),
        `${wrongCertainty.length} wrong-certainty case(s): exact claim while evidence is incomplete`,
      ),
    );
  }
  return violations;
}

function gateCalibration(
  evaluation: Phase2Evaluation,
  corpusLevel: boolean,
): Phase2GateViolation[] {
  const controls = evaluation.fixtures.filter(
    (fixture) => fixture.golden.calibration,
  );
  if (controls.length === 0 && corpusLevel) {
    return [violation("G4", ["corpus"], "calibration control missing")];
  }
  const bad = controls.filter((fixture) => {
    const json = fixture.observation?.run.json;
    return (
      fixture.epistemicStatus !== "resolved" ||
      json === null ||
      json === undefined ||
      json.epistemic !== undefined ||
      json.riskNote !== undefined ||
      json.dynamicEvidence !== undefined
    );
  });
  return bad.length === 0
    ? []
    : [
        violation(
          "G4",
          bad.map((fixture) => fixture.golden.id),
          "exact calibration control is not observable as resolved",
        ),
      ];
}

function declaredProvenance(evaluation: Phase2Evaluation): number {
  return evaluation.fixtures.reduce(
    (sum, fixture) =>
      sum +
      fixture.records.length *
        (fixture.golden.expectedPredictions?.length ?? 0),
    0,
  );
}

function gateProvenance(
  evaluation: Phase2Evaluation,
  aggregate: ImpactHonestyAggregate,
): Phase2GateViolation[] {
  const mismatched = evaluation.records.filter(
    (record) => record.provenance.mismatches > 0,
  );
  const declared = declaredProvenance(evaluation);
  const violations: Phase2GateViolation[] = [];
  if (mismatched.length > 0) {
    violations.push(
      violation(
        "G5",
        mismatched.map((record) => fixtureIdOf(record.scenario)),
        `${aggregate.provenance.mismatches} provenance mismatch(es)`,
      ),
    );
  }
  if (aggregate.provenance.checked < declared) {
    const unchecked = evaluation.fixtures.filter((fixture) =>
      fixture.records.some(
        (record) =>
          record.provenance.checked <
          (fixture.golden.expectedPredictions?.length ?? 0),
      ),
    );
    violations.push(
      violation(
        "G5",
        unchecked.map((fixture) => fixture.golden.id),
        `provenance checked ${aggregate.provenance.checked} < declared ${declared}`,
      ),
    );
  }
  return violations;
}

function gateCandidatePromotion(
  evaluation: Phase2Evaluation,
  aggregate: ImpactHonestyAggregate,
): Phase2GateViolation[] {
  const promoted = evaluation.fixtures.filter((fixture) => {
    const confirmed = new Set(fixture.golden.expectedConfirmedFiles);
    const candidateOnly = fixture.golden.expectedCandidateFiles.filter(
      (file) => !confirmed.has(file),
    );
    return fixture.records.some((record) =>
      record.confirmedPredictedFiles.some((file) =>
        candidateOnly.includes(file),
      ),
    );
  });
  const violations: Phase2GateViolation[] = [];
  if (promoted.length > 0) {
    violations.push(
      violation(
        "G6",
        promoted.map((fixture) => fixture.golden.id),
        "dynamic candidate promoted to confirmed evidence (candidate promoted)",
      ),
    );
  }
  if (aggregate.candidate.cases > 0 && aggregate.candidate.coverage !== 1) {
    const uncovered = evaluation.records.filter(
      (record) =>
        record.intent === "candidate-boundary" &&
        record.candidate?.coverage !== 1,
    );
    violations.push(
      violation(
        "G6",
        uncovered.map((record) => fixtureIdOf(record.scenario)),
        `candidate coverage ${String(aggregate.candidate.coverage)} is not 1 (candidate promoted or dropped)`,
      ),
    );
  }
  return violations;
}

function hasDynamicCandidateEntry(fixture: Phase2FixtureResult): boolean {
  return blastRadiusOf(fixture.observation?.run ?? EMPTY_RUN).some(
    (entry) => entry.edgeSource === PHASE2_JSON.EDGE_SOURCE_DYNAMIC_CANDIDATE,
  );
}

function overflowHolds(fixture: Phase2FixtureResult): boolean {
  const { evidence, golden } = fixture;
  if (golden.overflowExpectation === "bounded-max") {
    return (
      evidence.records.length === 1 &&
      evidence.records[0].status === PHASE2_JSON.STATUS_BOUNDED &&
      evidence.candidateSetSize === PHASE2_MAX_BOUNDED_CANDIDATES &&
      !evidence.truncatedOrOverflow
    );
  }
  return (
    evidence.truncatedOrOverflow &&
    evidence.candidateSetSize === null &&
    evidence.records.some(
      (record) =>
        record.status === PHASE2_JSON.STATUS_UNRESOLVED &&
        record.overflow &&
        record.candidatePaths.length === 0,
    ) &&
    !hasDynamicCandidateEntry(fixture)
  );
}

function gateOverflow(evaluation: Phase2Evaluation): Phase2GateViolation[] {
  const bad = evaluation.fixtures.filter(
    (fixture) =>
      fixture.errorReason === null &&
      fixture.golden.overflowExpectation !== undefined &&
      !overflowHolds(fixture),
  );
  return bad.length === 0
    ? []
    : [
        violation(
          "G8",
          bad.map((fixture) => fixture.golden.id),
          `64-bounded / ${PHASE2_OVERFLOW_REASON} overflow boundary violated`,
        ),
      ];
}

function normalizedGoldenEvidence(
  golden: Phase2FixtureGolden,
): Array<Omit<Phase2EvidenceRecord, "overflow">> {
  return golden.expectedEvidence
    .map((record) => ({
      sourceFile: record.sourceFile,
      status: record.status,
      reason: record.reason,
      candidatePaths: sortedUnique(record.candidatePaths),
    }))
    .sort(
      (a, b) =>
        compareText(a.sourceFile, b.sourceFile) ||
        compareText(a.reason, b.reason),
    );
}

function evidenceMatches(fixture: Phase2FixtureResult): boolean {
  const { evidence, golden } = fixture;
  const observed = evidence.records.map((record) => ({
    sourceFile: record.sourceFile,
    status: record.status,
    reason: record.reason,
    candidatePaths: record.candidatePaths,
  }));
  return (
    JSON.stringify(observed) ===
      JSON.stringify(normalizedGoldenEvidence(golden)) &&
    evidence.unrelatedAdmitted.length === 0 &&
    evidence.evidenceUnavailableReason ===
      (golden.expectedUnavailableReason ?? null) &&
    evidence.evidenceUnavailable ===
      (golden.expectedUnavailableReason !== undefined)
  );
}

function gateEvidenceState(
  evaluation: Phase2Evaluation,
): Phase2GateViolation[] {
  const bad = evaluation.fixtures.filter(
    (fixture) => fixture.errorReason === null && !evidenceMatches(fixture),
  );
  return bad.length === 0
    ? []
    : [
        violation(
          "G7",
          bad.map((fixture) => fixture.golden.id),
          "dynamic evidence state differs from golden",
        ),
      ];
}

/** Explicit reason: the riskNote names the unavailable reason or the first evidence reason. */
function hasExplicitReason(fixture: Phase2FixtureResult): boolean {
  const json = fixture.observation?.run.json;
  const note = json?.riskNote;
  if (typeof note !== "string" || note.length === 0) return false;
  const { evidence } = fixture;
  if (evidence.evidenceUnavailableReason !== null) {
    return note.includes(evidence.evidenceUnavailableReason);
  }
  return (
    evidence.records.length > 0 && note.includes(evidence.records[0].reason)
  );
}

function gateDegradation(evaluation: Phase2Evaluation): Phase2GateViolation[] {
  const bad = evaluation.fixtures.filter(
    (fixture) =>
      fixture.golden.degradation === true &&
      (fixture.observation?.run.exitCode !== 0 ||
        fixture.epistemicStatus !== "unknown" ||
        !hasExplicitReason(fixture)),
  );
  return bad.length === 0
    ? []
    : [
        violation(
          "G9",
          bad.map((fixture) => fixture.golden.id),
          "degradation did not surface as explicit uncertainty",
        ),
      ];
}

function gatePositive(evaluation: Phase2Evaluation): Phase2GateViolation[] {
  const bad = evaluation.records.filter(
    (record) =>
      record.intent === "confirmed-positive" &&
      (record.positive?.precision !== 1 ||
        record.positive.recall !== 1 ||
        record.positive.f1 !== 1),
  );
  return bad.length === 0
    ? []
    : [
        violation(
          "G11",
          bad.map((record) => fixtureIdOf(record.scenario)),
          "positive case is not perfect (P/R/F1 != 1)",
        ),
      ];
}

function gateStatus(evaluation: Phase2Evaluation): Phase2GateViolation[] {
  const bad = evaluation.records.filter((record) => !record.statusCorrect);
  return bad.length === 0
    ? []
    : [
        violation(
          "G1",
          bad.map((record) => fixtureIdOf(record.scenario)),
          `unexpected status (${bad
            .map((record) => `${record.scenario}=${record.observedStatus}`)
            .join(", ")})`,
        ),
      ];
}

/** Parses the Name -> Source cells of the human blast-radius table (only when a Source column exists). */
export function parseHumanSourceColumn(
  stdout: string,
): Record<string, string> | null {
  const rows = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(PHASE2_HUMAN.TABLE_ROW_PREFIX))
    .map((line) =>
      line
        .split(PHASE2_HUMAN.TABLE_ROW_PREFIX)
        .map((cell) => cell.trim())
        .filter((cell, index, cells) => index > 0 && index < cells.length - 1),
    );
  const header = rows.find((cells) => cells[0] === PHASE2_HUMAN.COL_NAME);
  if (!header) return null;
  const sourceIndex = header.indexOf(PHASE2_HUMAN.COL_SOURCE);
  if (sourceIndex < 0) return null;
  const table: Record<string, string> = {};
  for (const cells of rows) {
    if (cells === header) continue;
    table[cells[0]] = cells[sourceIndex];
  }
  return table;
}

function riskAndNoteFailure(
  json: Record<string, unknown>,
  combined: string,
): string | null {
  const risk = PHASE2_HUMAN.RISK_LINE.exec(combined)?.[1];
  if (risk !== json.riskLevel) return `risk line ${String(risk)}`;
  const hasNote = combined.includes(PHASE2_HUMAN.NOTE_PREFIX);
  return hasNote === (json.epistemic === PHASE2_JSON.LOWER_BOUND)
    ? null
    : "note presence";
}

function sourceColumnFailure(
  json: Record<string, unknown>,
  stdout: string,
): string | null {
  const entries = asRecordArray(json.blastRadius);
  const table = parseHumanSourceColumn(stdout);
  if (!entries.some((entry) => entry.edgeSource !== undefined)) {
    return table === null ? null : "unexpected source column";
  }
  if (table === null) return "source column missing";
  const mislabeled = entries.find(
    (entry) =>
      table[String(entry.name)] !==
      (entry.edgeSource === undefined
        ? PHASE2_JSON.EDGE_SOURCE_STATIC_LABEL
        : String(entry.edgeSource)),
  );
  return mislabeled ? `source label for ${String(mislabeled.name)}` : null;
}

/** Contract §3.5 human-output parity for one fixture; returns the failed check, or null. */
export function humanParityFailure(
  fixture: Phase2FixtureResult,
): string | null {
  const json = fixture.observation?.run.json;
  const human = fixture.observation?.human;
  if (!json || !human) return "human run missing";
  if (human.exitCode !== 0) return "human run exited non-zero";
  const combined = `${human.stdout}\n${human.stderr}`;
  const failure =
    riskAndNoteFailure(json, combined) ??
    sourceColumnFailure(json, human.stdout);
  if (failure !== null) return failure;
  return fixture.evidence.truncatedOrOverflow &&
    !combined.includes(PHASE2_OVERFLOW_REASON)
    ? "overflow reason not rendered"
    : null;
}

function gateHumanParity(evaluation: Phase2Evaluation): Phase2GateViolation[] {
  const bad = evaluation.fixtures
    .filter((fixture) => fixture.golden.humanParity === true)
    .map((fixture) => ({ fixture, failure: humanParityFailure(fixture) }))
    .filter(({ failure }) => failure !== null);
  return bad.length === 0
    ? []
    : [
        violation(
          "G12",
          bad.map(({ fixture }) => fixture.golden.id),
          `human parity broken (${bad
            .map(({ fixture, failure }) => `${fixture.golden.id}: ${failure}`)
            .join("; ")})`,
        ),
      ];
}

/**
 * Every Phase 2 gate violation, in the order `assertPhase2ImpactHonestyGates` reports them. The
 * order is deliberate: the specific honesty gates run before the generic status check so that a
 * poisoned control fails its *named* gate rather than a catch-all.
 */
export function phase2GateViolations(
  evaluation: Phase2Evaluation,
  options: Phase2GateOptions = {},
): Phase2GateViolation[] {
  const corpusLevel = options.corpusLevel ?? true;
  const aggregate = aggregateImpactHonesty(evaluation.records);
  return [
    ...gateCoverageAndErrors(evaluation, aggregate),
    ...gateEpistemic(evaluation, aggregate, corpusLevel),
    ...gateCalibration(evaluation, corpusLevel),
    ...gateProvenance(evaluation, aggregate),
    ...gateCandidatePromotion(evaluation, aggregate),
    ...gateOverflow(evaluation),
    ...gateEvidenceState(evaluation),
    ...gateDegradation(evaluation),
    ...gatePositive(evaluation),
    ...gateStatus(evaluation),
    ...gateHumanParity(evaluation),
  ];
}

export function assertPhase2ImpactHonestyGates(
  evaluation: Phase2Evaluation,
  options: Phase2GateOptions = {},
): ImpactHonestyAggregate {
  const [first] = phase2GateViolations(evaluation, options);
  if (first) throw new Error(first.message);
  return aggregateImpactHonesty(evaluation.records);
}

// ─── Poisoned controls (contract §5) ────────────────────────────────────────────────────────

export type Phase2JsonMutation = (
  json: Record<string, unknown>,
) => Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Applies `mutate` to one fixture's raw JSON (and returns new observations; inputs untouched). */
export function poisonObservation(
  observations: readonly Phase2Observation[],
  fixtureId: string,
  mutate: Phase2JsonMutation,
): Phase2Observation[] {
  if (
    !observations.some((observation) => observation.fixtureId === fixtureId)
  ) {
    throw new Error(`Phase 2 poison control: no observation for ${fixtureId}`);
  }
  return observations.map((observation) => {
    if (observation.fixtureId !== fixtureId || observation.run.json === null) {
      return observation;
    }
    return {
      ...observation,
      run: { ...observation.run, json: mutate(clone(observation.run.json)) },
    };
  });
}

function mapEntries(
  json: Record<string, unknown>,
  mutate: (entry: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  return { ...json, blastRadius: asRecordArray(json.blastRadius).map(mutate) };
}

/** P1: promote the dynamic-candidate loader entry to a static edge (E2). */
export const poisonPromoteCandidate: Phase2JsonMutation = (json) =>
  mapEntries(json, (entry) => {
    if (entry.edgeSource !== PHASE2_JSON.EDGE_SOURCE_DYNAMIC_CANDIDATE) {
      return entry;
    }
    const {
      edgeSource: _edgeSource,
      dynamicEvidence: _evidence,
      ...rest
    } = entry;
    return rest;
  });

/** P2: UNKNOWN turned into a confident empty answer (E4a). */
export const poisonConfidentEmpty: Phase2JsonMutation = (json) => {
  const { epistemic: _epistemic, riskNote: _riskNote, ...rest } = json;
  return { ...rest, riskLevel: "LOW" };
};

/** P3: truncate the overflow record into a bounded 64-candidate set (E4a). */
export function poisonTruncateOverflow(
  first64CandidatePaths: readonly string[],
): Phase2JsonMutation {
  return (json) => ({
    ...json,
    dynamicEvidence: asRecordArray(json.dynamicEvidence).map((record) => ({
      ...record,
      status: PHASE2_JSON.STATUS_BOUNDED,
      candidatePaths: [...first64CandidatePaths],
      reason: "bounded-local-pattern",
    })),
  });
}

/** P4: fabricated certainty on a non-empty result (E2). */
export const poisonFabricatedCertainty: Phase2JsonMutation = (json) => {
  const {
    epistemic: _epistemic,
    riskNote: _riskNote,
    dynamicEvidence: _evidence,
    ...rest
  } = json;
  return rest;
};

/** P5: lsp-fallback relabeled as static (E6). */
export const poisonRelabelFallback: Phase2JsonMutation = (json) =>
  mapEntries(json, (entry) => {
    if (entry.edgeSource === undefined) return entry;
    const { edgeSource: _edgeSource, ...rest } = entry;
    return rest;
  });

/** P6: masked coverage (E8). */
export const poisonMaskedCoverage: Phase2JsonMutation = (json) => ({
  ...json,
  partialCoverage: true,
});

/** P7: shape outside the documented contract (E8). */
export const poisonOutOfContract: Phase2JsonMutation = (json) => ({
  ...json,
  epistemic: "exact",
});

// ─── Deferred-defect tracking (contract §6 / plan §5.4) ────────────────────────────────────────

export interface Phase2KnownDefect {
  readonly defect: string;
  readonly issue: number;
}

/** Fixtures whose failure is a registered product defect; `issue` must name a child issue. */
export function knownDefectRegistryProblems(
  registry: Readonly<Record<string, Phase2KnownDefect>>,
  goldens: readonly Phase2FixtureGolden[],
): string[] {
  const ids = new Set(goldens.map((golden) => golden.id));
  return Object.entries(registry).flatMap(([fixtureId, entry]) => [
    ...(ids.has(fixtureId) ? [] : [`${fixtureId}: unknown fixture`]),
    ...(Number.isInteger(entry.issue) && entry.issue > 0
      ? []
      : [`${fixtureId}: ${entry.defect} has no child issue number`]),
  ]);
}

/** Splits an evaluation into the gated part and the registered-defect part. */
export function partitionKnownDefects(
  evaluation: Phase2Evaluation,
  registry: Readonly<Record<string, Phase2KnownDefect>>,
): { gated: Phase2Evaluation; deferred: Phase2Evaluation } {
  const split = (keep: (id: string) => boolean): Phase2Evaluation => {
    const fixtures = evaluation.fixtures.filter((fixture) =>
      keep(fixture.golden.id),
    );
    return {
      fixtures,
      records: fixtures.flatMap((fixture) => fixture.records),
    };
  };
  return {
    gated: split((id) => registry[id] === undefined),
    deferred: split((id) => registry[id] !== undefined),
  };
}

// ─── Reporting ─────────────────────────────────────────────────────────────────────────────────

function cell(value: boolean | number | null | string): string {
  return value === null ? "n/a" : String(value);
}

/** Evidence-layer columns; no blended score (use Phase 0's markdown for the aggregate). */
export function buildPhase2EvidenceMarkdown(
  evaluation: Phase2Evaluation,
): string {
  return [
    "## Impact benchmark honesty — Phase 2 evidence layer",
    "",
    "| fixture | epistemic | gold in set | set size | unrelated | overflow | unavailable |",
    "|---|---|---|---:|---|---|---|",
    ...evaluation.fixtures.map(
      (fixture) =>
        `| ${fixture.golden.id} | ${fixture.epistemicStatus} | ${cell(
          fixture.evidence.goldInCandidateSet,
        )} | ${cell(fixture.evidence.candidateSetSize)} | ${
          fixture.evidence.unrelatedAdmitted.join(", ") || "-"
        } | ${cell(fixture.evidence.truncatedOrOverflow)} | ${cell(
          fixture.evidence.evidenceUnavailableReason,
        )} |`,
    ),
    "",
  ].join("\n");
}
