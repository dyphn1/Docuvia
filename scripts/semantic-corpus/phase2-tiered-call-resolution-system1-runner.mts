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
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import {
  allFactRows,
  canonicalHash,
  labelsForSplitIsolated,
  readJson,
  readJsonl,
  sha256,
  verifyPhase1SourceSidecars,
  writeJson,
} from "./phase2-tiered-call-resolution-support.mjs";

const IMPLEMENTATION_FILES = [
  "scripts/semantic-corpus/phase2-tiered-call-resolution-system1-evaluation.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-system1-confidence-calibration.mts",
] as const;
const CORRECTED_FACTS_SHA256 =
  "ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e";
const ACCEPTED_PRECISION_TARGET = 0.9;
const FREEZE_NAME = "system1-calibration-threshold.json";
const EXPOSURE_NAME = "system1-heldout-exposure.json";

type Mode = "develop" | "calibrate" | "calibration-quality-oof" | "heldout";
type Split = "train" | "calibration" | "test" | "temporal";

interface Options {
  readonly mode: Mode;
  readonly predictionsPath: string;
  readonly outputDirectory: string;
  readonly freezePath: string | null;
}

interface PredictionManifest {
  readonly schemaVersion: 2;
  readonly measurement: "phase2-p2a-candidate-predictions/2";
  readonly candidateOracleMappingScope: "snapshotId+repoId";
  readonly predictionRows: number;
  readonly predictionSha256: string;
  readonly correctedFactsSha256: string;
  readonly implementationHash: string;
  readonly candidateGeneratorVersion: string;
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
  readonly schemaVersion: 2;
  readonly measurement: "phase2-p2b-system1-selection/2";
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
  readonly thresholdScore: number | null;
  readonly thresholdSelectionReason: string;
  readonly thresholdCandidateCount: number;
  readonly thresholdQualifyingCount: number;
  readonly calibrationMetrics: SystemOneSplitMetrics | null;
}

function parseOptions(argv: readonly string[]): Options {
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
        "Usage: ... --mode <develop|calibrate|calibration-quality-oof|heldout> --predictions <jsonl> --out <dir> [--freeze <artifact>]",
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
      mode !== "heldout") ||
    !predictionsPath ||
    !outputDirectory
  )
    throw new Error(
      "Mode, source predictions, and output directory are required.",
    );
  if ((mode === "heldout") !== Boolean(freezePath))
    throw new Error("Only heldout mode requires --freeze.");
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
    manifest.schemaVersion !== 2 ||
    manifest.measurement !== "phase2-p2a-candidate-predictions/2" ||
    manifest.candidateOracleMappingScope !== "snapshotId+repoId" ||
    manifest.labelsRead !== false
  )
    throw new Error("P2-B requires a label-free P2-A prediction manifest.");
  if (
    manifest.candidateGeneratorVersion !==
      CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION ||
    manifest.correctedFactsSha256 !== CORRECTED_FACTS_SHA256
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
      (row) => row.snapshotId === undefined || row.repoId === undefined,
    )
  )
    throw new Error("P2-B requires snapshot-scoped source predictions.");
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
  const sourceHashes = verifyPhase1SourceSidecars();
  for (const [name, expected] of Object.entries(manifest.sourceInputHashes))
    if (sourceHashes[name] !== expected)
      throw new Error(`Pinned source sidecar changed: ${name}.`);
  verifyOriginalImplementation(manifest);
  const oracleMapping = candidateOracleTargetMapping(allFactRows());
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

async function labelsFor(
  split: Split,
  observations: readonly Phase2EvaluationObservation[],
): Promise<Phase2EvaluationLabel[]> {
  const ids = new Set(observations.map(({ sampleId }) => sampleId));
  return labelsForSplitIsolated(split, ids);
}

function rowsFor(bundle: Bundle, split: Split): Phase2EvaluationObservation[] {
  return bundle.observations.filter((row) => row.split === split);
}

function reportRawMetrics(
  bundle: Bundle,
  split: "train",
  metrics: SystemOneSplitMetrics,
  labels: readonly Phase2EvaluationLabel[],
) {
  return {
    schemaVersion: 2,
    measurement: "phase2-p2b-system1-development/2",
    split,
    generatedAt: new Date().toISOString(),
    provenance: commonProvenance(bundle),
    labelRowsHash: labelsHash(labels),
    rawRankingMetrics: metrics,
    usage: "Train development only; does not select or freeze a threshold.",
  };
}

async function develop(bundle: Bundle, options: Options): Promise<void> {
  const observations = rowsFor(bundle, "train");
  const labels = await labelsFor("train", observations);
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
    ...reportRawMetrics(bundle, "train", metrics, labels),
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
  const observations = rowsFor(bundle, "calibration");
  const labels = await labelsFor("calibration", observations);
  const result = selectSystemOneThreshold(
    observations,
    labels,
    bundle.oracleMapping,
    ACCEPTED_PRECISION_TARGET,
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
    })),
  });
  const freeze: FreezeArtifact = {
    schemaVersion: 2,
    measurement: "phase2-p2b-system1-selection/2",
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
      "Choose maximum all-eligible-site coverage subject to accepted-site and conservative duplicate-group precision both meeting 0.90; incomplete candidate sets are allowed, ties/truncation/unsupported/unmapped top targets abstain.",
    targetAcceptedPrecision: result.targetAcceptedPrecision,
    thresholdScore: result.thresholdScore,
    thresholdSelectionReason: result.reason,
    thresholdCandidateCount: result.candidateThresholdCount,
    thresholdQualifyingCount: result.qualifyingThresholdCount,
    calibrationMetrics: result.metrics,
  };
  const freezePath = path.join(options.outputDirectory, FREEZE_NAME);
  writeJson(freezePath, freeze);
  writeJson(
    path.join(options.outputDirectory, "system1-calibration-metrics.json"),
    {
      schemaVersion: 2,
      measurement: "phase2-p2b-system1-calibration/2",
      split: "calibration",
      generatedAt: new Date().toISOString(),
      provenance: commonProvenance(bundle),
      calibrationLabelRowsHash: labelRowsHash,
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
  const observations = rowsFor(bundle, "calibration");
  const labels = await labelsFor("calibration", observations);
  const quality = evaluateSystemOneCalibrationQualityOof(
    observations,
    labels,
    bundle.oracleMapping,
  );
  const calibrationLabelRowsHash = labelsHash(labels);
  const calibrationQualityInputFingerprint = canonicalHash({
    measurement: quality.measurement,
    provenance: commonProvenance(bundle),
    calibrationLabelRowsHash,
    foldCount: quality.foldCount,
    binCount: quality.binCount,
    targetAcceptedPrecision: quality.targetAcceptedPrecision,
    method: quality.method,
  });
  const output = path.join(
    options.outputDirectory,
    "system1-calibration-quality-oof.json",
  );
  writeJson(output, {
    schemaVersion: 2,
    measurement: "phase2-p2b-system1-calibration-quality-oof-artifact/2",
    split: "calibration",
    generatedAt: new Date().toISOString(),
    provenance: commonProvenance(bundle),
    calibrationLabelRowsHash,
    calibrationQualityInputFingerprint,
    labelSplitsRead: ["calibration"],
    heldoutModeInvoked: false,
    quality,
  });
  console.info(
    `[phase2-p2b] calibration OOF ECE=${quality.siteWeighted.expectedCalibrationError ?? "n/a"}; Brier=${quality.siteWeighted.brierScore ?? "n/a"}; selected=${quality.selectedSiteCount}/${quality.eligibleSiteCount}; wrote ${output}`,
  );
}

function verifyFreeze(freezePath: string, bundle: Bundle): FreezeArtifact {
  const freeze = readJson<FreezeArtifact>(freezePath);
  const current = commonProvenance(bundle);
  if (
    freeze.schemaVersion !== 2 ||
    freeze.measurement !== "phase2-p2b-system1-selection/2" ||
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
      current.snapshotScopedUniqueAliasCount
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
  writeFileSync(
    exposurePath,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        measurement: "phase2-p2b-system1-heldout-exposure/2",
        openedAt: new Date().toISOString(),
        freezeArtifactSha256: sha256(readFileSync(options.freezePath!)),
        splitsOpened: ["test", "temporal"],
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  for (const split of ["test", "temporal"] as const) {
    const observations = rowsFor(bundle, split);
    const labels = await labelsFor(split, observations);
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
        status: "exposed-regression-only; not tuning or certification data",
        metrics,
      },
    );
    console.info(
      `[phase2-p2b] ${split} fixed threshold=${freeze.thresholdScore ?? "none"}; accepted=${metrics.selectedSiteCount}/${metrics.eligibleSiteCount}; rawTop1=${metrics.rawTop1}; regression only`,
    );
  }
}

async function run(options: Options): Promise<void> {
  const bundle = loadBundle(options.predictionsPath);
  if (options.mode === "develop") return develop(bundle, options);
  if (options.mode === "calibrate") return calibrate(bundle, options);
  if (options.mode === "calibration-quality-oof")
    return calibrateQualityOof(bundle, options);
  return regressHeldout(bundle, options);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  run(parseOptions(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
