import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  SYSTEM1_EVAL_BASELINE_IDS,
  SYSTEM1_EVAL_BATCH_SIZE,
  SYSTEM1_EVAL_BATCH_TIMEOUT_MS,
  SYSTEM1_EVAL_CLI_FLAGS,
  SYSTEM1_EVAL_CLI_SEPARATOR,
  SYSTEM1_EVAL_DATASET_DIRECTORY,
  SYSTEM1_EVAL_DEFAULT_BASELINE_VERSION,
  SYSTEM1_EVAL_FILE_NAMES,
  SYSTEM1_EVAL_FINAL_EVALUATION_MODE,
  SYSTEM1_EVAL_IN_PROCESS_COMMAND,
  SYSTEM1_EVAL_JSON_LINE_ENDING,
  SYSTEM1_EVAL_NO_CONFIG_SENTINEL,
  SYSTEM1_EVAL_OUTPUT_DIRECTORY,
  SYSTEM1_EVAL_OUTPUT_DIRECTORY_NAME_PATTERN,
  SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION,
  SYSTEM1_EVAL_REPLAY_DIRECTORY_PREFIX,
  SYSTEM1_EVAL_RUNTIME_KEYS,
  SYSTEM1_EVAL_SCORER_RUNTIME_KEY_PREFIX,
  SYSTEM1_EVAL_RUNTIME_UNAVAILABLE,
  SYSTEM1_EVAL_SCHEMA_VERSION,
  SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_UNKNOWN_SCORE,
  SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_VERIFY_SCORE,
  SYSTEM1_EVAL_SINGLE_RANK0_WITH_CANDIDATE_UNKNOWN_SCORE,
  SYSTEM1_EVAL_BASELINE_RANK_SCORES,
  SYSTEM1_EVAL_BASELINE_UNKNOWN_SCORE,
  SYSTEM1_EVAL_BASELINE_VERIFY_SCORE,
  SYSTEM1_EVAL_SINGLE_RANK0_SCORE,
  SYSTEM1_EVAL_SINGLE_RANK0_OTHER_SCORE,
  SYSTEM1_EVAL_SINGLE_RANK0_UNKNOWN_SCORE,
  SYSTEM1_EVAL_SINGLE_RANK0_VERIFY_SCORE,
  SYSTEM1_EVAL_ALWAYS_VERIFY_SCORE,
  SYSTEM1_EVAL_SLICE_DIMENSIONS,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-constants.js";
import { computeSystem1SplitMetrics } from "../../lib/core/src/semantic/system1/eval/system1-eval-metrics.js";
import { runSystem1ExternalScorerBatch } from "../../lib/core/src/semantic/system1/eval/system1-eval-external-scorer.js";
import { fitSystem1EvaluationPolicy } from "../../lib/core/src/semantic/system1/eval/system1-eval-policy.js";
import { renderSystem1EvalReport } from "../../lib/core/src/semantic/system1/eval/system1-eval-report.js";
import {
  scoreSystem1Baseline,
  validateSystem1ScorerResponse,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-scorer.js";
import type {
  System1EvalExample,
  System1EvaluationPolicy,
  System1ScorerResponse,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-types.js";
import type {
  System1DatasetRecord,
  System1LabelRecord,
  System1Split,
} from "../../lib/core/src/semantic/system1/system1-types.js";
import {
  SYSTEM1_FILE_NAMES,
  SYSTEM1_HELD_OUT_SPLITS,
  SYSTEM1_SPLITS,
} from "../../lib/core/src/semantic/system1/system1-constants.js";
import type { System1EvalSealReference } from "../../lib/core/src/semantic/system1/eval/system1-eval-report.js";

interface ExternalOptions {
  readonly scorerId: string;
  readonly scorerVersion: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly weightsConfigPath: string | null;
  readonly scorerRuntimeVersions: Readonly<Record<string, string>>;
  readonly batchSize: number;
  readonly batchTimeoutMs: number;
}

interface ParsedArguments {
  readonly finalEvaluation: boolean;
  readonly external: ExternalOptions | null;
  readonly selectedBaselineId: string | null;
}

interface ScorerManifest {
  readonly schemaVersion: number;
  readonly scorerId: string;
  readonly version: string;
  readonly weightsConfigSha256: string;
  readonly runtimeVersions: Readonly<Record<string, string>>;
  readonly command: readonly string[];
  readonly execution: {
    readonly batchSize: number;
    readonly batchTimeoutMs: number;
  };
}

interface FrozenPolicy {
  readonly policy: System1EvaluationPolicy;
  readonly policyHash: string;
  readonly policyFilePath: string;
  readonly policyHashFilePath: string;
}

interface LoadedSplit {
  readonly split: System1Split;
  readonly states: readonly System1DatasetRecord[];
  readonly labels: readonly System1LabelRecord[];
  readonly sealedInput: System1EvalSealReference | null;
}

interface SplitReplayMetrics {
  readonly split: System1Split;
  readonly metrics: ReturnType<typeof computeSystem1SplitMetrics>;
  readonly examples: readonly System1EvalExample[];
  readonly responses: readonly System1ScorerResponse[];
}

interface RunResult {
  readonly hashes: Readonly<Record<string, string>>;
  readonly elapsedMs: number;
}

const ROOT_DIRECTORY = process.cwd();
const DATASET_DIRECTORY = path.join(
  ROOT_DIRECTORY,
  SYSTEM1_EVAL_DATASET_DIRECTORY,
);
const OUTPUT_DIRECTORY = path.join(
  ROOT_DIRECTORY,
  SYSTEM1_EVAL_OUTPUT_DIRECTORY,
);
const ALL_SPLITS: readonly System1Split[] = [
  SYSTEM1_SPLITS.TRAIN,
  SYSTEM1_SPLITS.CALIBRATION,
  SYSTEM1_SPLITS.TEMPORAL,
  SYSTEM1_SPLITS.TEST,
];
const CORRECTNESS_FILE_NAMES: readonly string[] = [
  SYSTEM1_EVAL_FILE_NAMES.POLICY,
  SYSTEM1_EVAL_FILE_NAMES.POLICY_HASH,
  SYSTEM1_EVAL_FILE_NAMES.SCORER_MANIFEST,
  SYSTEM1_EVAL_FILE_NAMES.SCORER_MANIFEST_HASH,
  SYSTEM1_EVAL_FILE_NAMES.METRICS,
  SYSTEM1_EVAL_FILE_NAMES.SLICES,
  SYSTEM1_EVAL_FILE_NAMES.REPORT,
  ...ALL_SPLITS.map(SYSTEM1_EVAL_FILE_NAMES.RESPONSES),
];

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}${SYSTEM1_EVAL_JSON_LINE_ENDING}`;
}

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function ensurePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`Invalid positive integer for ${optionName}.`);
  return parsed;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const values = new Map<string, string>();
  let finalEvaluation = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === SYSTEM1_EVAL_CLI_SEPARATOR) continue;
    if (token === SYSTEM1_EVAL_CLI_FLAGS.FINAL_EVALUATION) {
      finalEvaluation = true;
      continue;
    }
    const knownFlags = Object.values(SYSTEM1_EVAL_CLI_FLAGS);
    if (!knownFlags.includes(token as (typeof knownFlags)[number]))
      throw new Error(`Unknown evaluator argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for evaluator argument: ${token}`);
    if (values.has(token))
      throw new Error(`Duplicate evaluator argument: ${token}`);
    values.set(token, value);
    index += 1;
  }

  const selectedBaselineId =
    values.get(SYSTEM1_EVAL_CLI_FLAGS.SCORER_ID) ?? null;
  const command = values.get(SYSTEM1_EVAL_CLI_FLAGS.SCORER_COMMAND);
  if (command === undefined) {
    if (values.has(SYSTEM1_EVAL_CLI_FLAGS.SCORER_VERSION))
      throw new Error("A scorer version requires an external scorer command.");
    if (values.has(SYSTEM1_EVAL_CLI_FLAGS.SCORER_ARGS_JSON))
      throw new Error("Scorer arguments require an external scorer command.");
    if (values.has(SYSTEM1_EVAL_CLI_FLAGS.SCORER_RUNTIME_JSON))
      throw new Error(
        "Scorer runtime versions require an external scorer command.",
      );
    if (values.has(SYSTEM1_EVAL_CLI_FLAGS.WEIGHTS_CONFIG))
      throw new Error(
        "A weights/config file requires an external scorer command.",
      );
    if (values.has(SYSTEM1_EVAL_CLI_FLAGS.BATCH_SIZE))
      throw new Error(
        "Batch size is configurable only for an external scorer.",
      );
    if (values.has(SYSTEM1_EVAL_CLI_FLAGS.BATCH_TIMEOUT_MS))
      throw new Error(
        "Batch timeout is configurable only for an external scorer.",
      );
    if (
      selectedBaselineId !== null &&
      !Object.values(SYSTEM1_EVAL_BASELINE_IDS).includes(
        selectedBaselineId as (typeof SYSTEM1_EVAL_BASELINE_IDS)[keyof typeof SYSTEM1_EVAL_BASELINE_IDS],
      )
    )
      throw new Error(
        `Unknown in-process baseline scorer: ${selectedBaselineId}`,
      );
    return { finalEvaluation, external: null, selectedBaselineId };
  }

  const scorerId = selectedBaselineId;
  const scorerVersion = values.get(SYSTEM1_EVAL_CLI_FLAGS.SCORER_VERSION);
  if (!scorerId || !scorerVersion)
    throw new Error(
      "External scoring requires --scorer-id and --scorer-version.",
    );
  if (!SYSTEM1_EVAL_OUTPUT_DIRECTORY_NAME_PATTERN.test(scorerId))
    throw new Error("Scorer id must be a simple directory name.");
  const argsValue = values.get(SYSTEM1_EVAL_CLI_FLAGS.SCORER_ARGS_JSON);
  let args: readonly string[] = [];
  if (argsValue !== undefined) {
    const parsed: unknown = JSON.parse(argsValue);
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry) => typeof entry !== "string")
    )
      throw new Error("--scorer-args-json must encode an array of strings.");
    args = parsed;
  }
  const runtimeValue = values.get(SYSTEM1_EVAL_CLI_FLAGS.SCORER_RUNTIME_JSON);
  if (!runtimeValue)
    throw new Error("External scoring requires --scorer-runtime-json.");
  const parsedRuntime: unknown = JSON.parse(runtimeValue);
  if (
    parsedRuntime === null ||
    typeof parsedRuntime !== "object" ||
    Array.isArray(parsedRuntime) ||
    Object.keys(parsedRuntime).length === 0 ||
    Object.values(parsedRuntime).some((version) => typeof version !== "string")
  )
    throw new Error(
      "--scorer-runtime-json must be a nonempty object of version strings.",
    );
  const scorerRuntimeVersions = Object.fromEntries(
    Object.entries(parsedRuntime).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  ) as Readonly<Record<string, string>>;
  const batchSize = ensurePositiveInteger(
    values.get(SYSTEM1_EVAL_CLI_FLAGS.BATCH_SIZE) ??
      String(SYSTEM1_EVAL_BATCH_SIZE),
    SYSTEM1_EVAL_CLI_FLAGS.BATCH_SIZE,
  );
  const batchTimeoutMs = ensurePositiveInteger(
    values.get(SYSTEM1_EVAL_CLI_FLAGS.BATCH_TIMEOUT_MS) ??
      String(SYSTEM1_EVAL_BATCH_TIMEOUT_MS),
    SYSTEM1_EVAL_CLI_FLAGS.BATCH_TIMEOUT_MS,
  );
  return {
    finalEvaluation,
    external: {
      scorerId,
      scorerVersion,
      command,
      args,
      weightsConfigPath:
        values.get(SYSTEM1_EVAL_CLI_FLAGS.WEIGHTS_CONFIG) ?? null,
      scorerRuntimeVersions,
      batchSize,
      batchTimeoutMs,
    },
    selectedBaselineId: null,
  };
}

function jsonLines<T>(contents: Buffer, inputName: string): T[] {
  const text = contents.toString("utf8");
  if (text.length === 0) return [];
  const lines = text.split(SYSTEM1_EVAL_JSON_LINE_ENDING);
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.length === 0))
    throw new Error(`Blank JSONL row in ${inputName}.`);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid JSONL row ${index + 1} in ${inputName}: ${detail}`,
      );
    }
  });
}

function assertUniqueRequestIds(
  states: readonly System1DatasetRecord[],
  labels: readonly System1LabelRecord[],
  split: System1Split,
): void {
  const stateIds = states.map(({ request }) => request.requestId);
  const labelIds = labels.map(({ requestId }) => requestId);
  if (new Set(stateIds).size !== stateIds.length)
    throw new Error(`Duplicate state request id in ${split}.`);
  if (new Set(labelIds).size !== labelIds.length)
    throw new Error(`Duplicate label request id in ${split}.`);
  const labelSet = new Set(labelIds);
  if (
    stateIds.length !== labelIds.length ||
    stateIds.some((id) => !labelSet.has(id))
  )
    throw new Error(`State/label request ids do not match in ${split}.`);
}

function readCalibrationFitInput(): LoadedSplit {
  const split = SYSTEM1_SPLITS.CALIBRATION;
  const statePath = path.join(
    DATASET_DIRECTORY,
    SYSTEM1_FILE_NAMES.STATE(SYSTEM1_SPLITS.CALIBRATION),
  );
  const labelsPath = path.join(
    DATASET_DIRECTORY,
    SYSTEM1_FILE_NAMES.LABELS(SYSTEM1_SPLITS.CALIBRATION),
  );
  const states = jsonLines<System1DatasetRecord>(
    readFileSync(statePath),
    statePath,
  );
  const labels = jsonLines<System1LabelRecord>(
    readFileSync(labelsPath),
    labelsPath,
  );
  assertUniqueRequestIds(states, labels, split);
  return { split, states, labels, sealedInput: null };
}

function readTrainingEvaluationInput(): LoadedSplit {
  const split = SYSTEM1_SPLITS.TRAIN;
  const statePath = path.join(
    DATASET_DIRECTORY,
    SYSTEM1_FILE_NAMES.STATE(SYSTEM1_SPLITS.TRAIN),
  );
  const labelsPath = path.join(
    DATASET_DIRECTORY,
    SYSTEM1_FILE_NAMES.LABELS(SYSTEM1_SPLITS.TRAIN),
  );
  const states = jsonLines<System1DatasetRecord>(
    readFileSync(statePath),
    statePath,
  );
  const labels = jsonLines<System1LabelRecord>(
    readFileSync(labelsPath),
    labelsPath,
  );
  assertUniqueRequestIds(states, labels, split);
  return { split, states, labels, sealedInput: null };
}

function countRawJsonLines(contents: Buffer, inputName: string): number {
  const text = contents.toString("utf8");
  if (text.length === 0) return 0;
  const lines = text.split(SYSTEM1_EVAL_JSON_LINE_ENDING);
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.length === 0))
    throw new Error(`Blank JSONL row in sealed input ${inputName}.`);
  return lines.length;
}

function verifyFrozenPolicy(frozenPolicy: FrozenPolicy): void {
  const policyBytes = readFileSync(frozenPolicy.policyFilePath);
  if (sha256(policyBytes) !== frozenPolicy.policyHash)
    throw new Error("Frozen policy hash changed before held-out access.");
  const recordedHash = readFileSync(frozenPolicy.policyHashFilePath, "utf8");
  if (
    recordedHash !==
    `${frozenPolicy.policyHash}${SYSTEM1_EVAL_JSON_LINE_ENDING}`
  )
    throw new Error(
      "Frozen policy hash sidecar changed before held-out access.",
    );
}

function readSealedHeldOutSplit(
  split: (typeof SYSTEM1_HELD_OUT_SPLITS)[number],
  frozenPolicy: FrozenPolicy,
): LoadedSplit {
  verifyFrozenPolicy(frozenPolicy);
  const sealPath = path.join(DATASET_DIRECTORY, SYSTEM1_FILE_NAMES.SEAL(split));
  const sealBytes = readFileSync(sealPath);
  const seal = JSON.parse(sealBytes.toString("utf8")) as {
    readonly schemaVersion: number;
    readonly partition: string;
    readonly stateFile: string;
    readonly labelsFile: string;
    readonly stateSha256: string;
    readonly labelsSha256: string;
    readonly count: number;
  };
  if (
    seal.schemaVersion !== SYSTEM1_EVAL_SCHEMA_VERSION ||
    seal.partition !== split ||
    seal.stateFile !== SYSTEM1_FILE_NAMES.STATE(split) ||
    seal.labelsFile !== SYSTEM1_FILE_NAMES.LABELS(split)
  )
    throw new Error(`Invalid ${split} seal manifest.`);

  const statePath = path.join(DATASET_DIRECTORY, seal.stateFile);
  const labelsPath = path.join(DATASET_DIRECTORY, seal.labelsFile);
  const stateBytes = readFileSync(statePath);
  const labelsBytes = readFileSync(labelsPath);
  if (sha256(stateBytes) !== seal.stateSha256)
    throw new Error(`${split} state file does not match its seal.`);
  if (sha256(labelsBytes) !== seal.labelsSha256)
    throw new Error(`${split} labels file does not match its seal.`);
  const stateCount = countRawJsonLines(stateBytes, statePath);
  const labelsCount = countRawJsonLines(labelsBytes, labelsPath);
  if (stateCount !== seal.count || labelsCount !== seal.count)
    throw new Error(`${split} row count does not match its seal.`);

  const states = jsonLines<System1DatasetRecord>(stateBytes, statePath);
  const labels = jsonLines<System1LabelRecord>(labelsBytes, labelsPath);
  assertUniqueRequestIds(states, labels, split);
  return {
    split,
    states,
    labels,
    sealedInput: {
      sealSha256: sha256(sealBytes),
      stateSha256: seal.stateSha256,
      labelsSha256: seal.labelsSha256,
      recordCount: seal.count,
    },
  };
}

function readTemporalFinalEvaluationInput(
  frozenPolicy: FrozenPolicy,
): LoadedSplit {
  return readSealedHeldOutSplit(SYSTEM1_SPLITS.TEMPORAL, frozenPolicy);
}

function readTestFinalEvaluationInput(frozenPolicy: FrozenPolicy): LoadedSplit {
  return readSealedHeldOutSplit(SYSTEM1_SPLITS.TEST, frozenPolicy);
}

async function scoreStates(
  states: readonly System1DatasetRecord[],
  scorerId: string,
  external: ExternalOptions | null,
  batchSize: number,
): Promise<System1ScorerResponse[]> {
  const responses: System1ScorerResponse[] = [];
  for (let offset = 0; offset < states.length; offset += batchSize) {
    const batch = states.slice(offset, offset + batchSize);
    if (external) {
      responses.push(
        ...(await runSystem1ExternalScorerBatch(batch, {
          command: external.command,
          args: external.args,
          batchTimeoutMs: external.batchTimeoutMs,
          workingDirectory: ROOT_DIRECTORY,
        })),
      );
    } else {
      responses.push(
        ...batch.map((state) => scoreSystem1Baseline(state, scorerId)),
      );
    }
  }
  return responses;
}

function examplesFor(
  split: LoadedSplit,
  responses: readonly System1ScorerResponse[],
): System1EvalExample[] {
  if (responses.length !== split.states.length)
    throw new Error(`Scorer response count does not match ${split.split}.`);
  const labelsById = new Map(
    split.labels.map((label) => [label.requestId, label] as const),
  );
  return split.states.map((state, index) => {
    const labels = labelsById.get(state.request.requestId);
    if (!labels) throw new Error(`No label for ${state.request.requestId}.`);
    const response = validateSystem1ScorerResponse(state, responses[index]);
    return { split: split.split, state, labels, response };
  });
}

function baselineConfigurationHash(scorerId: string): string {
  return sha256(
    stableJson({
      scorerId,
      rankScores: SYSTEM1_EVAL_BASELINE_RANK_SCORES,
      unknownScore: SYSTEM1_EVAL_BASELINE_UNKNOWN_SCORE,
      verifyScore: SYSTEM1_EVAL_BASELINE_VERIFY_SCORE,
      noCandidateUnknownScore: SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_UNKNOWN_SCORE,
      noCandidateVerifyScore: SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_VERIFY_SCORE,
      singleRank0Score: SYSTEM1_EVAL_SINGLE_RANK0_SCORE,
      otherCandidateScore: SYSTEM1_EVAL_SINGLE_RANK0_OTHER_SCORE,
      singleRank0UnknownScore: SYSTEM1_EVAL_SINGLE_RANK0_UNKNOWN_SCORE,
      singleRank0VerifyScore: SYSTEM1_EVAL_SINGLE_RANK0_VERIFY_SCORE,
      singleRank0WithCandidateUnknownScore:
        SYSTEM1_EVAL_SINGLE_RANK0_WITH_CANDIDATE_UNKNOWN_SCORE,
      alwaysVerifyScore: SYSTEM1_EVAL_ALWAYS_VERIFY_SCORE,
    }),
  );
}

function packageManagerVersion(): string {
  try {
    return execFileSync("pnpm", ["--version"], {
      cwd: ROOT_DIRECTORY,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  } catch {
    return SYSTEM1_EVAL_RUNTIME_UNAVAILABLE;
  }
}

function buildScorerManifest(
  scorerId: string,
  external: ExternalOptions | null,
  batchSize: number,
  batchTimeoutMs: number,
): ScorerManifest {
  const weightsConfigSha256 = external?.weightsConfigPath
    ? sha256(
        readFileSync(path.resolve(ROOT_DIRECTORY, external.weightsConfigPath)),
      )
    : external
      ? sha256(SYSTEM1_EVAL_NO_CONFIG_SENTINEL)
      : baselineConfigurationHash(scorerId);
  const command = external
    ? [external.command, ...external.args]
    : [SYSTEM1_EVAL_IN_PROCESS_COMMAND, scorerId];
  const evaluatorRuntimeVersions = {
    [SYSTEM1_EVAL_RUNTIME_KEYS.NODE]: process.versions.node,
    [SYSTEM1_EVAL_RUNTIME_KEYS.V8]: process.versions.v8,
    [SYSTEM1_EVAL_RUNTIME_KEYS.TYPESCRIPT]: ts.version,
    [SYSTEM1_EVAL_RUNTIME_KEYS.PNPM]: packageManagerVersion(),
  };
  const scorerRuntimeVersions = external
    ? Object.fromEntries(
        Object.entries(external.scorerRuntimeVersions).map(
          ([name, version]) => [
            `${SYSTEM1_EVAL_SCORER_RUNTIME_KEY_PREFIX}${name}`,
            version,
          ],
        ),
      )
    : {};
  return {
    schemaVersion: SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION,
    scorerId,
    version: external?.scorerVersion ?? SYSTEM1_EVAL_DEFAULT_BASELINE_VERSION,
    weightsConfigSha256,
    runtimeVersions: { ...evaluatorRuntimeVersions, ...scorerRuntimeVersions },
    command,
    execution: { batchSize, batchTimeoutMs },
  };
}

function writeText(
  directory: string,
  fileName: string,
  contents: string,
): void {
  writeFileSync(path.join(directory, fileName), contents, "utf8");
}

function freezePolicy(
  directory: string,
  policy: System1EvaluationPolicy,
): FrozenPolicy {
  const policyText = stableJson(policy);
  const policyHash = sha256(policyText);
  const policyFilePath = path.join(directory, SYSTEM1_EVAL_FILE_NAMES.POLICY);
  const policyHashFilePath = path.join(
    directory,
    SYSTEM1_EVAL_FILE_NAMES.POLICY_HASH,
  );
  writeFileSync(policyFilePath, policyText, "utf8");
  writeText(
    directory,
    SYSTEM1_EVAL_FILE_NAMES.POLICY_HASH,
    `${policyHash}${SYSTEM1_EVAL_JSON_LINE_ENDING}`,
  );
  const persistedHash = sha256(readFileSync(policyFilePath));
  if (persistedHash !== policyHash)
    throw new Error("Could not persist the frozen policy hash.");
  return { policy, policyHash, policyFilePath, policyHashFilePath };
}

function stripSlices(
  metric: ReturnType<typeof computeSystem1SplitMetrics>,
): Omit<ReturnType<typeof computeSystem1SplitMetrics>, "slices"> {
  const { slices: _slices, ...summary } = metric;
  return summary;
}

function repoFamilyBreakdown(
  metric: ReturnType<typeof computeSystem1SplitMetrics>,
) {
  return {
    split: metric.split,
    families: metric.slices
      .filter(
        (slice) =>
          slice.dimension === SYSTEM1_EVAL_SLICE_DIMENSIONS.REPO_FAMILY,
      )
      .map((slice) => ({
        repoFamily: slice.key,
        sampleCount: slice.sampleCount,
        trustedRequestCount: slice.trustedRequestCount,
        byPrecisionTarget: Object.fromEntries(
          Object.entries(slice.byPrecisionTarget).map(([target, metrics]) => [
            target,
            {
              commitRate: metrics.requestLevel.commitRate,
              exactSetPrecision: metrics.requestLevel.exactSetPrecision,
            },
          ]),
        ),
      })),
  };
}

function responseJsonl(responses: readonly System1ScorerResponse[]): string {
  return responses
    .map((response) => JSON.stringify(response))
    .join(SYSTEM1_EVAL_JSON_LINE_ENDING)
    .concat(responses.length > 0 ? SYSTEM1_EVAL_JSON_LINE_ENDING : "");
}

async function runOneEvaluation(
  directory: string,
  scorerId: string,
  external: ExternalOptions | null,
  manifest: ScorerManifest,
  manifestHash: string,
): Promise<RunResult> {
  mkdirSync(directory, { recursive: true });
  const runStarted = process.hrtime.bigint();
  writeText(
    directory,
    SYSTEM1_EVAL_FILE_NAMES.SCORER_MANIFEST,
    stableJson(manifest),
  );
  writeText(
    directory,
    SYSTEM1_EVAL_FILE_NAMES.SCORER_MANIFEST_HASH,
    `${manifestHash}${SYSTEM1_EVAL_JSON_LINE_ENDING}`,
  );
  const timing: Record<string, number> = {};
  const timeStage = async <T,>(
    stage: string,
    work: () => Promise<T> | T,
  ): Promise<T> => {
    const start = process.hrtime.bigint();
    const result = await work();
    timing[stage] = Number(process.hrtime.bigint() - start) / 1_000_000;
    return result;
  };

  const calibration = await timeStage(
    "readCalibration",
    readCalibrationFitInput,
  );
  const calibrationResponses = await timeStage("scoreCalibration", () =>
    scoreStates(
      calibration.states,
      scorerId,
      external,
      manifest.execution.batchSize,
    ),
  );
  const calibrationExamples = examplesFor(calibration, calibrationResponses);
  const policy = fitSystem1EvaluationPolicy(calibrationExamples, manifestHash);
  const frozenPolicy = freezePolicy(directory, policy);

  if (manifestHash !== policy.scorerManifestHash)
    throw new Error(
      "Policy scorer manifest hash does not match the scorer manifest.",
    );

  const training = await timeStage("readTrain", readTrainingEvaluationInput);
  const temporal = await timeStage("readTemporalAndVerifySeal", () =>
    readTemporalFinalEvaluationInput(frozenPolicy),
  );
  const test = await timeStage("readTestAndVerifySeal", () =>
    readTestFinalEvaluationInput(frozenPolicy),
  );
  const otherSplits = [training, temporal, test] as const;

  const splitData: LoadedSplit[] = [calibration, ...otherSplits];
  const replayed: SplitReplayMetrics[] = [];
  for (const split of splitData) {
    const responses =
      split.split === SYSTEM1_SPLITS.CALIBRATION
        ? calibrationResponses
        : await timeStage(`score:${split.split}`, () =>
            scoreStates(
              split.states,
              scorerId,
              external,
              manifest.execution.batchSize,
            ),
          );
    const examples = examplesFor(split, responses);
    const metrics = computeSystem1SplitMetrics(examples, policy);
    replayed.push({ split: split.split, metrics, examples, responses });
    writeText(
      directory,
      SYSTEM1_EVAL_FILE_NAMES.RESPONSES(split.split),
      responseJsonl(responses),
    );
  }

  const sealedInputs = Object.fromEntries(
    splitData.flatMap((split) =>
      split.sealedInput ? [[split.split, split.sealedInput] as const] : [],
    ),
  );
  const metricsDocument = {
    schemaVersion: SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION,
    mode: SYSTEM1_EVAL_FINAL_EVALUATION_MODE,
    scorerId,
    scorerManifestHash: manifestHash,
    policyHash: frozenPolicy.policyHash,
    sealedInputs,
    splits: replayed.map(({ metrics }) => stripSlices(metrics)),
    repoFamilyBreakdown: replayed.map(({ metrics }) =>
      repoFamilyBreakdown(metrics),
    ),
  };
  const slicesDocument = {
    schemaVersion: SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION,
    mode: SYSTEM1_EVAL_FINAL_EVALUATION_MODE,
    scorerId,
    policyHash: frozenPolicy.policyHash,
    splits: replayed.map(({ metrics }) => ({
      split: metrics.split,
      slices: metrics.slices,
    })),
  };
  const report = renderSystem1EvalReport({
    scorerId,
    policyHash: frozenPolicy.policyHash,
    splitMetrics: replayed.map(({ metrics }) => metrics),
    sealedInputs,
  });

  writeText(
    directory,
    SYSTEM1_EVAL_FILE_NAMES.METRICS,
    stableJson(metricsDocument),
  );
  writeText(
    directory,
    SYSTEM1_EVAL_FILE_NAMES.SLICES,
    stableJson(slicesDocument),
  );
  writeText(directory, SYSTEM1_EVAL_FILE_NAMES.REPORT, report);

  const elapsedMs = Number(process.hrtime.bigint() - runStarted) / 1_000_000;
  writeText(
    directory,
    SYSTEM1_EVAL_FILE_NAMES.TIMING,
    stableJson({ scorerId, stagesMs: timing, elapsedMs }),
  );
  const hashes = Object.fromEntries(
    [...CORRECTNESS_FILE_NAMES]
      .sort()
      .map((name) => [
        name,
        sha256(readFileSync(path.join(directory, name))) as const,
      ]),
  );
  return { hashes, elapsedMs };
}

function sameHashSet(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key],
    )
  );
}

async function evaluateScorer(
  scorerId: string,
  external: ExternalOptions | null,
  batchSize: number,
  batchTimeoutMs: number,
): Promise<void> {
  const manifest = buildScorerManifest(
    scorerId,
    external,
    batchSize,
    batchTimeoutMs,
  );
  const manifestHash = sha256(stableJson(manifest));
  const outputDirectory = path.join(OUTPUT_DIRECTORY, scorerId);
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  const first = await runOneEvaluation(
    outputDirectory,
    scorerId,
    external,
    manifest,
    manifestHash,
  );
  const secondDirectory = mkdtempSync(
    path.join(tmpdir(), SYSTEM1_EVAL_REPLAY_DIRECTORY_PREFIX),
  );
  let second: RunResult;
  try {
    second = await runOneEvaluation(
      secondDirectory,
      scorerId,
      external,
      manifest,
      manifestHash,
    );
  } finally {
    rmSync(secondDirectory, { recursive: true, force: true });
  }
  const byteIdentical = sameHashSet(first.hashes, second.hashes);
  writeText(
    outputDirectory,
    SYSTEM1_EVAL_FILE_NAMES.REPLAY_HASHES,
    stableJson({
      schemaVersion: SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION,
      scorerId,
      correctnessBearingFiles: CORRECTNESS_FILE_NAMES,
      run1: first.hashes,
      run2: second.hashes,
      byteIdentical,
    }),
  );
  writeText(
    outputDirectory,
    SYSTEM1_EVAL_FILE_NAMES.TIMING,
    stableJson({
      scorerId,
      replayDurationsMs: [first.elapsedMs, second.elapsedMs],
    }),
  );
  if (!byteIdentical)
    throw new Error(`Replay outputs differ for scorer ${scorerId}.`);
  process.stdout.write(
    `${stableJson({ scorerId, outputDirectory, policyHash: first.hashes[SYSTEM1_EVAL_FILE_NAMES.POLICY], byteIdentical, fileHashes: first.hashes })}`,
  );
}

async function main(): Promise<void> {
  const argumentsValue = parseArguments(process.argv.slice(2));
  if (!argumentsValue.finalEvaluation)
    throw new Error(
      `Pass ${SYSTEM1_EVAL_CLI_FLAGS.FINAL_EVALUATION} to authorize sealed final evaluation mode.`,
    );
  const batchSize =
    argumentsValue.external?.batchSize ?? SYSTEM1_EVAL_BATCH_SIZE;
  const batchTimeoutMs =
    argumentsValue.external?.batchTimeoutMs ?? SYSTEM1_EVAL_BATCH_TIMEOUT_MS;
  const scorerIds = argumentsValue.external
    ? [argumentsValue.external.scorerId]
    : argumentsValue.selectedBaselineId
      ? [argumentsValue.selectedBaselineId]
      : Object.values(SYSTEM1_EVAL_BASELINE_IDS);
  for (const scorerId of scorerIds) {
    if (!SYSTEM1_EVAL_OUTPUT_DIRECTORY_NAME_PATTERN.test(scorerId))
      throw new Error(`Scorer id is not a safe output directory: ${scorerId}`);
    await evaluateScorer(
      scorerId,
      argumentsValue.external,
      batchSize,
      batchTimeoutMs,
    );
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}${SYSTEM1_EVAL_JSON_LINE_ENDING}`);
  process.exitCode = 1;
});
