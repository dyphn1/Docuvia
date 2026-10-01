import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeSystem1SplitMetrics } from "../../../../lib/core/src/semantic/system1/eval/system1-eval-metrics.js";
import {
  SYSTEM1_EVAL_DEFAULT_MIN_FAMILY_COMMITS,
  SYSTEM1_EVAL_FILE_NAMES,
  SYSTEM1_EVAL_PRECISION_TARGET_KEYS,
  SYSTEM1_EVAL_SCORER_STATUSES,
  SYSTEM1_EVAL_THRESHOLD_STATUSES,
} from "../../../../lib/core/src/semantic/system1/eval/system1-eval-constants.js";
import { buildSystem1RepoFamilyFolds } from "../../../../lib/core/src/semantic/system1/eval/system1-eval-folds.js";
import {
  fitSystem1LeaveOneFamilyOutPolicy,
  system1LabelExclusionReason,
} from "../../../../lib/core/src/semantic/system1/eval/system1-eval-policy.js";
import type {
  System1EvalExample,
  System1EvaluationPolicy,
  System1ScorerResponse,
  System1ScorerTrainingManifest,
} from "../../../../lib/core/src/semantic/system1/eval/system1-eval-types.js";
import type {
  System1DatasetRecord,
  System1LabelRecord,
  System1Split,
} from "../../../../lib/core/src/semantic/system1/system1-types.js";
import {
  SYSTEM1_FILE_NAMES,
  SYSTEM1_SPLITS,
} from "../../../../lib/core/src/semantic/system1/system1-constants.js";

const ROOT = process.cwd();
const P1_DATASET = path.join(
  ROOT,
  "evaluate/results/semantic-corpus/v1/system1-dataset",
);
const P2_OUTPUT = path.join(
  ROOT,
  "evaluate/results/semantic-corpus/v1/system1-eval",
);
const MODEL_ROOT = path.join(
  ROOT,
  "evaluate/results/semantic-corpus/v1/system1-models/cua-s1/domain-adapt-v2",
);
const CUA_SCORER_ID = "cua-s1-encoding-v2";
const ROUTING_REFERENCE_SCORER_ID = "cua-s1-routing-reference-v2";
const TIER_A_SCORER_ID = "tierA-rank-prior";
const SPLITS = [
  SYSTEM1_SPLITS.TRAIN,
  SYSTEM1_SPLITS.CALIBRATION,
] as const satisfies readonly System1Split[];
const POOL_DIAGNOSTICS_FILE = "pool-diagnostics.json";
const DIAGNOSTICS_SCHEMA = "cua-s1-pool-stratified-diagnostics/v1";
const DEFAULT_TARGET_KEY = SYSTEM1_EVAL_PRECISION_TARGET_KEYS[0];
const POOL_EVALUATION_DIRECTORY = "leave-one-family-out";

interface ScorerManifestFile {
  readonly trainingPlan: System1ScorerTrainingManifest;
}

function readJsonLines<T>(filePath: string): readonly T[] {
  const content = readFileSync(filePath, "utf8");
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, index) => {
    if (line.length === 0)
      throw new Error(`Empty row ${index + 1} in ${filePath}`);
    return JSON.parse(line) as T;
  });
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function loadSplitExamples(
  split: (typeof SPLITS)[number],
  scorerId: string,
): readonly System1EvalExample[] {
  const stateRows = readJsonLines<System1DatasetRecord>(
    path.join(P1_DATASET, SYSTEM1_FILE_NAMES.STATE(split)),
  );
  const labelRows = readJsonLines<System1LabelRecord>(
    path.join(P1_DATASET, SYSTEM1_FILE_NAMES.LABELS(split)),
  );
  const responseDirectory = path.join(
    P2_OUTPUT,
    scorerId,
    POOL_EVALUATION_DIRECTORY,
  );
  const responseRows = readJsonLines<System1ScorerResponse>(
    path.join(responseDirectory, SYSTEM1_EVAL_FILE_NAMES.RESPONSES(split)),
  );
  const labelsById = new Map(
    labelRows.map((label) => [label.requestId, label]),
  );
  const responsesById = new Map(
    responseRows.map((response) => [response.requestId, response]),
  );
  if (
    stateRows.length !== labelRows.length ||
    stateRows.length !== responseRows.length
  )
    throw new Error(`Pool row count mismatch for ${split}/${scorerId}`);
  return stateRows.map((state) => {
    const requestId = state.request.requestId;
    const labels = labelsById.get(requestId);
    const response = responsesById.get(requestId);
    if (!labels || !response)
      throw new Error(
        `Pool request ${requestId} is missing labels or scorer response`,
      );
    return { split, state, labels, response };
  });
}

function candidateOptions(example: System1EvalExample) {
  return example.state.request.options.filter(
    (option) => typeof option.attributes?.targetId === "string",
  );
}

function trusted(example: System1EvalExample): boolean {
  return system1LabelExclusionReason(example.labels) === null;
}

function oofTop1Diagnostics(examples: readonly System1EvalExample[]) {
  const eligible = examples.filter(
    (example) =>
      trusted(example) &&
      !example.labels.candidateMiss &&
      example.response.status === SYSTEM1_EVAL_SCORER_STATUSES.OK,
  );
  const tied = eligible.filter((example) => {
    const scores = candidateOptions(example)
      .map((option) => example.response.scores[option.id])
      .filter((score): score is number => typeof score === "number");
    if (scores.length < 2) return false;
    const maximum = Math.max(...scores);
    return scores.filter((score) => score === maximum).length > 1;
  }).length;
  const metrics = computeSystem1SplitMetrics(examples, EMPTY_METRICS_POLICY);
  return {
    eligibleRequestCount: eligible.length,
    top1Accuracy:
      metrics.byPrecisionTarget[DEFAULT_TARGET_KEY].candidateLevel.top1Accuracy,
    topScoreTieRequestCount: tied,
  };
}

const EMPTY_METRICS_POLICY: System1EvaluationPolicy = {
  schemaVersion: 1,
  calibrationMethod: "pool-diagnostic-no-commit-policy",
  scorerManifestHash: "pool-diagnostic-no-commit-policy",
  calibrator: {
    method: "pool-diagnostic-no-calibration",
    fitted: false,
    observationCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    blocks: [],
  },
  precisionTargets: SYSTEM1_EVAL_PRECISION_TARGET_KEYS.map((target) => ({
    targetPrecision: Number(target),
    status: SYSTEM1_EVAL_THRESHOLD_STATUSES.UNCERTIFIABLE,
    threshold: null,
    calibrationCommitCount: 0,
    calibrationExactSetCount: 0,
    lowerBound: null,
  })),
};

function targetSummary(
  examples: readonly System1EvalExample[],
  policy: System1EvaluationPolicy,
) {
  const metrics = computeSystem1SplitMetrics(examples, policy);
  const target = metrics.byPrecisionTarget[DEFAULT_TARGET_KEY];
  const candidateCountOne = examples.filter(
    ({ state }) => state.candidateCount === 1,
  );
  const candidateCountMany = examples.filter(
    ({ state }) => state.candidateCount > 1,
  );
  const singleMetrics = computeSystem1SplitMetrics(candidateCountOne, policy)
    .byPrecisionTarget[DEFAULT_TARGET_KEY];
  const multiMetrics = computeSystem1SplitMetrics(candidateCountMany, policy)
    .byPrecisionTarget[DEFAULT_TARGET_KEY];
  const possibleSingleCandidateGoldCommits = candidateCountOne.filter(
    (example) => {
      if (!trusted(example) || example.labels.candidateMiss) return false;
      const candidate = candidateOptions(example)[0];
      const targetId = candidate?.attributes?.targetId;
      return (
        typeof targetId === "string" &&
        example.labels.positiveTargetIds.includes(targetId)
      );
    },
  ).length;
  return {
    certification: target.certification,
    singleCandidate: {
      sampleCount: candidateCountOne.length,
      possibleGoldCommitCount: possibleSingleCandidateGoldCommits,
      commitRate: singleMetrics.requestLevel.commitRate,
      exactSetPrecision: singleMetrics.requestLevel.exactSetPrecision,
      falseSafeAmongCommits: singleMetrics.requestLevel.falseSafeAmongCommits,
    },
    multiCandidate: {
      sampleCount: candidateCountMany.length,
      eligibleTop1: multiMetrics.candidateLevel.top1Accuracy,
      commitRate: multiMetrics.requestLevel.commitRate,
      exactSetPrecision: multiMetrics.requestLevel.exactSetPrecision,
      falseSafeAmongCommits: multiMetrics.requestLevel.falseSafeAmongCommits,
    },
  };
}

function multiCandidateCertification(
  examples: readonly System1EvalExample[],
  scorerManifestHash: string,
  trainingPlan: System1ScorerTrainingManifest,
) {
  const multiExamples = examples.filter(
    ({ state }) => state.candidateCount > 1,
  );
  const repoIds = [
    ...new Set(examples.map(({ state }) => state.request.evidence.repoId)),
  ].sort();
  const folds = buildSystem1RepoFamilyFolds(repoIds);
  const policy = fitSystem1LeaveOneFamilyOutPolicy(
    multiExamples,
    scorerManifestHash,
    folds,
    SYSTEM1_EVAL_DEFAULT_MIN_FAMILY_COMMITS,
    trainingPlan,
  );
  return policy.precisionTargets.map((target) => ({
    targetPrecision: target.targetPrecision,
    status: target.status,
    threshold: target.threshold,
    lowerBound: target.lowerBound,
    oofFamilyTable: target.oofFamilyTable,
  }));
}

function scorerDiagnostics(scorerId: string) {
  const examples = SPLITS.flatMap((split) =>
    loadSplitExamples(split, scorerId),
  );
  const evaluationDirectory = path.join(
    P2_OUTPUT,
    scorerId,
    POOL_EVALUATION_DIRECTORY,
  );
  const policy = readJson<System1EvaluationPolicy>(
    path.join(evaluationDirectory, SYSTEM1_EVAL_FILE_NAMES.POLICY),
  );
  const manifest = readJson<ScorerManifestFile>(
    path.join(evaluationDirectory, SYSTEM1_EVAL_FILE_NAMES.SCORER_MANIFEST),
  );
  return {
    poolRequestCount: examples.length,
    trustedRequestCount: examples.filter(trusted).length,
    multiCandidateOofTop1: oofTop1Diagnostics(
      examples.filter(({ state }) => state.candidateCount > 1),
    ),
    globalThresholdStrata: targetSummary(examples, policy),
    multiCandidateOnlyCertification: multiCandidateCertification(
      examples,
      policy.scorerManifestHash,
      manifest.trainingPlan,
    ),
  };
}

function main(): void {
  const baseline = scorerDiagnostics(TIER_A_SCORER_ID);
  const cua = scorerDiagnostics(CUA_SCORER_ID);
  const routingReference = scorerDiagnostics(ROUTING_REFERENCE_SCORER_ID);
  const report = {
    schema: DIAGNOSTICS_SCHEMA,
    inputSplits: SPLITS,
    fitAndDiagnosticRowsArePoolOnly: true,
    targetPrecision: Number(DEFAULT_TARGET_KEY),
    minimumFamilyCommits: SYSTEM1_EVAL_DEFAULT_MIN_FAMILY_COMMITS,
    scorers: {
      [TIER_A_SCORER_ID]: baseline,
      [CUA_SCORER_ID]: cua,
      [ROUTING_REFERENCE_SCORER_ID]: routingReference,
    },
  };
  writeFileSync(
    path.join(MODEL_ROOT, POOL_DIAGNOSTICS_FILE),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main();
