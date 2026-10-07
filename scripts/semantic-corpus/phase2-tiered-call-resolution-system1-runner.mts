import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_RANKING_POLICY_VERSION,
} from "../../lib/contracts/src/index.js";
import {
  candidateOracleMappingProvenance,
  candidateOracleTargetMapping,
  type CandidateOracleTargetMapping,
} from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import {
  evaluateSystemOneSplit,
  selectSystemOne,
  selectSystemOneThreshold,
  type SystemOneSplitMetrics,
} from "./phase2-tiered-call-resolution-system1-evaluation.mjs";
import { evaluateSystemOneCalibrationQualityOof } from "./phase2-tiered-call-resolution-system1-confidence-calibration.mjs";
import { evaluateSystemOneFamilyTransferAtThreshold } from "./phase2-tiered-call-resolution-system1-family-transfer.mjs";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import {
  canonicalHash,
  labelsForSplitIsolated,
  licensedPhase2CorpusInputs,
  readJson,
  readJsonl,
  sha256,
  writeJson,
} from "./phase2-tiered-call-resolution-support.mjs";
import {
  assertEvaluationRowAllowed,
  assertEvaluationSplitLicenseAllowed,
  classifyEvaluationRowLicense,
  EVALUATION_LICENSE_POLICY_VERSION,
} from "./phase2-tiered-call-resolution-license-policy.mjs";

const SYSTEM_ONE_RUNNER_FILE =
  "scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts";
const IMPLEMENTATION_FILES = [
  "scripts/semantic-corpus/phase2-tiered-call-resolution-system1-evaluation.mts",
  SYSTEM_ONE_RUNNER_FILE,
  "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-system1-confidence-calibration.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-system1-family-transfer.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-license-policy.mts",
] as const;
const ACCEPTED_PRECISION_TARGET = 0.995;
const DUPLICATE_GROUP_PRECISION_TARGET = 0.9;
const FREEZE_NAME = "system1-calibration-threshold.json";
const EXPOSURE_NAME = "system1-heldout-exposure.json";

type Mode =
  | "develop"
  | "calibrate"
  | "calibration-quality-oof"
  | "family-transfer-calibrated-lofo"
  | "heldout";
type Split = "train" | "calibration" | "test" | "temporal";

interface Options {
  readonly mode: Mode;
  readonly predictionsPath: string;
  readonly outputDirectory: string;
  readonly freezePath: string | null;
}

interface PredictionManifest {
  readonly schemaVersion: 3;
  readonly measurement: "phase2-p2a-candidate-predictions/3";
  readonly licensePolicyVersion: typeof EVALUATION_LICENSE_POLICY_VERSION;
  readonly licenseInputScope: "licensed-source-rows-and-target-facts-only";
  readonly candidateOracleMappingScope: "snapshotId+repoId";
  readonly predictionRows: number;
  readonly predictionSha256: string;
  readonly correctedFactsSha256: string;
  readonly implementationHash: string;
  readonly candidateGeneratorVersion: string;
  readonly rankingPolicyVersion: string;
  readonly splitCounts: Readonly<Record<Split, number>>;
  readonly sourceInputHashes: Readonly<Record<string, string>>;
  readonly configurationHash: string;
  readonly labelsRead: false;
  readonly implementationFiles: Readonly<Record<string, string>>;
}

interface Bundle {
  readonly manifest: PredictionManifest;
  readonly manifestHash: string;
  readonly predictionHash: string;
  readonly observations: readonly Phase2EvaluationObservation[];
  readonly oracleMapping: CandidateOracleTargetMapping;
  readonly uniqueAliasCount: number;
  readonly aliasHash: string;
  readonly splitAssignmentHash: string;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly systemOneHash: string;
}

interface FreezeArtifact {
  readonly schemaVersion: 4;
  readonly measurement: "phase2-p2b-system1-selection/4";
  readonly split: "calibration";
  readonly frozenAt: string;
  readonly candidateGeneratorVersion: string;
  readonly rankingPolicyVersion: string;
  readonly configurationHash: string;
  readonly sourceFactsSha256: string;
  readonly sourceInputHashes: Readonly<Record<string, string>>;
  readonly sourcePredictionSha256: string;
  readonly sourcePredictionManifestSha256: string;
  readonly sourceImplementationHash: string;
  readonly systemOneImplementationHash: string;
  readonly sourceSplitAssignmentHash: string;
  readonly sourceSplitCounts: Readonly<Record<Split, number>>;
  readonly calibrationLabelRowsHash: string;
  readonly calibrationInputFingerprint: string;
  readonly snapshotScopedOracleMappingHash: string;
  readonly snapshotScopedUniqueAliasCount: number;
  readonly calibrationRuleSignatureSetHash: string;
  readonly calibrationRuleSignatureCount: number;
  readonly rankerDevelopmentPolicy: string;
  readonly trainDevelopmentArtifactSha256: string;
  readonly trainDevelopmentLabelRowsHash: string;
  readonly thresholdSelectionPolicy: string;
  readonly targetAcceptedPrecision: number;
  readonly targetDuplicateGroupPrecision: number;
  readonly thresholdScore: number | null;
  readonly thresholdSelectionReason: string;
  readonly thresholdCandidateCount: number;
  readonly thresholdQualifyingCount: number;
  readonly calibrationMetrics: SystemOneSplitMetrics | null;
  readonly licenseExcludedEnterprisePathSampleCount: number;
}

export function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !["--mode", "--predictions", "--out", "--freeze"].includes(key ?? "") ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(
        "Usage: ... --mode <develop|calibrate|calibration-quality-oof|family-transfer-calibrated-lofo|heldout> --predictions <jsonl> --out <dir> [--freeze <artifact>]",
      );
    values.set(key!, value);
  }
  const mode = values.get("--mode");
  const predictionsPath = values.get("--predictions");
  const outputDirectory = values.get("--out");
  const freezePath = values.get("--freeze") ?? null;
  if (
    (mode !== "develop" &&
      mode !== "calibrate" &&
      mode !== "calibration-quality-oof" &&
      mode !== "family-transfer-calibrated-lofo" &&
      mode !== "heldout") ||
    !predictionsPath ||
    !outputDirectory
  )
    throw new Error(
      "Mode, source predictions, and output directory are required.",
    );
  if (
    ["heldout", "family-transfer-calibrated-lofo"].includes(mode ?? "") !==
    Boolean(freezePath)
  )
    throw new Error(
      "Calibration-frozen LOFO and heldout modes require --freeze.",
    );
  return {
    mode,
    predictionsPath: path.resolve(predictionsPath),
    outputDirectory: path.resolve(outputDirectory),
    freezePath: freezePath ? path.resolve(freezePath) : null,
  };
}

function shaImplementation(files: readonly string[]): string {
  const root = path.resolve(import.meta.dirname, "../..");
  const digest = createHash("sha256");
  for (const file of files) {
    const bytes = readFileSync(path.join(root, file));
    digest.update(file).update("\0").update(bytes).update("\0");
  }
  return digest.digest("hex");
}

export function systemOneRunnerImplementationHash(): string {
  return shaImplementation([SYSTEM_ONE_RUNNER_FILE]);
}

function verifyOriginalImplementation(manifest: PredictionManifest): void {
  const root = path.resolve(import.meta.dirname, "../..");
  const digest = createHash("sha256");
  for (const file of Object.keys(manifest.implementationFiles).sort()) {
    const bytes = readFileSync(path.join(root, file));
    if (sha256(bytes) !== manifest.implementationFiles[file])
      throw new Error(`Source prediction implementation changed: ${file}.`);
    digest.update(file).update("\0").update(bytes).update("\0");
  }
  if (digest.digest("hex") !== manifest.implementationHash)
    throw new Error("Source prediction implementation fingerprint mismatch.");
}

function loadBundle(predictionsPath: string): Bundle {
  const manifestPath = path.join(
    path.dirname(predictionsPath),
    "candidate-prediction-manifest.json",
  );
  const manifest = readJson<PredictionManifest>(manifestPath);
  if (
    manifest.schemaVersion !== 3 ||
    manifest.measurement !== "phase2-p2a-candidate-predictions/3" ||
    manifest.licensePolicyVersion !== EVALUATION_LICENSE_POLICY_VERSION ||
    manifest.licenseInputScope !==
      "licensed-source-rows-and-target-facts-only" ||
    manifest.candidateOracleMappingScope !== "snapshotId+repoId" ||
    manifest.labelsRead !== false
  )
    throw new Error("P2-B requires a label-free P2-A prediction manifest.");
  if (
    manifest.candidateGeneratorVersion !==
      CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION ||
    manifest.rankingPolicyVersion !== CALL_RESOLUTION_RANKING_POLICY_VERSION ||
    manifest.correctedFactsSha256 !==
      manifest.sourceInputHashes["declared-type-facts-pass-a.jsonl"]
  )
    throw new Error(
      "P2-B source rule or corrected facts do not match the pinned version.",
    );
  const predictionHash = sha256(readFileSync(predictionsPath));
  if (predictionHash !== manifest.predictionSha256)
    throw new Error("Source prediction bytes do not match their manifest.");
  const observations = readJsonl<Phase2EvaluationObservation>(predictionsPath);
  if (observations.length !== manifest.predictionRows)
    throw new Error("Source prediction row count differs from manifest.");
  if (
    observations.some(
      (row) =>
        row.snapshotId === undefined ||
        row.repoId === undefined ||
        row.callerFilePath === undefined,
    )
  )
    throw new Error(
      "P2-B requires snapshot-scoped licensed source predictions.",
    );
  for (const row of observations) {
    assertEvaluationRowAllowed({
      repoId: row.repoId!,
      callerFilePath: row.callerFilePath!,
    });
    if (
      row.repoId!.toLowerCase() === "github.com/nestjs/nest" &&
      row.revision?.startsWith("35142c3eca") &&
      (row.split === "train" || row.split === "calibration")
    )
      throw new Error("Regression-only Nest source reached a tuning split.");
  }
  const sampleIds = new Set(observations.map(({ sampleId }) => sampleId));
  if (sampleIds.size !== observations.length)
    throw new Error("Source predictions contain duplicate sample IDs.");
  for (const split of ["train", "calibration", "test", "temporal"] as const) {
    if (
      observations.filter((row) => row.split === split).length !==
      manifest.splitCounts[split]
    )
      throw new Error(
        `Source prediction ${split} split count differs from manifest.`,
      );
  }
  const licensedInputs = licensedPhase2CorpusInputs();
  const sourceHashes = licensedInputs.sourceInputHashes;
  if (canonicalHash(sourceHashes) !== canonicalHash(manifest.sourceInputHashes))
    throw new Error("Licensed source sidecar inputs changed after prediction.");
  verifyOriginalImplementation(manifest);
  const oracleMapping = candidateOracleTargetMapping(licensedInputs.factRows);
  const oracleMappingProvenance =
    candidateOracleMappingProvenance(oracleMapping);
  const splitAssignmentHash = canonicalHash(
    observations
      .map(({ sampleId, split }) => ({ sampleId, split }))
      .sort((left, right) => left.sampleId.localeCompare(right.sampleId)),
  );
  const systemOneHash = shaImplementation(IMPLEMENTATION_FILES);
  return {
    manifest,
    manifestHash: sha256(readFileSync(manifestPath)),
    predictionHash,
    observations,
    oracleMapping,
    uniqueAliasCount: oracleMappingProvenance.uniqueAliasCount,
    aliasHash: canonicalHash(oracleMappingProvenance.hashInput),
    splitAssignmentHash,
    sourceHashes,
    systemOneHash,
  };
}

function commonProvenance(bundle: Bundle) {
  return {
    candidateGeneratorVersion: bundle.manifest.candidateGeneratorVersion,
    rankingPolicyVersion: CALL_RESOLUTION_RANKING_POLICY_VERSION,
    configurationHash: bundle.manifest.configurationHash,
    sourceFactsSha256: bundle.manifest.correctedFactsSha256,
    sourceInputHashes: bundle.sourceHashes,
    sourcePredictionSha256: bundle.predictionHash,
    sourcePredictionManifestSha256: bundle.manifestHash,
    sourceImplementationHash: bundle.manifest.implementationHash,
    systemOneImplementationHash: bundle.systemOneHash,
    runnerImplementationHash: systemOneRunnerImplementationHash(),
    sourceSplitAssignmentHash: bundle.splitAssignmentHash,
    sourceSplitCounts: bundle.manifest.splitCounts,
    candidateOracleMappingScope: "snapshotId+repoId",
    snapshotScopedOracleMappingHash: bundle.aliasHash,
    snapshotScopedUniqueAliasCount: bundle.uniqueAliasCount,
  };
}

function labelsHash(labels: readonly Phase2EvaluationLabel[]): string {
  return canonicalHash(
    [...labels].sort((left, right) =>
      left.sampleId.localeCompare(right.sampleId),
    ),
  );
}

interface LicensedSplitRows {
  readonly observations: readonly Phase2EvaluationObservation[];
  readonly labels: readonly Phase2EvaluationLabel[];
  readonly excludedEnterprisePathSampleCount: number;
}

async function licensedSplitRows(
  split: Split,
  observations: readonly Phase2EvaluationObservation[],
): Promise<LicensedSplitRows> {
  const ids = new Set(observations.map(({ sampleId }) => sampleId));
  const labels = await labelsForSplitIsolated(split, ids);
  const labelsById = new Map(labels.map((label) => [label.sampleId, label]));
  const allowedObservations: Phase2EvaluationObservation[] = [];
  const allowedLabels: Phase2EvaluationLabel[] = [];
  let excludedEnterprisePathSampleCount = 0;
  for (const observation of observations) {
    const label = labelsById.get(observation.sampleId);
    if (!label)
      throw new Error(`Missing ${split} label ${observation.sampleId}.`);
    const targetFilePaths = label.positiveTargetIds.map((targetId) => {
      const separator = targetId.indexOf("#");
      return separator < 0 ? targetId : targetId.slice(0, separator);
    });
    const classification = classifyEvaluationRowLicense({
      repoId: observation.repoId!,
      callerFilePath: observation.callerFilePath!,
      targetFilePaths,
    });
    if (classification === "excluded-repository")
      throw new Error(
        `Excluded repository reached the ${split} evaluation split.`,
      );
    if (classification === "excluded-path") {
      excludedEnterprisePathSampleCount++;
      continue;
    }
    allowedObservations.push(observation);
    allowedLabels.push(label);
  }
  assertEvaluationSplitLicenseAllowed(allowedObservations, allowedLabels);
  return {
    observations: allowedObservations,
    labels: allowedLabels,
    excludedEnterprisePathSampleCount,
  };
}

function rowsFor(bundle: Bundle, split: Split): Phase2EvaluationObservation[] {
  return bundle.observations.filter((row) => row.split === split);
}

function reportRawMetrics(
  bundle: Bundle,
  split: "train",
  metrics: SystemOneSplitMetrics,
  labels: readonly Phase2EvaluationLabel[],
  licenseExcludedEnterprisePathSampleCount: number,
) {
  return {
    schemaVersion: 2,
    measurement: "phase2-p2b-system1-development/2",
    split,
    generatedAt: new Date().toISOString(),
    provenance: commonProvenance(bundle),
    labelRowsHash: labelsHash(labels),
    licenseExcludedEnterprisePathSampleCount,
    rawRankingMetrics: metrics,
    usage: "Train development only; does not select or freeze a threshold.",
  };
}

async function develop(bundle: Bundle, options: Options): Promise<void> {
  const splitRows = await licensedSplitRows("train", rowsFor(bundle, "train"));
  const observations = splitRows.observations;
  const labels = splitRows.labels;
  const metrics = evaluateSystemOneSplit(
    observations,
    labels,
    bundle.oracleMapping,
    null,
    "train",
  );
  const candidateScores = [
    ...new Set(
      observations.flatMap((row) =>
        selectSystemOne(row, Number.NEGATIVE_INFINITY, bundle.oracleMapping)
          .status === "likely" && row.topRankScore !== null
          ? [row.topRankScore]
          : [],
      ),
    ),
  ].sort((left, right) => left - right);
  const scoreCurve = candidateScores.map((thresholdScore) => ({
    thresholdScore,
    metrics: evaluateSystemOneSplit(
      observations,
      labels,
      bundle.oracleMapping,
      thresholdScore,
      "train",
    ),
  }));
  const file = path.join(
    options.outputDirectory,
    "system1-train-development.json",
  );
  writeJson(file, {
    ...reportRawMetrics(
      bundle,
      "train",
      metrics,
      labels,
      splitRows.excludedEnterprisePathSampleCount,
    ),
    scoreThresholdCurve: scoreCurve,
    scoreThresholdCurveUse:
      "Train-only diagnostic of the pinned rank score; calibration labels alone choose the shipped threshold.",
  });
  console.info(
    `[phase2-p2b] train raw top-1 ${metrics.rawTop1CorrectCount}/${metrics.eligibleSiteCount}=${metrics.rawTop1}; wrote ${file}`,
  );
}

async function calibrate(bundle: Bundle, options: Options): Promise<void> {
  if (existsSync(path.join(options.outputDirectory, EXPOSURE_NAME)))
    throw new Error(
      "Calibration cannot be changed after this output artifact opened heldout labels.",
    );
  const developmentPath = path.join(
    options.outputDirectory,
    "system1-train-development.json",
  );
  if (!existsSync(developmentPath))
    throw new Error(
      "Run train development before selecting calibration thresholds.",
    );
  const development = readJson<{
    readonly schemaVersion: number;
    readonly measurement: string;
    readonly split: string;
    readonly labelRowsHash: string;
    readonly provenance: unknown;
  }>(developmentPath);
  if (
    development.schemaVersion !== 2 ||
    development.measurement !== "phase2-p2b-system1-development/2" ||
    development.split !== "train" ||
    canonicalHash(development.provenance) !==
      canonicalHash(commonProvenance(bundle))
  )
    throw new Error(
      "Train development artifact does not match this P2-B source/rule set.",
    );
  const splitRows = await licensedSplitRows(
    "calibration",
    rowsFor(bundle, "calibration"),
  );
  const observations = splitRows.observations;
  const labels = splitRows.labels;
  const result = selectSystemOneThreshold(
    observations,
    labels,
    bundle.oracleMapping,
    ACCEPTED_PRECISION_TARGET,
    DUPLICATE_GROUP_PRECISION_TARGET,
  );
  const labelRowsHash = labelsHash(labels);
  const ruleSignatures = [
    ...new Set(
      observations.flatMap((row) =>
        row.ruleSignature ? [row.ruleSignature] : [],
      ),
    ),
  ].sort();
  const calibrationInputFingerprint = canonicalHash({
    split: "calibration",
    provenance: commonProvenance(bundle),
    targetAcceptedPrecision: ACCEPTED_PRECISION_TARGET,
    targetDuplicateGroupPrecision: DUPLICATE_GROUP_PRECISION_TARGET,
    labelRowsHash,
    ruleSignatureSetHash: canonicalHash(ruleSignatures),
    observations: observations.map((row) => ({
      sampleId: row.sampleId,
      ruleSignature: row.ruleSignature,
      topTargetId: row.topTargetId,
      topRankScore: row.topRankScore,
      tied: row.tied,
      candidateSetComplete: row.candidateSetComplete,
      truncated: row.truncated,
      unsupportedCallShape: row.unsupportedCallShape,
      topRankingSignals: row.topRankingSignals ?? [],
    })),
  });
  const freeze: FreezeArtifact = {
    schemaVersion: 4,
    measurement: "phase2-p2b-system1-selection/4",
    split: "calibration",
    frozenAt: new Date().toISOString(),
    ...commonProvenance(bundle),
    calibrationLabelRowsHash: labelRowsHash,
    calibrationInputFingerprint,
    calibrationRuleSignatureSetHash: canonicalHash(ruleSignatures),
    calibrationRuleSignatureCount: ruleSignatures.length,
    rankerDevelopmentPolicy:
      "Existing deterministic ordered-evidence ranker; train is descriptive development only, with no learned weight fitting.",
    trainDevelopmentArtifactSha256: sha256(readFileSync(developmentPath)),
    trainDevelopmentLabelRowsHash: development.labelRowsHash,
    thresholdSelectionPolicy:
      "Choose maximum calibration all-eligible-site coverage subject to accepted-site precision >= 0.995 and duplicate-group precision >= 0.90; incomplete candidate sets are allowed, ties/truncation/unsupported/unmapped top targets abstain.",
    targetAcceptedPrecision: result.targetAcceptedPrecision,
    targetDuplicateGroupPrecision: result.targetDuplicateGroupPrecision,
    thresholdScore: result.thresholdScore,
    thresholdSelectionReason: result.reason,
    thresholdCandidateCount: result.candidateThresholdCount,
    thresholdQualifyingCount: result.qualifyingThresholdCount,
    calibrationMetrics: result.metrics,
    licenseExcludedEnterprisePathSampleCount:
      splitRows.excludedEnterprisePathSampleCount,
  };
  const freezePath = path.join(options.outputDirectory, FREEZE_NAME);
  writeJson(freezePath, freeze);
  writeJson(
    path.join(options.outputDirectory, "system1-calibration-metrics.json"),
    {
      schemaVersion: 3,
      measurement: "phase2-p2b-system1-calibration/3",
      split: "calibration",
      generatedAt: new Date().toISOString(),
      provenance: commonProvenance(bundle),
      calibrationLabelRowsHash: labelRowsHash,
      licenseExcludedEnterprisePathSampleCount:
        splitRows.excludedEnterprisePathSampleCount,
      calibrationInputFingerprint,
      threshold: result,
      thresholdArtifactPath: FREEZE_NAME,
      thresholdArtifactSha256: sha256(readFileSync(freezePath)),
    },
  );
  console.info(
    `[phase2-p2b] calibration threshold=${result.thresholdScore ?? "none"}; accepted=${result.metrics?.selectedSiteCount ?? 0}/${result.metrics?.eligibleSiteCount ?? observations.length}; precision=${result.metrics?.acceptedSitePrecision ?? "n/a"}; froze ${freezePath}`,
  );
}

async function calibrateQualityOof(
  bundle: Bundle,
  options: Options,
): Promise<void> {
  const splitRows = await licensedSplitRows(
    "calibration",
    rowsFor(bundle, "calibration"),
  );
  const observations = splitRows.observations;
  const labels = splitRows.labels;
  const quality = evaluateSystemOneCalibrationQualityOof(
    observations,
    labels,
    bundle.oracleMapping,
    {
      targetAcceptedPrecision: ACCEPTED_PRECISION_TARGET,
      targetDuplicateGroupPrecision: DUPLICATE_GROUP_PRECISION_TARGET,
    },
  );
  const calibrationLabelRowsHash = labelsHash(labels);
  const calibrationQualityInputFingerprint = canonicalHash({
    measurement: quality.measurement,
    provenance: commonProvenance(bundle),
    calibrationLabelRowsHash,
    licenseExcludedEnterprisePathSampleCount:
      splitRows.excludedEnterprisePathSampleCount,
    foldCount: quality.foldCount,
    binCount: quality.binCount,
    targetAcceptedPrecision: quality.targetAcceptedPrecision,
    targetDuplicateGroupPrecision: quality.targetDuplicateGroupPrecision,
    method: quality.method,
  });
  const output = path.join(
    options.outputDirectory,
    "system1-calibration-quality-oof.json",
  );
  writeJson(output, {
    schemaVersion: 4,
    measurement: "phase2-p2b-system1-calibration-quality-oof-artifact/4",
    split: "calibration",
    generatedAt: new Date().toISOString(),
    provenance: commonProvenance(bundle),
    calibrationLabelRowsHash,
    calibrationQualityInputFingerprint,
    labelSplitsRead: ["calibration"],
    licenseExcludedEnterprisePathSampleCount:
      splitRows.excludedEnterprisePathSampleCount,
    heldoutModeInvoked: false,
    quality,
  });
  console.info(
    `[phase2-p2b] calibration OOF ECE=${quality.siteWeighted.expectedCalibrationError ?? "n/a"}; Brier=${quality.siteWeighted.brierScore ?? "n/a"}; selected=${quality.selectedSiteCount}/${quality.eligibleSiteCount}; wrote ${output}`,
  );
}

async function evaluateFamilyTransferTrain(
  bundle: Bundle,
  options: Options,
): Promise<void> {
  const freeze = verifyFreeze(options.freezePath!, bundle);
  const splitRows = await licensedSplitRows("train", rowsFor(bundle, "train"));
  const observations = splitRows.observations;
  const labels = splitRows.labels;
  const evaluation = evaluateSystemOneFamilyTransferAtThreshold(
    observations,
    labels,
    bundle.oracleMapping,
    freeze.thresholdScore,
  );
  const trainLabelRowsHash = labelsHash(labels);
  const inputFingerprint = canonicalHash({
    measurement: evaluation.measurement,
    provenance: commonProvenance(bundle),
    trainLabelRowsHash,
    licenseExcludedEnterprisePathSampleCount:
      splitRows.excludedEnterprisePathSampleCount,
    probabilityMapMethod: evaluation.probabilityMapMethod,
    probabilityMapSupportRule: evaluation.probabilityMapSupportRule,
    thresholdSelectionSource: evaluation.thresholdSelectionSource,
    thresholdScore: evaluation.thresholdScore,
    crossFamilyDuplicateGroupsHash: evaluation.crossFamilyDuplicateGroupsHash,
    crossFamilyGroupFamiliesHash: evaluation.crossFamilyGroupFamiliesHash,
    folds: evaluation.folds.map((fold) => ({
      heldOutFamily: fold.heldOutFamily,
      trainingSampleIdsHash: fold.trainingSampleIdsHash,
      heldOutSampleIdsHash: fold.heldOutSampleIdsHash,
      trainingLabelRowsHash: fold.trainingLabelRowsHash,
      heldOutLabelRowsHash: fold.heldOutLabelRowsHash,
      excludedCrossFamilyGroupsHash: fold.excludedCrossFamilyGroupsHash,
      thresholdScore: fold.thresholdScore,
      probabilityMapFitHash: fold.probabilityMap.fitHash,
      abstentionAttribution: fold.abstentionAttribution,
    })),
  });
  const output = path.join(
    options.outputDirectory,
    "system1-train-family-transfer-calibrated-lofo.json",
  );
  writeJson(output, {
    schemaVersion: 2,
    measurement:
      "phase2-p2b-system1-family-transfer-calibrated-lofo-artifact/2",
    split: "train",
    generatedAt: new Date().toISOString(),
    provenance: commonProvenance(bundle),
    trainLabelRowsHash,
    licenseExcludedEnterprisePathSampleCount:
      splitRows.excludedEnterprisePathSampleCount,
    calibrationFreezeArtifactSha256: sha256(readFileSync(options.freezePath!)),
    inputFingerprint,
    labelSplitsRead: ["train"],
    heldoutModeInvoked: false,
    evaluation,
  });
  console.info(
    `[phase2-p2b] calibration-frozen TRAIN-family LOFO ${evaluation.folds.length} families; eligible=${evaluation.eligibleSiteCount}; threshold=${freeze.thresholdScore ?? "none"}; macro end-to-end=${evaluation.familyMacroEndToEndTop1 ?? "n/a"}; wrote ${output}`,
  );
}

function verifyFreeze(freezePath: string, bundle: Bundle): FreezeArtifact {
  const freeze = readJson<FreezeArtifact>(freezePath);
  const current = commonProvenance(bundle);
  if (
    freeze.schemaVersion !== 4 ||
    freeze.measurement !== "phase2-p2b-system1-selection/4" ||
    freeze.split !== "calibration" ||
    freeze.candidateGeneratorVersion !== current.candidateGeneratorVersion ||
    freeze.rankingPolicyVersion !== current.rankingPolicyVersion ||
    freeze.configurationHash !== current.configurationHash ||
    freeze.sourceFactsSha256 !== current.sourceFactsSha256 ||
    canonicalHash(freeze.sourceInputHashes) !==
      canonicalHash(current.sourceInputHashes) ||
    freeze.sourcePredictionSha256 !== current.sourcePredictionSha256 ||
    freeze.sourcePredictionManifestSha256 !==
      current.sourcePredictionManifestSha256 ||
    freeze.sourceImplementationHash !== current.sourceImplementationHash ||
    freeze.systemOneImplementationHash !==
      current.systemOneImplementationHash ||
    freeze.sourceSplitAssignmentHash !== current.sourceSplitAssignmentHash ||
    canonicalHash(freeze.sourceSplitCounts) !==
      canonicalHash(current.sourceSplitCounts) ||
    freeze.snapshotScopedOracleMappingHash !==
      current.snapshotScopedOracleMappingHash ||
    freeze.snapshotScopedUniqueAliasCount !==
      current.snapshotScopedUniqueAliasCount ||
    freeze.targetAcceptedPrecision !== ACCEPTED_PRECISION_TARGET ||
    freeze.targetDuplicateGroupPrecision !== DUPLICATE_GROUP_PRECISION_TARGET
  )
    throw new Error(
      "Frozen P2-B threshold does not match current rules or source inputs.",
    );
  const developmentPath = path.join(
    path.dirname(freezePath),
    "system1-train-development.json",
  );
  if (
    !existsSync(developmentPath) ||
    sha256(readFileSync(developmentPath)) !==
      freeze.trainDevelopmentArtifactSha256
  )
    throw new Error(
      "Pinned train development artifact changed after calibration.",
    );
  return freeze;
}

async function regressHeldout(bundle: Bundle, options: Options): Promise<void> {
  if (
    path.resolve(options.outputDirectory) !== path.dirname(options.freezePath!)
  )
    throw new Error(
      "Heldout regression output must be the calibration freeze directory.",
    );
  const freeze = verifyFreeze(options.freezePath!, bundle);
  const exposurePath = path.join(options.outputDirectory, EXPOSURE_NAME);
  if (existsSync(exposurePath))
    throw new Error(
      "P2-B heldout labels were already opened for this output directory.",
    );
  const splitsToOpen = (["test", "temporal"] as const).filter(
    (split) => rowsFor(bundle, split).length > 0,
  );
  writeFileSync(
    exposurePath,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        measurement: "phase2-p2b-system1-heldout-exposure/2",
        openedAt: new Date().toISOString(),
        freezeArtifactSha256: sha256(readFileSync(options.freezePath!)),
        splitsOpened: splitsToOpen,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  for (const split of splitsToOpen) {
    const splitRows = await licensedSplitRows(split, rowsFor(bundle, split));
    const observations = splitRows.observations;
    const labels = splitRows.labels;
    const metrics = evaluateSystemOneSplit(
      observations,
      labels,
      bundle.oracleMapping,
      freeze.thresholdScore,
      split,
    );
    writeJson(
      path.join(options.outputDirectory, `system1-${split}-regression.json`),
      {
        schemaVersion: 2,
        measurement: "phase2-p2b-system1-heldout-regression/2",
        split,
        evaluatedAt: new Date().toISOString(),
        calibrationFreezeArtifactSha256: sha256(
          readFileSync(options.freezePath!),
        ),
        calibrationInputFingerprint: freeze.calibrationInputFingerprint,
        sourcePredictionSha256: bundle.predictionHash,
        sourceSplitAssignmentHash: bundle.splitAssignmentHash,
        licenseExcludedEnterprisePathSampleCount:
          splitRows.excludedEnterprisePathSampleCount,
        wrongAcceptDiagnostics: heldoutWrongAcceptDiagnostics(
          observations,
          labels,
          bundle.oracleMapping,
          freeze.thresholdScore,
        ),
        status: "exposed-regression-only; not tuning or certification data",
        metrics,
      },
    );
    console.info(
      `[phase2-p2b] ${split} fixed threshold=${freeze.thresholdScore ?? "none"}; accepted=${metrics.selectedSiteCount}/${metrics.eligibleSiteCount}; rawTop1=${metrics.rawTop1}; excluded-enterprise-targets=${splitRows.excludedEnterprisePathSampleCount}; regression only`,
    );
  }
}

function heldoutWrongAcceptDiagnostics(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  oracleMapping: CandidateOracleTargetMapping,
  thresholdScore: number | null,
) {
  const labelsById = new Map(labels.map((label) => [label.sampleId, label]));
  const wrongAccepts = observations.flatMap((observation) => {
    const decision = selectSystemOne(
      observation,
      thresholdScore,
      oracleMapping,
    );
    if (decision.status !== "likely" || !decision.selectedTargetId) return [];
    const label = labelsById.get(observation.sampleId);
    if (!label)
      throw new Error(`Missing diagnostic label ${observation.sampleId}.`);
    const selected = decision.selectedTargetId.replace(/@L\d+(?:#\d+)?$/, "");
    const correct = label.positiveTargetIds.some(
      (targetId) => targetId.replace(/@L\d+(?:#\d+)?$/, "") === selected,
    );
    if (correct) return [];
    return [
      {
        sampleId: observation.sampleId,
        callShape: observation.calleeKind ?? "unmapped",
        reason: decision.reason,
        topRankingSignals: observation.topRankingSignals ?? [],
        topRankScore: observation.topRankScore,
        selectedTargetId: decision.selectedTargetId,
        positiveTargetIds: label.positiveTargetIds,
      },
    ];
  });
  const grouped = new Map<string, number>();
  for (const row of wrongAccepts) {
    const key = `${row.callShape}\0${row.reason}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return {
    count: wrongAccepts.length,
    byCallShapeAndReason: [...grouped.entries()]
      .map(([key, count]) => {
        const [callShape, reason] = key.split("\0");
        return { callShape, reason, count };
      })
      .sort((left, right) =>
        `${left.callShape}/${left.reason}`.localeCompare(
          `${right.callShape}/${right.reason}`,
        ),
      ),
    wrongAccepts,
  };
}

async function run(options: Options): Promise<void> {
  const bundle = loadBundle(options.predictionsPath);
  if (options.mode === "develop") return develop(bundle, options);
  if (options.mode === "calibrate") return calibrate(bundle, options);
  if (options.mode === "calibration-quality-oof")
    return calibrateQualityOof(bundle, options);
  if (options.mode === "family-transfer-calibrated-lofo")
    return evaluateFamilyTransferTrain(bundle, options);
  return regressHeldout(bundle, options);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  run(parseOptions(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
