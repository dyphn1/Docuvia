/**
 * Issue #508 Phase 3: pure freshness projection, per-checkpoint Phase 0 records, state-diff,
 * stale-edge/stale-record checks, gates and poisoned controls over real `docuvia impact` output
 * captured across repository and index state transitions.
 *
 * Everything here is pure: no subprocess, no SQLite. The corpus module
 * (`impact-honesty-corpus.phase3.ts`) runs the real CLI and snapshots the git and database facts
 * this module needs into `Phase3Observation`s. Poisons mutate raw JSON or facts *before*
 * projection, so the projections themselves are exercised. Phase 0 scoring
 * (`scoreImpactHonestyCase` / `aggregateImpactHonesty`) and the Phase 2 projections are used
 * unchanged.
 *
 * TDD-SOURCE: issue #508 Phase 3 staleness and graph state-transition robustness
 * TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase3.md
 * TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
 * TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md
 * TDD-SOURCE: issue #193 graph freshness visibility
 * TDD-SOURCE: docs/gitbook/adr/platform/PLAT-007-tiered-background-knowledge-evolution.md
 * TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
 * TDD-SOURCE: docs/gitbook/guidelines/phase-based-test-quality-hardening.md
 */

import {
  IMPACT_HONESTY_SCHEMA_VERSION,
  aggregateImpactHonesty,
  scoreImpactHonestyCase,
  type ImpactHonestyAggregate,
  type ImpactHonestyCaseIntent,
  type ImpactHonestyCaseResult,
  type ImpactHonestyExpectedStatus,
  type ImpactHonestyObservedStatus,
  type ImpactHonestyPrediction,
} from "./impact-eval-honesty.js";
import {
  PHASE2_HUMAN,
  PHASE2_JSON,
  observeEvidence,
  predictionsFor,
  projectEpistemic,
  projectResolution,
  type Phase2EpistemicStatus,
  type Phase2EvidenceGolden,
  type Phase2EvidenceObservation,
  type Phase2ResolutionStatus,
  type RawImpactRun,
} from "./impact-honesty-epistemic.phase2.js";

export const PHASE3_PHASES = {
  BEFORE: "before",
  AFTER: "after",
  AFTER_TIER_A: "afterTierA",
  FAILED: "failed",
  INFLIGHT: "inflight",
} as const;
export type Phase3Phase = (typeof PHASE3_PHASES)[keyof typeof PHASE3_PHASES];

/** Phases observed on a graph that has not caught up with HEAD (contract §1.3). */
export const PHASE3_STALE_PHASES: readonly Phase3Phase[] = [
  PHASE3_PHASES.BEFORE,
  PHASE3_PHASES.FAILED,
  PHASE3_PHASES.INFLIGHT,
];

/** Phases observed after a successful re-ingest (contract §1.3). */
export const PHASE3_INGESTED_PHASES: readonly Phase3Phase[] = [
  PHASE3_PHASES.AFTER,
  PHASE3_PHASES.AFTER_TIER_A,
];

export const PHASE3_FRESHNESS = {
  FRESH: "fresh",
  STALE: "stale",
  ERROR: "error",
  NOT_APPLICABLE: "not-applicable",
} as const;
export type Phase3Freshness =
  (typeof PHASE3_FRESHNESS)[keyof typeof PHASE3_FRESHNESS];
export type Phase3ExpectedFreshness =
  typeof PHASE3_FRESHNESS.FRESH | typeof PHASE3_FRESHNESS.STALE;

export const PHASE3_EPISTEMIC = {
  EXACT: "exact",
  LOWER_BOUND: "lower-bound",
} as const;
export type Phase3ExpectedEpistemic =
  (typeof PHASE3_EPISTEMIC)[keyof typeof PHASE3_EPISTEMIC];

export const PHASE3_COVERAGE = {
  COMPLETE: "complete",
  PARTIAL: "partial",
} as const;
export type Phase3ExpectedCoverage =
  (typeof PHASE3_COVERAGE)[keyof typeof PHASE3_COVERAGE];

export const PHASE3_OPERATION = {
  SUCCESS: "success",
  FAILURE: "failure",
} as const;
export type Phase3ExpectedOperation =
  (typeof PHASE3_OPERATION)[keyof typeof PHASE3_OPERATION];

/** Why a whole target observation was recorded as `error`. */
export const PHASE3_ERROR_REASONS = {
  MISSING_OBSERVATION: "missing-observation",
  EXIT_NONZERO: "exit-nonzero",
  PARSE_ERROR: "parse-error",
  COVERAGE_MISMATCH: "coverage-mismatch",
  OUT_OF_CONTRACT: "out-of-contract",
  FRESHNESS_OUT_OF_CONTRACT: "freshness-out-of-contract",
  TARGET_IDENTITY: "target-identity",
  EDGE_SOURCE: "unknown-edge-source",
} as const;
export type Phase3ErrorReason =
  (typeof PHASE3_ERROR_REASONS)[keyof typeof PHASE3_ERROR_REASONS];

const SHA40 = /^[0-9a-f]{40}$/;

function isSha40(value: unknown): value is string {
  return typeof value === "string" && SHA40.test(value);
}

/** A stale object whose shas are well-formed and differ, on a lower-bound result with a reason. */
function isInContractStale(
  json: Record<string, unknown>,
  freshness: Record<string, unknown>,
): boolean {
  const { state, graphSourceSha, headSha } = freshness;
  // Q3: only "stale" is in contract; fresh and unknown omit the field.
  if (state !== PHASE3_FRESHNESS.STALE) return false;
  if (!isSha40(graphSourceSha) || !isSha40(headSha)) return false;
  if (graphSourceSha === headSha) return false;
  // A stale graph may never be exact, and must say why.
  return (
    json.epistemic === PHASE2_JSON.LOWER_BOUND &&
    typeof json.riskNote === "string" &&
    json.riskNote.length > 0
  );
}

/** Freshness projection — FROZEN (contract §1.1). */
export function projectFreshness(run: RawImpactRun): Phase3Freshness {
  if (projectResolution(run) !== "resolved") {
    return PHASE3_FRESHNESS.NOT_APPLICABLE;
  }
  const json = run.json as Record<string, unknown>;
  const freshness = json.graphFreshness;
  if (freshness === undefined) return PHASE3_FRESHNESS.FRESH;
  if (typeof freshness !== "object" || freshness === null) {
    return PHASE3_FRESHNESS.ERROR;
  }
  return isInContractStale(json, freshness as Record<string, unknown>)
    ? PHASE3_FRESHNESS.STALE
    : PHASE3_FRESHNESS.ERROR;
}

function staleShas(
  run: RawImpactRun,
): { graphSourceSha: string; headSha: string } | null {
  const freshness = run.json?.graphFreshness as
    Record<string, unknown> | undefined;
  if (!freshness) return null;
  return {
    graphSourceSha: String(freshness.graphSourceSha),
    headSha: String(freshness.headSha),
  };
}

// ─── Goldens and observations ──────────────────────────────────────────────────────────────────

export interface Phase3TargetGolden {
  readonly target: string;
  /** File that defines `target` in the graph under observation; identity `${targetFile}#${target}`. */
  readonly targetFile: string;
  readonly expectedConfirmedFiles: readonly string[];
  readonly expectedCandidateFiles: readonly string[];
  readonly expectedEvidence: readonly Phase2EvidenceGolden[];
  readonly expectedEpistemic: Phase3ExpectedEpistemic;
  /** The symbol was removed at HEAD: `impact` must return `null` (Phase 0 `not-found`). */
  readonly notFound?: boolean;
}

export interface Phase3Checkpoint {
  /** `${transition}@${phase}` */
  readonly id: string;
  readonly transition: string;
  readonly phase: Phase3Phase;
  readonly expectedFreshness: Phase3ExpectedFreshness;
  readonly expectedCoverage: Phase3ExpectedCoverage;
  readonly targets: readonly Phase3TargetGolden[];
  /** The previous fresh checkpoint (S7 state-diff baseline). */
  readonly previousFresh?: string;
  /** Target -> paths that must not survive this re-ingest in its output (S5); `"*"` = every target. */
  readonly mustDisappear?: Readonly<Record<string, readonly string[]>>;
  /** Compare normalized JSON with a fresh `init` of the same tree (S8). */
  readonly oracle?: boolean;
  /** Expected result of the operation that produced this checkpoint (S9). */
  readonly operation?: Phase3ExpectedOperation;
  /** Analyze log events the operation must emit (S9), e.g. the rewind fallback. */
  readonly expectedEvents?: readonly string[];
  /** S11: this checkpoint's store counts and raw stdout must equal the reference checkpoint's. */
  readonly accumulationReference?: string;
}

export interface Phase3TargetObservation {
  readonly target: string;
  readonly run: RawImpactRun;
  readonly human?: RawImpactRun;
  /** Phase 1 `inferObservedTarget` result; null when identity could not be established. */
  readonly targetIdentity: { identity: string; filePath: string } | null;
  /** `l2_nodes.path_patterns` for every blast-radius entry name. */
  readonly entryFiles: Readonly<Record<string, readonly string[]>>;
}

export interface Phase3OperationResult {
  readonly label: string;
  readonly exitCode: number;
  /** Analyze log event names appended by this operation, in order. */
  readonly events: readonly string[];
}

export interface Phase3StoreCounts {
  readonly l2Nodes: number;
  readonly nodeLinks: number;
  readonly callSites: number;
  readonly projectFiles: number;
  readonly evidenceRecords: number;
}

/** Read-only store facts (contract §3); every path list is sorted and unique. */
export interface Phase3StoreFacts {
  readonly counts: Phase3StoreCounts;
  readonly dangling: number;
  readonly nodePaths: readonly string[];
  readonly callSitePaths: readonly string[];
  readonly projectFilePaths: readonly string[];
  readonly evidencePaths: readonly string[];
  /** Keys present in the persisted per-file call-resolution map. */
  readonly callResolutionPaths: readonly string[];
  /** `git ls-files` at HEAD minus files over `MAX_FILE_SIZE_BYTES`. */
  readonly headTree: readonly string[];
}

export interface Phase3Observation {
  readonly checkpointId: string;
  readonly headSha: string;
  /** `docuvia_meta.lastIngestedSourceSha` (read-only fact), null when absent. */
  readonly metaSha: string | null;
  /** Meta sha before the operation ran (S9: a failed ingestion must not advance it). */
  readonly metaShaBeforeOperation?: string | null;
  /** Parsed `docuvia status` `Graph Freshness` row. */
  readonly statusFreshness: string | null;
  /** The gated operation that produced this checkpoint. */
  readonly operation?: Phase3OperationResult;
  /** Recorded, never gated or compared for determinism (I1 background, C1 concurrent pair). */
  readonly ungatedOperations?: readonly Phase3OperationResult[];
  readonly targets: readonly Phase3TargetObservation[];
  readonly facts: Phase3StoreFacts;
  /** Target -> `normalizeImpactForOracle` output of a fresh `init` of the same tree (S8). */
  readonly oracle?: Readonly<Record<string, string>>;
}

export interface Phase3TargetResult {
  readonly golden: Phase3TargetGolden;
  readonly observation: Phase3TargetObservation | null;
  readonly errorReason: Phase3ErrorReason | null;
  readonly freshness: Phase3Freshness;
  readonly resolutionStatus: Phase2ResolutionStatus;
  readonly epistemicStatus: Phase2EpistemicStatus;
  readonly evidence: Phase2EvidenceObservation;
  readonly predictions: ImpactHonestyPrediction[];
  readonly confirmedFiles: string[];
  readonly candidateFiles: string[];
  readonly records: ImpactHonestyCaseResult[];
}

export interface Phase3CheckpointResult {
  readonly checkpoint: Phase3Checkpoint;
  readonly observation: Phase3Observation | null;
  readonly targets: Phase3TargetResult[];
  readonly records: ImpactHonestyCaseResult[];
}

export interface Phase3Evaluation {
  readonly checkpoints: Phase3CheckpointResult[];
  readonly records: ImpactHonestyCaseResult[];
  /** Every checkpoint of the run, for state-diff/accumulation lookups across a partition. */
  readonly reference: readonly Phase3CheckpointResult[];
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

const EMPTY_RUN: RawImpactRun = {
  exitCode: 1,
  stdout: "",
  stderr: "",
  json: null,
  parseError: false,
};

const CONFIRMED_CHANNELS = new Set(["static", "lsp-fallback"]);
const CANDIDATE_CHANNEL = "dynamic-candidate";

export function isStalePhase(phase: Phase3Phase): boolean {
  return PHASE3_STALE_PHASES.includes(phase);
}

export function isIngestedPhase(phase: Phase3Phase): boolean {
  return PHASE3_INGESTED_PHASES.includes(phase);
}

/** Contract §1.3: which Phase 0 intents a target contributes at a checkpoint. */
export function intentsFor(
  phase: Phase3Phase,
  golden: Phase3TargetGolden,
): ImpactHonestyCaseIntent[] {
  if (phase !== PHASE3_PHASES.AFTER) return ["epistemic-unknown"];
  if (golden.notFound) return ["not-found"];
  const lowerBound = golden.expectedEpistemic === PHASE3_EPISTEMIC.LOWER_BOUND;
  if (golden.expectedCandidateFiles.length > 0) {
    return ["candidate-boundary", "epistemic-unknown"];
  }
  if (golden.expectedConfirmedFiles.length > 0) {
    return lowerBound
      ? ["confirmed-positive", "epistemic-unknown"]
      : ["confirmed-positive"];
  }
  return ["negative", "epistemic-unknown"];
}

function expectedStatusFor(
  intent: ImpactHonestyCaseIntent,
): ImpactHonestyExpectedStatus {
  if (intent === "epistemic-unknown") return "unknown";
  if (intent === "not-found") return "not-found";
  return "resolved";
}

function expectedPredictionsFor(
  intent: ImpactHonestyCaseIntent,
  golden: Phase3TargetGolden,
): ImpactHonestyPrediction[] {
  if (intent === "confirmed-positive") {
    return golden.expectedConfirmedFiles.map((file) => ({
      file,
      channel: "static",
    }));
  }
  if (intent === "candidate-boundary") {
    return golden.expectedCandidateFiles.map((file) => ({
      file,
      channel: CANDIDATE_CHANNEL,
    }));
  }
  return [];
}

function coverageMatches(
  json: Record<string, unknown>,
  expected: Phase3ExpectedCoverage,
): boolean {
  return expected === PHASE3_COVERAGE.PARTIAL
    ? json.partialCoverage === true
    : json.partialCoverage === undefined;
}

function targetError(
  checkpoint: Phase3Checkpoint,
  observation: Phase3TargetObservation | null,
): Phase3ErrorReason | null {
  if (observation === null) return PHASE3_ERROR_REASONS.MISSING_OBSERVATION;
  const { run } = observation;
  if (run.exitCode !== 0) return PHASE3_ERROR_REASONS.EXIT_NONZERO;
  if (run.parseError) return PHASE3_ERROR_REASONS.PARSE_ERROR;
  if (run.json === null) return null; // not-found stays observable
  if (projectFreshness(run) === PHASE3_FRESHNESS.ERROR) {
    return PHASE3_ERROR_REASONS.FRESHNESS_OUT_OF_CONTRACT;
  }
  if (projectEpistemic(run) === "error") {
    return PHASE3_ERROR_REASONS.OUT_OF_CONTRACT;
  }
  if (!coverageMatches(run.json, checkpoint.expectedCoverage)) {
    return PHASE3_ERROR_REASONS.COVERAGE_MISMATCH;
  }
  if (observation.targetIdentity === null) {
    return PHASE3_ERROR_REASONS.TARGET_IDENTITY;
  }
  return null;
}

function safePredictions(
  observation: Phase3TargetObservation | null,
  errorReason: Phase3ErrorReason | null,
): {
  predictions: ImpactHonestyPrediction[];
  errorReason: Phase3ErrorReason | null;
} {
  if (errorReason !== null || observation === null) {
    return { predictions: [], errorReason };
  }
  if (observation.run.json === null) return { predictions: [], errorReason };
  try {
    return {
      predictions: predictionsFor({ ...observation, fixtureId: "" }),
      errorReason: null,
    };
  } catch {
    return { predictions: [], errorReason: PHASE3_ERROR_REASONS.EDGE_SOURCE };
  }
}

function filesOnChannels(
  predictions: readonly ImpactHonestyPrediction[],
  channels: (channel: string) => boolean,
): string[] {
  return sortedUnique(
    predictions
      .filter((prediction) => channels(prediction.channel))
      .map((prediction) => prediction.file),
  );
}

export function scenarioId(
  checkpoint: Phase3Checkpoint,
  target: string,
  intent: ImpactHonestyCaseIntent,
): string {
  return `${checkpoint.id}:${target}#${intent}`;
}

/** One target's Phase 0 records at one checkpoint (contract §1.3). */
export function buildPhase3TargetResult(
  checkpoint: Phase3Checkpoint,
  golden: Phase3TargetGolden,
  observation: Phase3TargetObservation | null,
): Phase3TargetResult {
  const { predictions, errorReason } = safePredictions(
    observation,
    targetError(checkpoint, observation),
  );
  const run = observation?.run ?? EMPTY_RUN;
  const forcedError = errorReason !== null;
  const resolutionStatus: Phase2ResolutionStatus = forcedError
    ? "error"
    : projectResolution(run);
  const epistemicStatus: Phase2EpistemicStatus = forcedError
    ? "error"
    : projectEpistemic(run);
  const records = intentsFor(checkpoint.phase, golden).map((intent) =>
    scoreImpactHonestyCase({
      schemaVersion: IMPACT_HONESTY_SCHEMA_VERSION,
      scenario: scenarioId(checkpoint, golden.target, intent),
      target: golden.target,
      ...(golden.notFound
        ? {}
        : { expectedTargetIdentity: `${golden.targetFile}#${golden.target}` }),
      observedTargetIdentity: observation?.targetIdentity?.identity,
      intent,
      expectedStatus: expectedStatusFor(intent),
      expectedConfirmedFiles: golden.expectedConfirmedFiles,
      expectedCandidateFiles: golden.expectedCandidateFiles,
      expectedPredictions: expectedPredictionsFor(intent, golden),
      observedStatus: (intent === "epistemic-unknown"
        ? epistemicStatus
        : resolutionStatus) as ImpactHonestyObservedStatus,
      predictions,
    }),
  );
  return {
    golden,
    observation,
    errorReason,
    freshness: forcedError
      ? errorReason === PHASE3_ERROR_REASONS.FRESHNESS_OUT_OF_CONTRACT
        ? PHASE3_FRESHNESS.ERROR
        : PHASE3_FRESHNESS.NOT_APPLICABLE
      : projectFreshness(run),
    resolutionStatus,
    epistemicStatus,
    evidence: observeEvidence(run, golden),
    predictions,
    confirmedFiles: filesOnChannels(predictions, (channel) =>
      CONFIRMED_CHANNELS.has(channel),
    ),
    candidateFiles: filesOnChannels(
      predictions,
      (channel) => channel === CANDIDATE_CHANNEL,
    ),
    records,
  };
}

export function buildPhase3CheckpointResult(
  checkpoint: Phase3Checkpoint,
  observation: Phase3Observation | null,
): Phase3CheckpointResult {
  const byTarget = new Map(
    (observation?.targets ?? []).map((target) => [target.target, target]),
  );
  const targets = checkpoint.targets.map((golden) =>
    buildPhase3TargetResult(
      checkpoint,
      golden,
      byTarget.get(golden.target) ?? null,
    ),
  );
  return {
    checkpoint,
    observation,
    targets,
    records: targets.flatMap((target) => target.records),
  };
}

export function buildPhase3Evaluation(
  checkpoints: readonly Phase3Checkpoint[],
  observations: readonly Phase3Observation[],
): Phase3Evaluation {
  const byId = new Map(
    observations.map((observation) => [observation.checkpointId, observation]),
  );
  const results = checkpoints.map((checkpoint) =>
    buildPhase3CheckpointResult(checkpoint, byId.get(checkpoint.id) ?? null),
  );
  return {
    checkpoints: results,
    records: results.flatMap((result) => result.records),
    reference: results,
  };
}

/** A sub-evaluation over `ids`; lookups still see the whole run through `reference`. */
export function selectPhase3Checkpoints(
  evaluation: Phase3Evaluation,
  keep: (id: string) => boolean,
): Phase3Evaluation {
  const checkpoints = evaluation.checkpoints.filter((result) =>
    keep(result.checkpoint.id),
  );
  return {
    checkpoints,
    records: checkpoints.flatMap((result) => result.records),
    reference: evaluation.reference,
  };
}

// ─── Oracle normalization (S8) ─────────────────────────────────────────────────────────────────

/** Normalized impact JSON compared against a fresh `init` of the same tree (contract §4 S8). */
export function normalizeImpactForOracle(
  json: Record<string, unknown> | null,
): string {
  if (json === null) return "null";
  const blastRadius = asRecordArray(json.blastRadius)
    .map((entry) => ({
      name: String(entry.name),
      edgeSource: entry.edgeSource === undefined ? null : entry.edgeSource,
    }))
    .sort(
      (a, b) =>
        compareText(a.name, b.name) ||
        compareText(String(a.edgeSource), String(b.edgeSource)),
    );
  return JSON.stringify({
    blastRadius,
    riskLevel: json.riskLevel ?? null,
    epistemic: json.epistemic ?? null,
    riskNote: json.riskNote ?? null,
    dynamicEvidence: json.dynamicEvidence ?? null,
    partialCoverage: json.partialCoverage ?? null,
    graphFreshness: json.graphFreshness ?? null,
  });
}

// ─── Gates (contract §4) ────────────────────────────────────────────────────────────────────

export type Phase3GateId =
  | "S0"
  | "S1"
  | "S2"
  | "S3"
  | "S4"
  | "S5"
  | "S6"
  | "S7"
  | "S8"
  | "S9"
  | "S10"
  | "S11"
  | "S12"
  | "S13";

/** `corpusLevel: false` evaluates a subset: the non-vacuity minimums are skipped. */
export interface Phase3GateOptions {
  readonly corpusLevel?: boolean;
}

export const PHASE3_MIN_EPISTEMIC_CASES = 25;
export const PHASE3_MIN_STALE_OBSERVATIONS = 8;
export const PHASE3_CALIBRATION_TARGET = "evalP3CtrlTarget";
export const PHASE3_EVERY_TARGET = "*";

export interface Phase3GateViolation {
  readonly gate: Phase3GateId;
  readonly checkpoints: string[];
  readonly message: string;
}

function violation(
  gate: Phase3GateId,
  checkpoints: readonly string[],
  detail: string,
): Phase3GateViolation {
  const ids = sortedUnique(checkpoints);
  return {
    gate,
    checkpoints: ids,
    message: `Phase 3 impact honesty gate ${gate}: ${detail} in ${ids.join(", ")}`,
  };
}

function checkpointOf(scenario: string): string {
  return scenario.split(":")[0];
}

function lookup(
  evaluation: Phase3Evaluation,
  id: string | undefined,
): Phase3CheckpointResult | undefined {
  if (id === undefined) return undefined;
  return evaluation.reference.find((result) => result.checkpoint.id === id);
}

interface TargetAt {
  readonly checkpoint: Phase3Checkpoint;
  readonly observation: Phase3Observation | null;
  readonly target: Phase3TargetResult;
}

function everyTarget(evaluation: Phase3Evaluation): TargetAt[] {
  return evaluation.checkpoints.flatMap((result) =>
    result.targets.map((target) => ({
      checkpoint: result.checkpoint,
      observation: result.observation,
      target,
    })),
  );
}

function gateErrors(
  evaluation: Phase3Evaluation,
  aggregate: ImpactHonestyAggregate,
): Phase3GateViolation[] {
  const errored = everyTarget(evaluation).filter(
    ({ target }) => target.errorReason !== null,
  );
  const mismatched = errored.filter(
    ({ target }) =>
      target.errorReason === PHASE3_ERROR_REASONS.COVERAGE_MISMATCH,
  );
  if (mismatched.length > 0) {
    return [
      violation(
        "S0",
        mismatched.map(({ checkpoint }) => checkpoint.id),
        `coverage-mismatch (${mismatched
          .map(({ target }) => target.golden.target)
          .join(", ")})`,
      ),
    ];
  }
  if (aggregate.errorCases > 0 || errored.length > 0) {
    return [
      violation(
        "S0",
        errored.map(({ checkpoint }) => checkpoint.id),
        `${aggregate.errorCases} case(s) errored [${errored
          .map(
            ({ checkpoint, target }) =>
              `${checkpoint.id}:${target.golden.target}=${target.errorReason}`,
          )
          .join(", ")}]`,
      ),
    ];
  }
  return [];
}

function failedOperationProblem(
  observation: Phase3Observation,
  targets: readonly Phase3TargetResult[],
): string | null {
  if (observation.operation!.exitCode === 0) {
    return "failed operation reported exit 0";
  }
  if (observation.metaSha !== observation.metaShaBeforeOperation) {
    return "failed operation advanced lastIngestedSourceSha";
  }
  const clean = targets.filter(
    (target) =>
      target.freshness !== PHASE3_FRESHNESS.STALE ||
      target.epistemicStatus !== "unknown",
  );
  return clean.length > 0
    ? `post-failure result not stale/unknown (${clean
        .map((target) => target.golden.target)
        .join(", ")})`
    : null;
}

function operationProblem(
  checkpoint: Phase3Checkpoint,
  observation: Phase3Observation | null,
  targets: readonly Phase3TargetResult[],
): string | null {
  if (checkpoint.operation === undefined) return null;
  const operation = observation?.operation;
  if (!observation || !operation) return "operation not recorded";
  const missing = (checkpoint.expectedEvents ?? []).filter(
    (event) => !operation.events.includes(event),
  );
  if (missing.length > 0) {
    return `operation events missing ${missing.join(", ")}`;
  }
  if (checkpoint.operation === PHASE3_OPERATION.FAILURE) {
    return failedOperationProblem(observation, targets);
  }
  return operation.exitCode === 0
    ? null
    : `operation exited ${operation.exitCode}`;
}

function gateIngestionFailure(
  evaluation: Phase3Evaluation,
): Phase3GateViolation[] {
  const bad = evaluation.checkpoints
    .map((result) => ({
      id: result.checkpoint.id,
      problem: operationProblem(
        result.checkpoint,
        result.observation,
        result.targets,
      ),
    }))
    .filter(({ problem }) => problem !== null);
  return bad.length === 0
    ? []
    : [
        violation(
          "S9",
          bad.map(({ id }) => id),
          `ingestion failure / operation result differs from golden (${bad
            .map(({ id, problem }) => `${id}: ${problem}`)
            .join("; ")})`,
        ),
      ];
}

function gateFalseSafeAndCertainty(
  evaluation: Phase3Evaluation,
  aggregate: ImpactHonestyAggregate,
  corpusLevel: boolean,
): Phase3GateViolation[] {
  const violations: Phase3GateViolation[] = [];
  const falseSafe = evaluation.records.filter(
    (record) => record.epistemic?.falseSafe === true,
  );
  if (falseSafe.length > 0) {
    violations.push(
      violation(
        "S2",
        falseSafe.map((record) => checkpointOf(record.scenario)),
        `false-safe rate ${String(aggregate.epistemic.falseSafeRate)} is not 0 (verified zero-impact claim)`,
      ),
    );
  }
  if (corpusLevel && aggregate.epistemic.cases < PHASE3_MIN_EPISTEMIC_CASES) {
    violations.push(
      violation(
        "S2",
        ["corpus"],
        `false-safe gate is vacuous: only ${aggregate.epistemic.cases} epistemic case(s), need >= ${PHASE3_MIN_EPISTEMIC_CASES}`,
      ),
    );
  }
  const wrongCertainty = evaluation.records.filter(
    (record) => record.epistemic?.wrongCertainty === true,
  );
  if (wrongCertainty.length > 0) {
    violations.push(
      violation(
        "S3",
        wrongCertainty.map((record) => checkpointOf(record.scenario)),
        `${wrongCertainty.length} wrong-certainty case(s): exact claim on a stale or partial graph`,
      ),
    );
  }
  return violations;
}

/** Additive metric (contract §4 S4): exact `after` answers that omit a HEAD dependent. */
export function incompleteCertaintyRecords(
  evaluation: Phase3Evaluation,
): ImpactHonestyCaseResult[] {
  return everyTarget(evaluation)
    .filter(
      ({ checkpoint, target }) =>
        checkpoint.phase === PHASE3_PHASES.AFTER &&
        target.epistemicStatus === "resolved",
    )
    .flatMap(({ target }) =>
      target.records.filter(
        (record) =>
          record.intent === "confirmed-positive" &&
          record.positive !== null &&
          record.positive.fn > 0,
      ),
    );
}

function gateIncompleteCertainty(
  evaluation: Phase3Evaluation,
): Phase3GateViolation[] {
  const bad = incompleteCertaintyRecords(evaluation);
  return bad.length === 0
    ? []
    : [
        violation(
          "S4",
          bad.map((record) => checkpointOf(record.scenario)),
          `incomplete-certainty: ${bad.length} exact answer(s) omit a HEAD dependent (${bad
            .map((record) => record.scenario)
            .join(", ")})`,
        ),
      ];
}

function surfacedPaths(target: Phase3TargetResult): string[] {
  return sortedUnique([
    ...target.confirmedFiles,
    ...target.candidateFiles,
    ...target.evidence.records.flatMap((record) => [
      record.sourceFile,
      ...record.candidatePaths,
    ]),
    ...(target.observation?.targetIdentity
      ? [target.observation.targetIdentity.filePath]
      : []),
  ]);
}

function mustDisappearFor(
  checkpoint: Phase3Checkpoint,
  target: string,
): readonly string[] {
  return [
    ...(checkpoint.mustDisappear?.[PHASE3_EVERY_TARGET] ?? []),
    ...(checkpoint.mustDisappear?.[target] ?? []),
  ];
}

function gateStaleEdge(evaluation: Phase3Evaluation): Phase3GateViolation[] {
  const bad = everyTarget(evaluation)
    .filter(({ checkpoint }) => isIngestedPhase(checkpoint.phase))
    .map(({ checkpoint, target }) => {
      const gone = mustDisappearFor(checkpoint, target.golden.target);
      return {
        id: checkpoint.id,
        target: target.golden.target,
        survivors: surfacedPaths(target).filter((path) => gone.includes(path)),
      };
    })
    .filter(({ survivors }) => survivors.length > 0);
  return bad.length === 0
    ? []
    : [
        violation(
          "S5",
          bad.map(({ id }) => id),
          `stale edge survived re-ingest (${bad
            .map(
              ({ id, target, survivors }) =>
                `${id}:${target} -> ${survivors.join(", ")}`,
            )
            .join("; ")})`,
        ),
      ];
}

/** Contract §3 R1-R6 for one set of facts; returns every broken invariant. */
export function staleRecordProblems(facts: Phase3StoreFacts): string[] {
  const tree = new Set(facts.headTree);
  const outside = (label: string, paths: readonly string[]): string[] => {
    const stale = paths.filter((path) => !tree.has(path));
    return stale.length === 0 ? [] : [`${label}: ${stale.join(", ")}`];
  };
  return [
    ...(facts.dangling === 0
      ? []
      : [`R1 dangling node_links: ${facts.dangling}`]),
    ...outside("R2 l2_nodes", facts.nodePaths),
    ...outside("R3 ast_call_sites", facts.callSitePaths),
    ...outside("R4 project_files", facts.projectFilePaths),
    ...outside("R5 evidence", facts.evidencePaths),
    ...outside("R6 call-resolution", facts.callResolutionPaths),
  ];
}

function succeeded(result: Phase3CheckpointResult): boolean {
  return (
    isIngestedPhase(result.checkpoint.phase) &&
    (result.observation?.operation?.exitCode ?? 0) === 0
  );
}

function gateStaleRecord(evaluation: Phase3Evaluation): Phase3GateViolation[] {
  const bad = evaluation.checkpoints
    .filter((result) => succeeded(result) && result.observation !== null)
    .map((result) => ({
      id: result.checkpoint.id,
      problems: staleRecordProblems(result.observation!.facts),
    }))
    .filter(({ problems }) => problems.length > 0);
  return bad.length === 0
    ? []
    : [
        violation(
          "S6",
          bad.map(({ id }) => id),
          `stale record after re-ingest (${bad
            .map(({ id, problems }) => `${id}: ${problems.join(" | ")}`)
            .join("; ")})`,
        ),
      ];
}

function setDifference(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return sortedUnique(a.filter((item) => !other.has(item)));
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify(sortedUnique(a)) === JSON.stringify(sortedUnique(b));
}

function stateDiffProblem(
  checkpoint: Phase3Checkpoint,
  target: Phase3TargetResult,
  previous: Phase3TargetResult | undefined,
): string | null {
  if (!previous || target.golden.notFound || previous.golden.notFound) {
    return null;
  }
  const kinds: Array<
    [
      string,
      (t: Phase3TargetResult) => readonly string[],
      (t: Phase3TargetGolden) => readonly string[],
    ]
  > = [
    ["confirmed", (t) => t.confirmedFiles, (g) => g.expectedConfirmedFiles],
    ["candidate", (t) => t.candidateFiles, (g) => g.expectedCandidateFiles],
  ];
  for (const [kind, observed, expected] of kinds) {
    if (isStalePhase(checkpoint.phase)) {
      if (!sameSet(observed(target), observed(previous))) {
        return `${kind} set changed on a stale graph`;
      }
      continue;
    }
    const added = setDifference(observed(target), observed(previous));
    const removed = setDifference(observed(previous), observed(target));
    const goldenAdded = setDifference(
      expected(target.golden),
      expected(previous.golden),
    );
    const goldenRemoved = setDifference(
      expected(previous.golden),
      expected(target.golden),
    );
    if (!sameSet(added, goldenAdded) || !sameSet(removed, goldenRemoved)) {
      return `${kind} +[${added.join(", ")}] -[${removed.join(", ")}], golden +[${goldenAdded.join(", ")}] -[${goldenRemoved.join(", ")}]`;
    }
  }
  return null;
}

function gateStateDiff(evaluation: Phase3Evaluation): Phase3GateViolation[] {
  const bad: Array<{ id: string; detail: string }> = [];
  for (const result of evaluation.checkpoints) {
    const previous = lookup(evaluation, result.checkpoint.previousFresh);
    if (!previous) continue;
    for (const target of result.targets) {
      const problem = stateDiffProblem(
        result.checkpoint,
        target,
        previous.targets.find(
          (candidate) => candidate.golden.target === target.golden.target,
        ),
      );
      if (problem !== null) {
        bad.push({
          id: result.checkpoint.id,
          detail: `${result.checkpoint.id}:${target.golden.target} ${problem}`,
        });
      }
    }
  }
  return bad.length === 0
    ? []
    : [
        violation(
          "S7",
          bad.map(({ id }) => id),
          `state-diff mismatch (${bad.map(({ detail }) => detail).join("; ")})`,
        ),
      ];
}

function humanNoteProblem(target: Phase3TargetResult): string | null {
  const human = target.observation?.human;
  const json = target.observation?.run.json;
  if (!human || !json) return null;
  const hasNote = `${human.stdout}\n${human.stderr}`.includes(
    PHASE2_HUMAN.NOTE_PREFIX,
  );
  const expectsNote = typeof json.riskNote === "string";
  return hasNote === expectsNote ? null : "human Note: parity";
}

function shaFactProblem(
  observation: Phase3Observation,
  target: Phase3TargetResult,
): string | null {
  const { metaSha, headSha } = observation;
  if (target.freshness !== PHASE3_FRESHNESS.STALE) {
    return metaSha === headSha
      ? null
      : "reported fresh while lastIngestedSourceSha != HEAD";
  }
  const shas = staleShas(target.observation!.run)!;
  if (shas.graphSourceSha !== metaSha) {
    return "graphSourceSha differs from lastIngestedSourceSha";
  }
  return shas.headSha === headSha ? null : "headSha differs from HEAD";
}

function freshnessProblem(
  checkpoint: Phase3Checkpoint,
  observation: Phase3Observation | null,
  target: Phase3TargetResult,
): string | null {
  if (target.freshness === PHASE3_FRESHNESS.NOT_APPLICABLE) return null;
  if (target.freshness !== checkpoint.expectedFreshness) {
    return `observed ${target.freshness}, expected ${checkpoint.expectedFreshness}`;
  }
  if (observation === null) return "observation missing";
  return shaFactProblem(observation, target) ?? humanNoteProblem(target);
}

function gateFreshness(
  evaluation: Phase3Evaluation,
  corpusLevel: boolean,
): Phase3GateViolation[] {
  const bad: Array<{ id: string; detail: string }> = [];
  for (const result of evaluation.checkpoints) {
    const { checkpoint, observation } = result;
    if (
      observation &&
      observation.statusFreshness !== checkpoint.expectedFreshness
    ) {
      bad.push({
        id: checkpoint.id,
        detail: `${checkpoint.id}: status row ${String(observation.statusFreshness)}`,
      });
    }
    for (const target of result.targets) {
      const problem = freshnessProblem(checkpoint, observation, target);
      if (problem !== null) {
        bad.push({
          id: checkpoint.id,
          detail: `${checkpoint.id}:${target.golden.target} ${problem}`,
        });
      }
    }
  }
  const violations: Phase3GateViolation[] =
    bad.length === 0
      ? []
      : [
          violation(
            "S1",
            bad.map(({ id }) => id),
            `freshness differs from golden (${bad.map(({ detail }) => detail).join("; ")})`,
          ),
        ];
  const staleObserved = everyTarget(evaluation).filter(
    ({ target }) => target.freshness === PHASE3_FRESHNESS.STALE,
  ).length;
  if (corpusLevel && staleObserved < PHASE3_MIN_STALE_OBSERVATIONS) {
    violations.push(
      violation(
        "S1",
        ["corpus"],
        `freshness gate is vacuous: only ${staleObserved} stale observation(s), need >= ${PHASE3_MIN_STALE_OBSERVATIONS}`,
      ),
    );
  }
  return violations;
}

function gateOracle(evaluation: Phase3Evaluation): Phase3GateViolation[] {
  const bad = everyTarget(evaluation)
    .filter(({ checkpoint }) => checkpoint.oracle === true)
    .filter(
      ({ observation, target }) =>
        observation?.oracle?.[target.golden.target] !==
        normalizeImpactForOracle(target.observation?.run.json ?? null),
    )
    .map(
      ({ checkpoint, target }) => `${checkpoint.id}:${target.golden.target}`,
    );
  return bad.length === 0
    ? []
    : [
        violation(
          "S8",
          bad.map((entry) => entry.split(":")[0]),
          `oracle mismatch against a fresh init of the same tree (${bad.join(", ")})`,
        ),
      ];
}

function normalizedEvidence(
  records: ReadonlyArray<{
    sourceFile: string;
    status: string;
    reason: string;
    candidatePaths: readonly string[];
  }>,
): string {
  return JSON.stringify(
    records
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
      ),
  );
}

/** Golden evidence state after a re-ingest: same records, no stale or missing candidate. */
function evidenceMatchesGolden(target: Phase3TargetResult): boolean {
  return (
    normalizedEvidence(target.evidence.records) ===
      normalizedEvidence(target.golden.expectedEvidence) &&
    !target.evidence.evidenceUnavailable
  );
}

function gatePositiveAndProvenance(
  evaluation: Phase3Evaluation,
  aggregate: ImpactHonestyAggregate,
): Phase3GateViolation[] {
  const violations: Phase3GateViolation[] = [];
  const imperfect = evaluation.records.filter(
    (record) =>
      record.intent === "confirmed-positive" &&
      record.positive !== null &&
      (record.positive.precision !== 1 ||
        record.positive.recall !== 1 ||
        record.positive.f1 !== 1),
  );
  if (imperfect.length > 0) {
    violations.push(
      violation(
        "S10",
        imperfect.map((record) => checkpointOf(record.scenario)),
        `positive case is not perfect (P/R/F1 != 1: ${imperfect
          .map((record) => record.scenario)
          .join(", ")})`,
      ),
    );
  }
  const declared = evaluation.records.reduce(
    (sum, record) => sum + record.expectedPredictions.length,
    0,
  );
  const mismatched = evaluation.records.filter(
    (record) => record.provenance.mismatches > 0,
  );
  if (mismatched.length > 0 || aggregate.provenance.checked < declared) {
    violations.push(
      violation(
        "S10",
        evaluation.records
          .filter(
            (record) =>
              record.provenance.mismatches > 0 ||
              record.provenance.checked < record.expectedPredictions.length,
          )
          .map((record) => checkpointOf(record.scenario)),
        `provenance mismatches ${aggregate.provenance.mismatches}, checked ${aggregate.provenance.checked} of declared ${declared}`,
      ),
    );
  }
  const evidenceMismatch = everyTarget(evaluation).filter(
    ({ checkpoint, target }) =>
      checkpoint.phase === PHASE3_PHASES.AFTER &&
      !target.golden.notFound &&
      target.errorReason === null &&
      !evidenceMatchesGolden(target),
  );
  if (evidenceMismatch.length > 0) {
    violations.push(
      violation(
        "S10",
        evidenceMismatch.map(({ checkpoint }) => checkpoint.id),
        `positive evidence state differs from golden (${evidenceMismatch
          .map(
            ({ checkpoint, target }) =>
              `${checkpoint.id}:${target.golden.target}`,
          )
          .join(", ")})`,
      ),
    );
  }
  if (aggregate.candidate.cases > 0 && aggregate.candidate.coverage !== 1) {
    violations.push(
      violation(
        "S10",
        evaluation.records
          .filter(
            (record) =>
              record.intent === "candidate-boundary" &&
              record.candidate?.coverage !== 1,
          )
          .map((record) => checkpointOf(record.scenario)),
        `positive candidate-boundary coverage ${String(aggregate.candidate.coverage)} is not 1`,
      ),
    );
  }
  return violations;
}

function stdoutByTarget(
  observation: Phase3Observation | null,
): Record<string, string> {
  return Object.fromEntries(
    (observation?.targets ?? []).map((target) => [
      target.target,
      target.run.stdout,
    ]),
  );
}

function accumulationProblem(
  result: Phase3CheckpointResult,
  reference: Phase3CheckpointResult,
): string | null {
  if (!result.observation || !reference.observation) {
    return "observation missing";
  }
  const facts = result.observation.facts;
  const referenceFacts = reference.observation.facts;
  const countsEqual =
    JSON.stringify(facts.counts) === JSON.stringify(referenceFacts.counts);
  if (facts.dangling !== 0 || !countsEqual) {
    return `counts ${JSON.stringify(facts.counts)} dangling ${facts.dangling} vs ${JSON.stringify(referenceFacts.counts)}`;
  }
  const observed = stdoutByTarget(result.observation);
  const expected = stdoutByTarget(reference.observation);
  const differing = Object.keys(observed).filter(
    (target) => observed[target] !== expected[target],
  );
  return differing.length > 0
    ? `stdout differs for ${differing.join(", ")}`
    : null;
}

function gateAccumulation(evaluation: Phase3Evaluation): Phase3GateViolation[] {
  const bad: Array<{ id: string; problem: string }> = [];
  for (const result of evaluation.checkpoints) {
    const reference = lookup(
      evaluation,
      result.checkpoint.accumulationReference,
    );
    if (!reference) continue;
    const problem = accumulationProblem(result, reference);
    if (problem !== null) bad.push({ id: result.checkpoint.id, problem });
  }
  return bad.length === 0
    ? []
    : [
        violation(
          "S11",
          bad.map(({ id }) => id),
          `accumulation across repeated ingestion (${bad
            .map(({ id, problem }) => `${id}: ${problem}`)
            .join("; ")})`,
        ),
      ];
}

function calibrationProblem(
  checkpoint: Phase3Checkpoint,
  target: Phase3TargetResult,
): string | null {
  if (checkpoint.phase === PHASE3_PHASES.AFTER) {
    const allStatic = target.predictions.every(
      (prediction) => prediction.channel === "static",
    );
    return target.freshness === PHASE3_FRESHNESS.FRESH &&
      target.epistemicStatus === "resolved" &&
      allStatic
      ? null
      : "not fresh + exact + static";
  }
  if (checkpoint.phase === PHASE3_PHASES.BEFORE) {
    return target.freshness === PHASE3_FRESHNESS.STALE ? null : "not stale";
  }
  return null;
}

function gateCalibration(
  evaluation: Phase3Evaluation,
  corpusLevel: boolean,
): Phase3GateViolation[] {
  const controls = everyTarget(evaluation).filter(
    ({ target }) => target.golden.target === PHASE3_CALIBRATION_TARGET,
  );
  const phases = new Set(controls.map(({ checkpoint }) => checkpoint.phase));
  if (
    corpusLevel &&
    !(phases.has(PHASE3_PHASES.AFTER) && phases.has(PHASE3_PHASES.BEFORE))
  ) {
    return [
      violation(
        "S13",
        ["corpus"],
        "calibration control not observed both fresh and stale",
      ),
    ];
  }
  const bad = controls
    .map(({ checkpoint, target }) => ({
      id: checkpoint.id,
      problem: calibrationProblem(checkpoint, target),
    }))
    .filter(({ problem }) => problem !== null);
  return bad.length === 0
    ? []
    : [
        violation(
          "S13",
          bad.map(({ id }) => id),
          `calibration control ${PHASE3_CALIBRATION_TARGET} (${bad
            .map(({ id, problem }) => `${id}: ${problem}`)
            .join("; ")})`,
        ),
      ];
}

function gateStatus(evaluation: Phase3Evaluation): Phase3GateViolation[] {
  const badRecords = evaluation.records.filter(
    (record) => !record.statusCorrect,
  );
  const badLevel = everyTarget(evaluation).filter(
    ({ checkpoint, target }) =>
      checkpoint.phase === PHASE3_PHASES.AFTER &&
      target.golden.expectedEpistemic === PHASE3_EPISTEMIC.EXACT &&
      !target.golden.notFound &&
      target.errorReason === null &&
      target.epistemicStatus !== "resolved",
  );
  const details = [
    ...badRecords.map(
      (record) => `${record.scenario}=${record.observedStatus}`,
    ),
    ...badLevel.map(
      ({ checkpoint, target }) =>
        `${checkpoint.id}:${target.golden.target} expected exact, observed ${target.epistemicStatus}`,
    ),
  ];
  return details.length === 0
    ? []
    : [
        violation(
          "S0",
          [
            ...badRecords.map((record) => checkpointOf(record.scenario)),
            ...badLevel.map(({ checkpoint }) => checkpoint.id),
          ],
          `unexpected status (${details.join(", ")})`,
        ),
      ];
}

/**
 * Every Phase 3 gate violation (S12 determinism is `phase3DeterminismViolations`), in the order
 * `assertPhase3ImpactHonestyGates` reports them: the specific honesty gates run before the generic
 * status check, so a poisoned control fails its *named* gate rather than a catch-all.
 */
export function phase3GateViolations(
  evaluation: Phase3Evaluation,
  options: Phase3GateOptions = {},
): Phase3GateViolation[] {
  const corpusLevel = options.corpusLevel ?? true;
  const aggregate = aggregateImpactHonesty(evaluation.records);
  return [
    ...gateErrors(evaluation, aggregate),
    ...gateIngestionFailure(evaluation),
    ...gateFalseSafeAndCertainty(evaluation, aggregate, corpusLevel),
    ...gateIncompleteCertainty(evaluation),
    ...gateStaleEdge(evaluation),
    ...gateStateDiff(evaluation),
    ...gateAccumulation(evaluation),
    ...gateStaleRecord(evaluation),
    ...gateFreshness(evaluation, corpusLevel),
    ...gateOracle(evaluation),
    ...gatePositiveAndProvenance(evaluation, aggregate),
    ...gateCalibration(evaluation, corpusLevel),
    ...gateStatus(evaluation),
  ];
}

export function assertPhase3ImpactHonestyGates(
  evaluation: Phase3Evaluation,
  options: Phase3GateOptions = {},
): ImpactHonestyAggregate {
  const [first] = phase3GateViolations(evaluation, options);
  if (first) throw new Error(first.message);
  return aggregateImpactHonesty(evaluation.records);
}

// ─── S12 determinism (two complete runs) ─────────────────────────────────────────────────────

/** What one complete corpus run contributes to the determinism comparison. */
export interface Phase3RunCapture {
  readonly evaluation: Phase3Evaluation;
  readonly observations: readonly Phase3Observation[];
}

function determinismKey(observation: Phase3Observation): string {
  return JSON.stringify({
    headSha: observation.headSha,
    metaSha: observation.metaSha,
    statusFreshness: observation.statusFreshness,
    stdout: stdoutByTarget(observation),
    human: (observation.targets ?? []).map(
      (target) => target.human?.stdout ?? null,
    ),
    facts: observation.facts,
    operation: observation.operation
      ? {
          exitCode: observation.operation.exitCode,
          events: observation.operation.events,
        }
      : null,
  });
}

export function phase3DeterminismViolations(
  first: Phase3RunCapture,
  second: Phase3RunCapture,
): Phase3GateViolation[] {
  const bad: string[] = [];
  if (
    JSON.stringify(first.evaluation.records) !==
    JSON.stringify(second.evaluation.records)
  ) {
    bad.push("normalized records");
  }
  const secondById = new Map(
    second.observations.map((observation) => [
      observation.checkpointId,
      observation,
    ]),
  );
  for (const observation of first.observations) {
    const other = secondById.get(observation.checkpointId);
    if (!other || determinismKey(observation) !== determinismKey(other)) {
      bad.push(observation.checkpointId);
    }
  }
  if (first.observations.length !== second.observations.length) {
    bad.push("observation count");
  }
  return bad.length === 0
    ? []
    : [violation("S12", bad, "determinism: two clean runs differ")];
}

// ─── Poisoned controls (contract §5) ────────────────────────────────────────────────────────

export type Phase3JsonMutation = (
  json: Record<string, unknown>,
) => Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requireObservation(
  observations: readonly Phase3Observation[],
  checkpointId: string,
): void {
  if (
    !observations.some(
      (observation) => observation.checkpointId === checkpointId,
    )
  ) {
    throw new Error(
      `Phase 3 poison control: no observation for ${checkpointId}`,
    );
  }
}

/** Applies `mutate` to one checkpoint's observation (new objects; inputs untouched). */
export function poisonPhase3Observation(
  observations: readonly Phase3Observation[],
  checkpointId: string,
  mutate: (observation: Phase3Observation) => Phase3Observation,
): Phase3Observation[] {
  requireObservation(observations, checkpointId);
  return observations.map((observation) =>
    observation.checkpointId === checkpointId
      ? mutate(clone(observation))
      : observation,
  );
}

/** Applies `mutate` to one target's raw JSON (and optional entry-file mapping) at a checkpoint. */
export function poisonPhase3Target(
  observations: readonly Phase3Observation[],
  checkpointId: string,
  target: string,
  mutate: Phase3JsonMutation,
  extraEntryFiles: Readonly<Record<string, readonly string[]>> = {},
): Phase3Observation[] {
  return poisonPhase3Observation(observations, checkpointId, (observation) => ({
    ...observation,
    targets: observation.targets.map((candidate) =>
      candidate.target !== target || candidate.run.json === null
        ? candidate
        : {
            ...candidate,
            run: { ...candidate.run, json: mutate(candidate.run.json) },
            entryFiles: { ...candidate.entryFiles, ...extraEntryFiles },
          },
    ),
  }));
}

function withoutKeys(
  json: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(json).filter(([key]) => !keys.includes(key)),
  );
}

/** Q1: a removed dependent survives re-ingest (adds a blast-radius entry named `name`). */
export function poisonAddDependent(name: string): Phase3JsonMutation {
  return (json) => ({
    ...json,
    blastRadius: [...asRecordArray(json.blastRadius), { name, type: "module" }],
  });
}

/** Q2: a stale graph reported fresh and empty — only the target's own file row, `LOW`. */
export function poisonStaleFreshEmpty(ownFile: string): Phase3JsonMutation {
  return (json) => ({
    ...withoutKeys(json, ["epistemic", "riskNote", "graphFreshness"]),
    blastRadius: [{ name: ownFile, type: "module" }],
    riskLevel: "LOW",
  });
}

/** Q3: a failed ingestion scored as a clean, exact, empty answer. */
export const poisonExactEmpty: Phase3JsonMutation = (json) => ({
  ...withoutKeys(json, [
    "epistemic",
    "riskNote",
    "graphFreshness",
    "dynamicEvidence",
  ]),
  blastRadius: [],
  riskLevel: "LOW",
});

/** Q4: a stale non-empty result reported fresh and exact. */
export const poisonStaleReportedFresh: Phase3JsonMutation = (json) =>
  withoutKeys(json, ["epistemic", "riskNote", "graphFreshness"]);

/** Q5 / Q9: drops the blast-radius entry named `name` (Q9 also marks the result lower-bound). */
export function poisonDropDependent(
  name: string,
  markLowerBound = false,
): Phase3JsonMutation {
  return (json) => ({
    ...json,
    blastRadius: asRecordArray(json.blastRadius).filter(
      (entry) => entry.name !== name,
    ),
    ...(markLowerBound
      ? {
          epistemic: PHASE2_JSON.LOWER_BOUND,
          riskNote: "Phase 3 poison Q9: marked lower-bound",
        }
      : {}),
  });
}

/** Q10: a freshness value outside the contract (only `stale` may be emitted). */
export const poisonFreshnessOutOfContract: Phase3JsonMutation = (json) => ({
  ...json,
  graphFreshness: {
    ...((json.graphFreshness as Record<string, unknown> | undefined) ?? {}),
    state: PHASE3_FRESHNESS.FRESH,
  },
});

/** Q6: a phantom `project_files` row plus one dangling link. */
export function poisonPhantomRecord(path: string) {
  return (observation: Phase3Observation): Phase3Observation => ({
    ...observation,
    facts: {
      ...observation.facts,
      dangling: 1,
      projectFilePaths: sortedUnique([
        ...observation.facts.projectFilePaths,
        path,
      ]),
    },
  });
}

/** Q3 (operation half): the failed operation reported as exit 0. */
export function poisonOperationSucceeded(
  observation: Phase3Observation,
): Phase3Observation {
  return {
    ...observation,
    operation: observation.operation
      ? { ...observation.operation, exitCode: 0 }
      : observation.operation,
  };
}

/** Q8: one extra `node_links` row after a repeated ingestion. */
export function poisonAccumulatedLink(
  observation: Phase3Observation,
): Phase3Observation {
  return {
    ...observation,
    facts: {
      ...observation.facts,
      counts: {
        ...observation.facts.counts,
        nodeLinks: observation.facts.counts.nodeLinks + 1,
      },
    },
  };
}

/** Q7: one byte of one target's raw stdout differs between runs. */
export function poisonStdoutByte(target: string) {
  return (observation: Phase3Observation): Phase3Observation => ({
    ...observation,
    targets: observation.targets.map((candidate) =>
      candidate.target === target
        ? {
            ...candidate,
            run: { ...candidate.run, stdout: `${candidate.run.stdout} ` },
          }
        : candidate,
    ),
  });
}

// ─── Registered product defects (contract §8) ─────────────────────────────────────────────────

export interface Phase3KnownDefect {
  readonly defect: string;
  readonly issue: number;
}

/**
 * Checkpoint id -> registered product defect and child issue. A registered checkpoint keeps its
 * golden; the integration test asserts the gates still fail for exactly these checkpoints, so a
 * product fix forces the entry's removal.
 */
export const PHASE3_KNOWN_PRODUCT_DEFECTS: Readonly<
  Record<string, Phase3KnownDefect>
> = {
  "T10@after": { defect: "D10", issue: 522 },
  "T12@after": { defect: "D12", issue: 521 },
};

/** Same semantics as Phase 2's `knownDefectRegistryProblems`, keyed by checkpoint id. */
export function phase3KnownDefectRegistryProblems(
  registry: Readonly<Record<string, Phase3KnownDefect>>,
  checkpoints: readonly Phase3Checkpoint[],
): string[] {
  const ids = new Set(checkpoints.map((checkpoint) => checkpoint.id));
  return Object.entries(registry).flatMap(([id, entry]) => [
    ...(ids.has(id) ? [] : [`${id}: unknown checkpoint`]),
    ...(Number.isInteger(entry.issue) && entry.issue > 0
      ? []
      : [`${id}: ${entry.defect} has no child issue number`]),
  ]);
}

/** Same semantics as Phase 2's `partitionKnownDefects`. */
export function partitionPhase3KnownDefects(
  evaluation: Phase3Evaluation,
  registry: Readonly<Record<string, Phase3KnownDefect>>,
): { gated: Phase3Evaluation; deferred: Phase3Evaluation } {
  return {
    gated: selectPhase3Checkpoints(
      evaluation,
      (id) => registry[id] === undefined,
    ),
    deferred: selectPhase3Checkpoints(
      evaluation,
      (id) => registry[id] !== undefined,
    ),
  };
}

// ─── Reporting ─────────────────────────────────────────────────────────────────────────────────

function short(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "n/a";
}

/** Per-transition evidence table (contract §2.2 capture list); no blended score. */
export function buildPhase3TransitionMarkdown(
  evaluation: Phase3Evaluation,
): string {
  const rows = evaluation.checkpoints.flatMap((result) => {
    const { checkpoint, observation } = result;
    const operation = observation?.operation
      ? `${observation.operation.label} exit ${observation.operation.exitCode}`
      : "-";
    return result.targets.map(
      (target) =>
        `| ${checkpoint.id} | ${short(observation?.headSha)} | ${short(
          observation?.metaSha,
        )} | ${observation?.statusFreshness ?? "n/a"} | ${operation} | ${
          target.golden.target
        } | ${target.freshness} | ${target.epistemicStatus} | ${
          target.confirmedFiles.join(", ") || "-"
        } | ${target.candidateFiles.join(", ") || "-"} |`,
    );
  });
  return [
    "## Impact benchmark honesty — Phase 3 state transitions",
    "",
    "| checkpoint | HEAD | graph | status | operation | target | freshness | epistemic | confirmed | candidates |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
