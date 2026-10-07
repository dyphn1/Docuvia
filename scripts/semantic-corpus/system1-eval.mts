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
  SYSTEM1_EVAL_CERTIFICATION_MODES,
  SYSTEM1_EVAL_CLI_FLAGS,
  SYSTEM1_EVAL_CLI_SEPARATOR,
  SYSTEM1_EVAL_DATASET_DIRECTORY,
  SYSTEM1_EVAL_DEFAULT_BASELINE_VERSION,
  SYSTEM1_EVAL_FILE_NAMES,
  SYSTEM1_EVAL_FINAL_EVALUATION_MODE,
  SYSTEM1_EVAL_ACTIONS,
  SYSTEM1_EVAL_IN_PROCESS_COMMAND,
  SYSTEM1_EVAL_JSON_LINE_ENDING,
  SYSTEM1_EVAL_NO_CONFIG_SENTINEL,
  SYSTEM1_EVAL_OUTPUT_DIRECTORY_NAME_PATTERN,
  SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION,
  SYSTEM1_EVAL_PROTOCOL_VERSION,
  SYSTEM1_EVAL_CORPUS_MANIFEST_RELATIVE_PATH,
  SYSTEM1_EVAL_CORPUS_MANIFEST_ERRORS,
  SYSTEM1_EVAL_PRECISION_TARGETS,
  SYSTEM1_EVAL_PRECISION_TARGET_KEYS,
  SYSTEM1_EVAL_REPLAY_DIRECTORY_PREFIX,
  SYSTEM1_EVAL_RUNTIME_KEYS,
  SYSTEM1_EVAL_SCORER_RUNTIME_KEY_PREFIX,
  SYSTEM1_EVAL_RUNTIME_UNAVAILABLE,
  SYSTEM1_EVAL_SCORER_STATUSES,
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
  SYSTEM1_EVAL_TRAINING_MODES,
  SYSTEM1_EVAL_DEFAULT_MIN_FAMILY_COMMITS,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-constants.js";
import { system1EvalOutputDirectory } from "../../lib/core/src/semantic/system1/eval/system1-eval-output.js";
import {
  computeSystem1SplitMetrics,
  system1CalibratorForExample,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-metrics.js";
import { computeSystem1AccountingFunnel } from "../../lib/core/src/semantic/system1/eval/system1-eval-funnel.js";
import type { System1AccountingSample } from "../../lib/core/src/semantic/system1/eval/system1-eval-funnel.js";
import { assertSystem1CorpusManifestPin } from "../../lib/core/src/semantic/system1/eval/system1-eval-corpus-manifest.js";
import { runSystem1ExternalScorerBatch } from "../../lib/core/src/semantic/system1/eval/system1-eval-external-scorer.js";
import {
  decideSystem1Request,
  fitSystem1EvaluationPolicy,
  fitSystem1LeaveOneFamilyOutPolicy,
  system1LabelExclusionReason,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-policy.js";
import {
  buildSystem1RepoFamilyFolds,
  createSystem1ScorerTrainingManifest,
  system1RepoFamily,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-folds.js";
import { renderSystem1EvalReport } from "../../lib/core/src/semantic/system1/eval/system1-eval-report.js";
import { isSupportedSystem1DatasetSealSchemaVersion } from "../../lib/core/src/semantic/system1/eval/system1-eval-seals.js";
import {
  scoreSystem1Baseline,
  validateSystem1ScorerResponse,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-scorer.js";
import type {
  System1EvalExample,
  System1EvaluationPolicy,
  System1CorpusManifestReference,
  System1ScorerResponse,
  System1EvalCertificationMode,
  System1ScorerTrainingManifest,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-types.js";
import type {
  System1DatasetRecord,
  System1LabelRecord,
  System1Split,
} from "../../lib/core/src/semantic/system1/system1-types.js";
import { system1RequestId } from "../../lib/core/src/semantic/system1/system1-state-builder.js";
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
  readonly scorerTrainingManifest: System1ScorerTrainingManifest;
}

interface ParsedArguments {
  readonly finalEvaluation: boolean;
  readonly external: ExternalOptions | null;
  readonly selectedBaselineId: string | null;
  readonly certificationMode: System1EvalCertificationMode;
  readonly datasetDirectory: string;
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
  readonly trainingPlan: System1ScorerTrainingManifest;
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

interface CorpusSourceMetadata {
  readonly sampleId: string;
  readonly requestId: string;
  readonly split: System1Split;
  readonly duplicateGroup: string;
}

interface CorpusSourceMetadataRead {
  readonly manifest: System1CorpusManifestReference;
  readonly records: CorpusSourceMetadata[];
}

interface ExportExclusionRecord {
  readonly sampleId: string;
  readonly requestId: string;
  readonly split: System1Split;
  readonly reason: string;
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
const ALL_SPLITS: readonly System1Split[] = [
  SYSTEM1_SPLITS.TRAIN,
  SYSTEM1_SPLITS.CALIBRATION,
  SYSTEM1_SPLITS.TEMPORAL,
  SYSTEM1_SPLITS.TEST,
];
const CORRECTNESS_FILE_NAMES: readonly string[] = [
  SYSTEM1_EVAL_FILE_NAMES.POLICY,
  SYSTEM1_EVAL_FILE_NAMES.POLICY_HASH,
  SYSTEM1_EVAL_FILE_NAMES.COMPARISON_POLICY,
  SYSTEM1_EVAL_FILE_NAMES.COMPARISON_POLICY_HASH,
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

function parseScorerTrainingManifest(
  value: string,
): System1ScorerTrainingManifest {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Scorer training manifest must be a JSON object.");
  const record = parsed as Record<string, unknown>;
  if (record.mode === SYSTEM1_EVAL_TRAINING_MODES.NO_TRAINING)
    return {
      mode: SYSTEM1_EVAL_TRAINING_MODES.NO_TRAINING,
      foldTrainingFamilies: {},
      heldOutTrainingFamilies: [],
    };
  if (record.mode !== SYSTEM1_EVAL_TRAINING_MODES.FOLDED)
    throw new Error(
      "Scorer training manifest mode must be folded or no-training.",
    );
  const folds = record.foldTrainingFamilies;
  const heldOut = record.heldOutTrainingFamilies;
  if (
    folds === null ||
    typeof folds !== "object" ||
    Array.isArray(folds) ||
    Object.values(folds).some(
      (families) =>
        !Array.isArray(families) ||
        families.some((family) => typeof family !== "string"),
    ) ||
    !Array.isArray(heldOut) ||
    heldOut.some((family) => typeof family !== "string")
  )
    throw new Error(
      "Folded scorer declaration requires family arrays per fold and held-out training.",
    );
  return {
    mode: SYSTEM1_EVAL_TRAINING_MODES.FOLDED,
    foldTrainingFamilies: Object.fromEntries(
      Object.entries(folds as Record<string, string[]>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ),
    heldOutTrainingFamilies: [...(heldOut as string[])].sort(),
  };
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

  const requestedMode =
    values.get(SYSTEM1_EVAL_CLI_FLAGS.CERTIFICATION_MODE) ??
    SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT;
  if (
    requestedMode !== SYSTEM1_EVAL_CERTIFICATION_MODES.CALIBRATION_ONLY &&
    requestedMode !== SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT
  )
    throw new Error("Unknown certification mode.");
  const certificationMode = requestedMode as System1EvalCertificationMode;
  const datasetDirectory = path.resolve(
    ROOT_DIRECTORY,
    values.get(SYSTEM1_EVAL_CLI_FLAGS.DATASET_DIRECTORY) ??
      SYSTEM1_EVAL_DATASET_DIRECTORY,
  );

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
    if (values.has(SYSTEM1_EVAL_CLI_FLAGS.SCORER_TRAINING_MANIFEST_JSON))
      throw new Error(
        "A scorer training manifest requires an external scorer command.",
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
    return {
      finalEvaluation,
      external: null,
      selectedBaselineId,
      certificationMode,
      datasetDirectory,
    };
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
  const trainingValue = values.get(
    SYSTEM1_EVAL_CLI_FLAGS.SCORER_TRAINING_MANIFEST_JSON,
  );
  if (!trainingValue)
    throw new Error(
      "External scorers require --scorer-training-manifest-json.",
    );
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
      scorerTrainingManifest: parseScorerTrainingManifest(trainingValue),
    },
    selectedBaselineId: null,
    certificationMode,
    datasetDirectory,
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

interface JsonRange {
  readonly start: number;
  readonly end: number;
}

function skipJsonWhitespace(contents: string, start: number): number {
  let index = start;
  while (/\s/.test(contents[index] ?? "")) index += 1;
  return index;
}

function jsonValueEnd(contents: string, start: number): number {
  const initial = contents[start];
  if (initial === '"') {
    let escaped = false;
    for (let index = start + 1; index < contents.length; index += 1) {
      if (escaped) escaped = false;
      else if (contents[index] === "\\") escaped = true;
      else if (contents[index] === '"') return index + 1;
    }
    throw new Error("Unterminated JSON string in corpus manifest.");
  }
  if (initial !== "{" && initial !== "[") {
    let index = start;
    while (index < contents.length && !/[\s,}\]]/.test(contents[index]))
      index += 1;
    return index;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < contents.length; index += 1) {
    const character = contents[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error("Unterminated JSON value in corpus manifest.");
}

function objectFieldRanges(
  contents: string,
  objectStart: number,
): ReadonlyMap<string, JsonRange> {
  const end = jsonValueEnd(contents, objectStart);
  if (contents[objectStart] !== "{")
    throw new Error("Corpus manifest value should be an object.");
  const fields = new Map<string, JsonRange>();
  let cursor = skipJsonWhitespace(contents, objectStart + 1);
  while (cursor < end && contents[cursor] !== "}") {
    const keyEnd = jsonValueEnd(contents, cursor);
    const key = JSON.parse(contents.slice(cursor, keyEnd)) as string;
    cursor = skipJsonWhitespace(contents, keyEnd);
    if (contents[cursor] !== ":")
      throw new Error("Malformed corpus manifest object property.");
    const valueStart = skipJsonWhitespace(contents, cursor + 1);
    const valueEnd = jsonValueEnd(contents, valueStart);
    fields.set(key, { start: valueStart, end: valueEnd });
    cursor = skipJsonWhitespace(contents, valueEnd);
    if (contents[cursor] === ",")
      cursor = skipJsonWhitespace(contents, cursor + 1);
    else if (contents[cursor] !== "}")
      throw new Error("Malformed corpus manifest object delimiter.");
  }
  return fields;
}

function readCorpusSourceMetadata(
  datasetDirectory: string,
  includedSplits: ReadonlySet<System1Split>,
  expectedManifest?: System1CorpusManifestReference,
): CorpusSourceMetadataRead {
  const manifestPath = path.resolve(
    datasetDirectory,
    SYSTEM1_EVAL_CORPUS_MANIFEST_RELATIVE_PATH,
  );
  const manifestBytes = readFileSync(manifestPath);
  const manifest = {
    path: SYSTEM1_EVAL_CORPUS_MANIFEST_RELATIVE_PATH,
    sha256: sha256(manifestBytes),
  };
  if (expectedManifest)
    assertSystem1CorpusManifestPin(expectedManifest, manifest);
  const contents = manifestBytes.toString("utf8");
  const rootFields = objectFieldRanges(
    contents,
    skipJsonWhitespace(contents, 0),
  );
  const samplesRange = rootFields.get("samples");
  if (!samplesRange || contents[samplesRange.start] !== "[")
    throw new Error("Corpus manifest has no samples array.");
  const metadata: CorpusSourceMetadata[] = [];
  let cursor = skipJsonWhitespace(contents, samplesRange.start + 1);
  while (cursor < samplesRange.end && contents[cursor] !== "]") {
    const sampleEnd = jsonValueEnd(contents, cursor);
    const sampleFields = objectFieldRanges(contents, cursor);
    const sampleIdRange = sampleFields.get("sampleId");
    const sourceRange = sampleFields.get("source");
    if (!sampleIdRange || !sourceRange)
      throw new Error("Corpus sample is missing identity or source metadata.");
    const sampleId = JSON.parse(
      contents.slice(sampleIdRange.start, sampleIdRange.end),
    ) as string;
    const sourceFields = objectFieldRanges(contents, sourceRange.start);
    const splitRange = sourceFields.get("split");
    if (!splitRange)
      throw new Error(
        "Corpus source metadata has no split for " + sampleId + ".",
      );
    const split = JSON.parse(
      contents.slice(splitRange.start, splitRange.end),
    ) as unknown;
    if (!Object.values(SYSTEM1_SPLITS).includes(split as System1Split))
      throw new Error("Invalid corpus split for " + sampleId + ".");
    if (!includedSplits.has(split as System1Split)) {
      cursor = skipJsonWhitespace(contents, sampleEnd);
      if (contents[cursor] === ",")
        cursor = skipJsonWhitespace(contents, cursor + 1);
      else if (contents[cursor] !== "]")
        throw new Error("Malformed corpus manifest samples array.");
      continue;
    }
    const duplicateGroupRange = sourceFields.get("duplicateGroup");
    if (!duplicateGroupRange)
      throw new Error(
        "Corpus source metadata has no duplicate group for " + sampleId + ".",
      );
    const duplicateGroup = JSON.parse(
      contents.slice(duplicateGroupRange.start, duplicateGroupRange.end),
    ) as unknown;
    if (typeof duplicateGroup !== "string" || duplicateGroup.length === 0)
      throw new Error(
        "Invalid C-06 duplicate-group metadata for " + sampleId + ".",
      );
    metadata.push({
      sampleId,
      requestId: system1RequestId(sampleId),
      split: split as System1Split,
      duplicateGroup,
    });
    cursor = skipJsonWhitespace(contents, sampleEnd);
    if (contents[cursor] === ",")
      cursor = skipJsonWhitespace(contents, cursor + 1);
    else if (contents[cursor] !== "]")
      throw new Error("Malformed corpus manifest samples array.");
  }
  return { manifest, records: metadata };
}

function readExportExclusions(
  datasetDirectory: string,
): ExportExclusionRecord[] {
  const exclusionPath = path.join(
    datasetDirectory,
    SYSTEM1_FILE_NAMES.EXCLUDED,
  );
  return jsonLines<ExportExclusionRecord>(
    readFileSync(exclusionPath),
    exclusionPath,
  );
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

function readCalibrationFitInput(datasetDirectory: string): LoadedSplit {
  const split = SYSTEM1_SPLITS.CALIBRATION;
  const statePath = path.join(
    datasetDirectory,
    SYSTEM1_FILE_NAMES.STATE(SYSTEM1_SPLITS.CALIBRATION),
  );
  const labelsPath = path.join(
    datasetDirectory,
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

function readTrainingEvaluationInput(datasetDirectory: string): LoadedSplit {
  const split = SYSTEM1_SPLITS.TRAIN;
  const statePath = path.join(
    datasetDirectory,
    SYSTEM1_FILE_NAMES.STATE(SYSTEM1_SPLITS.TRAIN),
  );
  const labelsPath = path.join(
    datasetDirectory,
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
  datasetDirectory: string,
): LoadedSplit {
  verifyFrozenPolicy(frozenPolicy);
  const sealPath = path.join(datasetDirectory, SYSTEM1_FILE_NAMES.SEAL(split));
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
    !isSupportedSystem1DatasetSealSchemaVersion(seal.schemaVersion) ||
    seal.partition !== split ||
    seal.stateFile !== SYSTEM1_FILE_NAMES.STATE(split) ||
    seal.labelsFile !== SYSTEM1_FILE_NAMES.LABELS(split)
  )
    throw new Error(`Invalid ${split} seal manifest.`);

  const statePath = path.join(datasetDirectory, seal.stateFile);
  const labelsPath = path.join(datasetDirectory, seal.labelsFile);
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
  datasetDirectory: string,
): LoadedSplit {
  return readSealedHeldOutSplit(
    SYSTEM1_SPLITS.TEMPORAL,
    frozenPolicy,
    datasetDirectory,
  );
}

function readTestFinalEvaluationInput(
  frozenPolicy: FrozenPolicy,
  datasetDirectory: string,
): LoadedSplit {
  return readSealedHeldOutSplit(
    SYSTEM1_SPLITS.TEST,
    frozenPolicy,
    datasetDirectory,
  );
}

async function scoreStates(
  states: readonly System1DatasetRecord[],
  scorerId: string,
  external: ExternalOptions | null,
  batchSize: number,
  includeOOFFold = false,
): Promise<System1ScorerResponse[]> {
  const responses: System1ScorerResponse[] = [];
  for (let offset = 0; offset < states.length; offset += batchSize) {
    const batch = states.slice(offset, offset + batchSize);
    if (external) {
      const batchResponses = await runSystem1ExternalScorerBatch(batch, {
        command: external.command,
        args: external.args,
        batchTimeoutMs: external.batchTimeoutMs,
        workingDirectory: ROOT_DIRECTORY,
        containmentRoot: ROOT_DIRECTORY,
      });
      responses.push(
        ...batchResponses.map((response, index) =>
          includeOOFFold &&
          response.status !== SYSTEM1_EVAL_SCORER_STATUSES.OK &&
          response.foldFamily === undefined
            ? { ...response, foldFamily: system1RepoFamily(batch[index]) }
            : response,
        ),
      );
    } else {
      responses.push(
        ...batch.map((state) => {
          const response = scoreSystem1Baseline(state, scorerId);
          return includeOOFFold
            ? { ...response, foldFamily: system1RepoFamily(state) }
            : response;
        }),
      );
    }
  }
  return responses;
}

function examplesFor(
  split: LoadedSplit,
  responses: readonly System1ScorerResponse[],
  sourceMetadataByRequestId: ReadonlyMap<string, CorpusSourceMetadata>,
): System1EvalExample[] {
  if (responses.length !== split.states.length)
    throw new Error(`Scorer response count does not match ${split.split}.`);
  const labelsById = new Map(
    split.labels.map((label) => [label.requestId, label] as const),
  );
  return split.states.map((state, index) => {
    const labels = labelsById.get(state.request.requestId);
    if (!labels) throw new Error(`No label for ${state.request.requestId}.`);
    const sourceMetadata = sourceMetadataByRequestId.get(
      state.request.requestId,
    );
    if (!sourceMetadata || sourceMetadata.split !== split.split)
      throw new Error(
        "No C-06 group metadata for " + state.request.requestId + ".",
      );
    const response = validateSystem1ScorerResponse(state, responses[index]);
    return {
      split: split.split,
      state,
      labels,
      duplicateGroup: sourceMetadata.duplicateGroup,
      response,
    };
  });
}

function accountingFunnelForSplit(
  split: System1Split,
  examples: readonly System1EvalExample[],
  sourceMetadata: readonly CorpusSourceMetadata[],
  exclusions: readonly ExportExclusionRecord[],
  policy: System1EvaluationPolicy,
  targetPrecision: number,
): ReturnType<typeof computeSystem1AccountingFunnel> {
  const examplesById = new Map(
    examples.map(
      (example) => [example.state.request.requestId, example] as const,
    ),
  );
  const exclusionsById = new Map(
    exclusions
      .filter((record) => record.split === split)
      .map((record) => [record.requestId, record] as const),
  );
  const samples: System1AccountingSample[] = sourceMetadata
    .filter((metadata) => metadata.split === split)
    .map((metadata) => {
      const exclusion = exclusionsById.get(metadata.requestId);
      const example = examplesById.get(metadata.requestId);
      if (exclusion) {
        if (example || exclusion.sampleId !== metadata.sampleId)
          throw new Error(
            "Export exclusion disagrees with the C-06 source index.",
          );
        return {
          duplicateGroup: metadata.duplicateGroup,
          exportExclusionReason: exclusion.reason,
          labelExclusionReason: null,
          hasCandidates: false,
          candidateMiss: false,
          committed: false,
          exact: false,
        };
      }
      if (!example)
        throw new Error("Corpus sample is neither exported nor excluded.");
      const labelExclusionReason = system1LabelExclusionReason(example.labels);
      if (labelExclusionReason !== null) {
        return {
          duplicateGroup: metadata.duplicateGroup,
          exportExclusionReason: null,
          labelExclusionReason,
          hasCandidates: example.state.candidateCount > 0,
          candidateMiss: example.labels.candidateMiss,
          committed: false,
          exact: false,
        };
      }
      const decision = decideSystem1Request(
        example.state,
        example.response,
        {
          ...policy,
          calibrator: system1CalibratorForExample(example, policy),
        },
        targetPrecision,
      );
      const accepted = new Set(decision.acceptedTargetIds);
      const gold = new Set(example.labels.positiveTargetIds);
      const exact =
        accepted.size === gold.size &&
        [...accepted].every((target) => gold.has(target));
      return {
        duplicateGroup: metadata.duplicateGroup,
        exportExclusionReason: null,
        labelExclusionReason: null,
        hasCandidates: example.state.candidateCount > 0,
        candidateMiss: example.labels.candidateMiss,
        committed: decision.action === SYSTEM1_EVAL_ACTIONS.COMMIT,
        exact,
      };
    });
  if (
    samples.length !==
    sourceMetadata.filter(({ split: itemSplit }) => itemSplit === split).length
  )
    throw new Error(
      "Accounting source metadata contains duplicate request ids.",
    );
  return computeSystem1AccountingFunnel(split, samples);
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
  folds: ReturnType<typeof buildSystem1RepoFamilyFolds>,
  families: readonly string[],
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
  const trainingPlan =
    !external ||
    external.scorerTrainingManifest.mode ===
      SYSTEM1_EVAL_TRAINING_MODES.NO_TRAINING
      ? createSystem1ScorerTrainingManifest(
          SYSTEM1_EVAL_TRAINING_MODES.NO_TRAINING,
          folds,
          families,
        )
      : external.scorerTrainingManifest;
  assertTrainingPlanMatchesFolds(trainingPlan, folds, families);
  return {
    schemaVersion: SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION,
    scorerId,
    version: external?.scorerVersion ?? SYSTEM1_EVAL_DEFAULT_BASELINE_VERSION,
    weightsConfigSha256,
    runtimeVersions: { ...evaluatorRuntimeVersions, ...scorerRuntimeVersions },
    command,
    execution: { batchSize, batchTimeoutMs },
    trainingPlan,
  };
}

function assertTrainingPlanMatchesFolds(
  trainingPlan: System1ScorerTrainingManifest,
  folds: ReturnType<typeof buildSystem1RepoFamilyFolds>,
  families: readonly string[],
): void {
  if (trainingPlan.mode === SYSTEM1_EVAL_TRAINING_MODES.NO_TRAINING) return;
  const expectedFoldNames = folds.map(({ foldFamily }) => foldFamily).sort();
  const declaredFoldNames = Object.keys(
    trainingPlan.foldTrainingFamilies,
  ).sort();
  if (
    expectedFoldNames.length !== declaredFoldNames.length ||
    expectedFoldNames.some((name, index) => name !== declaredFoldNames[index])
  )
    throw new Error(
      "Scorer manifest must declare every OOF fold exactly once.",
    );
  for (const fold of folds) {
    const declared = trainingPlan.foldTrainingFamilies[fold.foldFamily];
    const expected = [...fold.trainingFamilies].sort();
    if (
      !declared ||
      declared.length !== expected.length ||
      [...declared]
        .sort()
        .some((family, index) => family !== expected[index]) ||
      declared.includes(fold.foldFamily)
    )
      throw new Error(
        `Scorer fold training set is invalid for ${fold.foldFamily}.`,
      );
  }
  const expectedHeldOut = [...families].sort();
  if (
    trainingPlan.heldOutTrainingFamilies.length !== expectedHeldOut.length ||
    [...trainingPlan.heldOutTrainingFamilies]
      .sort()
      .some((family, index) => family !== expectedHeldOut[index])
  )
    throw new Error(
      "Held-out scorer must declare training on all pool families.",
    );
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
  policyName: string = SYSTEM1_EVAL_FILE_NAMES.POLICY,
  hashName: string = SYSTEM1_EVAL_FILE_NAMES.POLICY_HASH,
): FrozenPolicy {
  const policyText = stableJson(policy);
  const policyHash = sha256(policyText);
  const policyFilePath = path.join(directory, policyName);
  const policyHashFilePath = path.join(directory, hashName);
  writeFileSync(policyFilePath, policyText, "utf8");
  writeText(
    directory,
    hashName,
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
              independentGroupCommitRate:
                metrics.requestLevel.independentGroups.commitRate,
              independentGroupExactSetPrecision:
                metrics.requestLevel.independentGroups.exactSetPrecision,
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
  batchSize: number,
  batchTimeoutMs: number,
  certificationMode: System1EvalCertificationMode,
  datasetDirectory: string,
): Promise<RunResult> {
  mkdirSync(directory, { recursive: true });
  const runStarted = process.hrtime.bigint();
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

  const training = await timeStage("readTrain", () =>
    readTrainingEvaluationInput(datasetDirectory),
  );
  const calibration = await timeStage("readCalibration", () =>
    readCalibrationFitInput(datasetDirectory),
  );
  const poolSourceMetadata = readCorpusSourceMetadata(
    datasetDirectory,
    new Set([SYSTEM1_SPLITS.TRAIN, SYSTEM1_SPLITS.CALIBRATION]),
  );
  const corpusManifest = poolSourceMetadata.manifest;
  const sourceMetadata = poolSourceMetadata.records;
  const sourceMetadataByRequestId = new Map(
    sourceMetadata.map((metadata) => [metadata.requestId, metadata] as const),
  );
  if (sourceMetadataByRequestId.size !== sourceMetadata.length)
    throw new Error("Duplicate request id in C-06 source metadata.");
  const pool = [training, calibration] as const;
  const families = [
    ...new Set(pool.flatMap((split) => split.states.map(system1RepoFamily))),
  ].sort();
  const folds = buildSystem1RepoFamilyFolds(families);
  const manifest = buildScorerManifest(
    scorerId,
    external,
    batchSize,
    batchTimeoutMs,
    folds,
    families,
  );
  const manifestText = stableJson(manifest);
  const manifestHash = sha256(manifestText);
  writeText(directory, SYSTEM1_EVAL_FILE_NAMES.SCORER_MANIFEST, manifestText);
  writeText(
    directory,
    SYSTEM1_EVAL_FILE_NAMES.SCORER_MANIFEST_HASH,
    `${manifestHash}${SYSTEM1_EVAL_JSON_LINE_ENDING}`,
  );

  const trainingResponses = await timeStage("scoreTrainOof", () =>
    scoreStates(training.states, scorerId, external, batchSize, true),
  );
  const calibrationResponses = await timeStage("scoreCalibrationOof", () =>
    scoreStates(calibration.states, scorerId, external, batchSize, true),
  );
  const trainingExamples = examplesFor(
    training,
    trainingResponses,
    sourceMetadataByRequestId,
  );
  const calibrationExamples = examplesFor(
    calibration,
    calibrationResponses,
    sourceMetadataByRequestId,
  );
  const poolExamples = [...trainingExamples, ...calibrationExamples];
  const lofoPolicy: System1EvaluationPolicy = {
    ...fitSystem1LeaveOneFamilyOutPolicy(
      poolExamples,
      manifestHash,
      folds,
      SYSTEM1_EVAL_DEFAULT_MIN_FAMILY_COMMITS,
      manifest.trainingPlan,
    ),
    corpusManifest,
  };
  const calibrationOnlyPolicy: System1EvaluationPolicy = {
    ...fitSystem1EvaluationPolicy(calibrationExamples, manifestHash),
    corpusManifest,
  };
  const policies = [
    {
      mode: SYSTEM1_EVAL_CERTIFICATION_MODES.CALIBRATION_ONLY,
      policy: calibrationOnlyPolicy,
    },
    {
      mode: SYSTEM1_EVAL_CERTIFICATION_MODES.LEAVE_ONE_FAMILY_OUT,
      policy: lofoPolicy,
    },
  ] as const;
  const selected = policies.find(({ mode }) => mode === certificationMode);
  const comparison = policies.find(({ mode }) => mode !== certificationMode);
  if (!selected || !comparison)
    throw new Error("Unknown policy certification mode.");
  const frozenByMode = new Map<System1EvalCertificationMode, FrozenPolicy>();
  frozenByMode.set(selected.mode, freezePolicy(directory, selected.policy));
  frozenByMode.set(
    comparison.mode,
    freezePolicy(
      directory,
      comparison.policy,
      SYSTEM1_EVAL_FILE_NAMES.COMPARISON_POLICY,
      SYSTEM1_EVAL_FILE_NAMES.COMPARISON_POLICY_HASH,
    ),
  );
  const frozenPolicy = frozenByMode.get(certificationMode);
  const frozenComparison = frozenByMode.get(comparison.mode);
  if (!frozenPolicy || !frozenComparison)
    throw new Error("Could not freeze both certification policies.");

  if (manifestHash !== selected.policy.scorerManifestHash)
    throw new Error(
      "Policy scorer manifest hash does not match the scorer manifest.",
    );

  verifyFrozenPolicy(frozenPolicy);
  verifyFrozenPolicy(frozenComparison);
  const temporal = await timeStage("readTemporalAndVerifySeal", () =>
    readTemporalFinalEvaluationInput(frozenPolicy, datasetDirectory),
  );
  const test = await timeStage("readTestAndVerifySeal", () =>
    readTestFinalEvaluationInput(frozenPolicy, datasetDirectory),
  );
  if (!frozenPolicy.policy.corpusManifest)
    throw new Error(SYSTEM1_EVAL_CORPUS_MANIFEST_ERRORS.MISSING_POLICY_PIN);
  const heldOutSourceMetadataRead = readCorpusSourceMetadata(
    datasetDirectory,
    new Set([SYSTEM1_SPLITS.TEMPORAL, SYSTEM1_SPLITS.TEST]),
    frozenPolicy.policy.corpusManifest,
  );
  const heldOutSourceMetadata = heldOutSourceMetadataRead.records;
  for (const metadata of heldOutSourceMetadata) {
    if (sourceMetadataByRequestId.has(metadata.requestId))
      throw new Error("Duplicate request id in C-06 source metadata.");
    sourceMetadataByRequestId.set(metadata.requestId, metadata);
  }
  sourceMetadata.push(...heldOutSourceMetadata);
  const exportExclusions = readExportExclusions(datasetDirectory);
  const heldOutResponses = new Map<string, readonly System1ScorerResponse[]>();
  for (const split of [temporal, test]) {
    heldOutResponses.set(
      split.split,
      await timeStage(`score:${split.split}`, () =>
        scoreStates(split.states, scorerId, external, batchSize),
      ),
    );
  }
  const splitData: LoadedSplit[] = [training, calibration, temporal, test];
  const responsesBySplit = new Map<string, readonly System1ScorerResponse[]>([
    [training.split, trainingResponses],
    [calibration.split, calibrationResponses],
    ...heldOutResponses,
  ]);
  const examplesBySplit = new Map<string, readonly System1EvalExample[]>();
  for (const split of splitData) {
    const responses = responsesBySplit.get(split.split);
    if (!responses)
      throw new Error(`Missing scored responses for ${split.split}.`);
    examplesBySplit.set(
      split.split,
      examplesFor(split, responses, sourceMetadataByRequestId),
    );
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
  const metricsByMode = policies.map(({ mode, policy }) => ({
    mode,
    policy,
    policyHash: frozenByMode.get(mode)?.policyHash,
    splitMetrics: splitData.map((split) => {
      const examples = examplesBySplit.get(split.split);
      if (!examples) throw new Error(`Missing examples for ${split.split}.`);
      return computeSystem1SplitMetrics(examples, policy);
    }),
  }));
  const primaryMetrics = metricsByMode.find(
    ({ mode }) => mode === certificationMode,
  );
  if (!primaryMetrics)
    throw new Error("Missing metrics for selected policy mode.");
  const accountingFunnelsByMode = metricsByMode.map(
    ({ mode, policy, splitMetrics }) => ({
      mode,
      byTarget: Object.fromEntries(
        SYSTEM1_EVAL_PRECISION_TARGET_KEYS.map((targetKey, index) => [
          targetKey,
          splitMetrics.map((metrics) => {
            const examples = examplesBySplit.get(metrics.split);
            if (!examples)
              throw new Error(
                "Missing examples for funnel split " + metrics.split + ".",
              );
            return accountingFunnelForSplit(
              metrics.split,
              examples,
              sourceMetadata,
              exportExclusions,
              policy,
              SYSTEM1_EVAL_PRECISION_TARGETS[index],
            );
          }),
        ]),
      ),
    }),
  );
  const primaryAccountingFunnels = accountingFunnelsByMode.find(
    ({ mode }) => mode === certificationMode,
  );
  if (!primaryAccountingFunnels)
    throw new Error("Missing accounting funnel for selected policy mode.");
  const metricsDocument = {
    schemaVersion: SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION,
    protocolVersion: SYSTEM1_EVAL_PROTOCOL_VERSION,
    mode: SYSTEM1_EVAL_FINAL_EVALUATION_MODE,
    scorerId,
    scorerManifestHash: manifestHash,
    corpusManifest,
    policyHash: frozenPolicy.policyHash,
    certificationMode,
    sealedInputs,
    splits: primaryMetrics.splitMetrics.map(stripSlices),
    repoFamilyBreakdown: primaryMetrics.splitMetrics.map((metrics) =>
      repoFamilyBreakdown(metrics),
    ),
    accountingFunnelsByTarget: primaryAccountingFunnels.byTarget,
    certificationModes: metricsByMode.map(
      ({ mode, policy, policyHash, splitMetrics }) => ({
        mode,
        policyHash,
        precisionTargets: policy.precisionTargets,
        splits: splitMetrics.map(stripSlices),
        repoFamilyBreakdown: splitMetrics.map(repoFamilyBreakdown),
        accountingFunnelsByTarget: accountingFunnelsByMode.find(
          (entry) => entry.mode === mode,
        )?.byTarget,
      }),
    ),
  };
  const slicesDocument = {
    schemaVersion: SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION,
    mode: SYSTEM1_EVAL_FINAL_EVALUATION_MODE,
    scorerId,
    policyHash: frozenPolicy.policyHash,
    splits: primaryMetrics.splitMetrics.map((metrics) => ({
      split: metrics.split,
      slices: metrics.slices,
    })),
    certificationModes: metricsByMode.map(({ mode, splitMetrics }) => ({
      mode,
      splits: splitMetrics.map((metrics) => ({
        split: metrics.split,
        slices: metrics.slices,
      })),
    })),
  };
  const report = renderSystem1EvalReport({
    scorerId,
    policyHash: frozenPolicy.policyHash,
    selectedCertificationMode: certificationMode,
    splitMetrics: primaryMetrics.splitMetrics,
    sealedInputs,
    certificationModes: metricsByMode.map(({ mode, splitMetrics }) => ({
      mode,
      splitMetrics,
    })),
    lofoPolicy,
    accountingFunnels: primaryAccountingFunnels.byTarget,
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
      .map((name) => [name, sha256(readFileSync(path.join(directory, name)))]),
  );
  return {
    hashes: hashes as Readonly<Record<string, string>>,
    elapsedMs,
  };
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
  certificationMode: System1EvalCertificationMode,
  datasetDirectory: string,
): Promise<void> {
  const outputDirectory = path.join(
    system1EvalOutputDirectory(datasetDirectory),
    scorerId,
    certificationMode,
  );
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  const first = await runOneEvaluation(
    outputDirectory,
    scorerId,
    external,
    batchSize,
    batchTimeoutMs,
    certificationMode,
    datasetDirectory,
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
      batchSize,
      batchTimeoutMs,
      certificationMode,
      datasetDirectory,
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
      certificationMode,
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
      argumentsValue.certificationMode,
      argumentsValue.datasetDirectory,
    );
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}${SYSTEM1_EVAL_JSON_LINE_ENDING}`);
  process.exitCode = 1;
});
