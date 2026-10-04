import { readFileSync } from "node:fs";
import path from "node:path";
import {
  candidateOracleMappingProvenance,
  candidateOracleTargetMapping,
  filterInputsToUniqueOracleTargets,
} from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import { evaluateCandidateStageSplit } from "./phase2-tiered-call-resolution-candidate-stage-evaluation.mjs";
import type { CandidateStageEvidence } from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import {
  allFactRows,
  canonicalHash,
  labelsForSplitIsolated,
  readJson,
  sha256,
  verifyPhase1SourceSidecars,
  writeJson,
} from "./phase2-tiered-call-resolution-support.mjs";

const REPLAY_DIRECTORY = path.join(
  "evaluate/results/semantic-corpus/v1",
  "phase2-p2a-v4-train-candidate-stage-replay",
);
const OUTPUT_DIRECTORY = path.join(
  "evaluate/results/semantic-corpus/v1",
  "phase2-p2a-v4-train-candidate-stage-evaluation",
);

interface ReplayManifest {
  readonly schemaVersion: 1;
  readonly measurement: "phase2-p2a-candidate-stage-replay/1";
  readonly split: "train";
  readonly labelSplitsRead: readonly [];
  readonly labelsRead: false;
  readonly trainSampleIds: number;
  readonly trainSampleIdsHash: string;
  readonly candidateGeneratorVersion: string;
  readonly pinnedV4: {
    readonly predictionsPath: string;
    readonly predictionSha256: string;
    readonly implementationHash: string;
    readonly correctedFactsSha256: string;
    readonly sourceInputHashes: Readonly<Record<string, string>>;
    readonly configurationHash: string;
  };
  readonly provenance: {
    readonly sourceInputHashes: Readonly<Record<string, string>>;
    readonly outputPath: string;
    readonly outputSha256: string;
    readonly inputFingerprint: string;
  };
}

interface CandidatePredictionManifest {
  readonly schemaVersion: 2;
  readonly measurement: "phase2-p2a-candidate-predictions/2";
  readonly predictionRows: number;
  readonly predictionSha256: string;
  readonly correctedFactsSha256: string;
  readonly implementationHash: string;
  readonly candidateGeneratorVersion: string;
  readonly splitCounts: Readonly<Record<string, number>>;
  readonly sourceInputHashes: Readonly<Record<string, string>>;
  readonly configurationHash: string;
  readonly labelsRead: false;
}

interface ReplayRow {
  readonly sampleId: string;
  readonly split: "train";
  readonly decisionFieldsEquivalent: true;
  readonly candidateStages: CandidateStageEvidence;
}

function jsonlRowsForSplit<T extends { readonly split: string }>(
  bytes: Buffer,
  split: string,
): T[] {
  const rows: T[] = [];
  for (const line of bytes.toString("utf8").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const match = /"split"\s*:\s*"([^"\\]*)"/u.exec(line);
    if (!match) throw new Error("Prediction row has no split field.");
    if (match[1] !== split) continue;
    const row = JSON.parse(line) as T;
    if (row.split !== split)
      throw new Error("Prediction row has conflicting split values.");
    rows.push(row);
  }
  return rows;
}

function hashesForFiles(files: readonly string[]): {
  readonly files: Readonly<Record<string, string>>;
  readonly hash: string;
} {
  const root = path.resolve(import.meta.dirname, "../..");
  const hashes = Object.fromEntries(
    [...files]
      .sort()
      .map((file) => [file, sha256(readFileSync(path.join(root, file)))]),
  );
  return { files: hashes, hash: canonicalHash(hashes) };
}

async function run(): Promise<void> {
  const root = path.resolve(import.meta.dirname, "../..");
  const replayManifestPath = path.join(root, REPLAY_DIRECTORY, "manifest.json");
  const replayManifest = readJson<ReplayManifest>(replayManifestPath);
  if (
    replayManifest.schemaVersion !== 1 ||
    replayManifest.measurement !== "phase2-p2a-candidate-stage-replay/1" ||
    replayManifest.split !== "train" ||
    replayManifest.labelsRead !== false ||
    replayManifest.labelSplitsRead.length !== 0 ||
    replayManifest.candidateGeneratorVersion !== "declared-member-hypothesis-v4"
  )
    throw new Error(
      "Candidate-stage evaluation requires the pinned TRAIN v4 replay.",
    );

  const predictionsPath = path.join(
    root,
    replayManifest.pinnedV4.predictionsPath,
  );
  const predictionsBytes = readFileSync(predictionsPath);
  if (sha256(predictionsBytes) !== replayManifest.pinnedV4.predictionSha256)
    throw new Error("Pinned v4 source predictions changed.");
  const predictionManifestPath = path.join(
    path.dirname(predictionsPath),
    "candidate-prediction-manifest.json",
  );
  const predictionManifest = readJson<CandidatePredictionManifest>(
    predictionManifestPath,
  );
  if (
    predictionManifest.schemaVersion !== 2 ||
    predictionManifest.measurement !== "phase2-p2a-candidate-predictions/2" ||
    predictionManifest.predictionSha256 !==
      replayManifest.pinnedV4.predictionSha256 ||
    predictionManifest.implementationHash !==
      replayManifest.pinnedV4.implementationHash ||
    predictionManifest.candidateGeneratorVersion !==
      replayManifest.candidateGeneratorVersion ||
    predictionManifest.correctedFactsSha256 !==
      replayManifest.pinnedV4.correctedFactsSha256 ||
    predictionManifest.configurationHash !==
      replayManifest.pinnedV4.configurationHash ||
    predictionManifest.labelsRead !== false
  )
    throw new Error(
      "Pinned source prediction manifest differs from the replay contract.",
    );

  const sourceHashes = verifyPhase1SourceSidecars();
  for (const [name, expectedHash] of Object.entries(
    replayManifest.pinnedV4.sourceInputHashes,
  ))
    if (sourceHashes[name] !== expectedHash)
      throw new Error(`Pinned source input changed for ${name}.`);
  if (
    sourceHashes["callsites.jsonl"] !==
      replayManifest.provenance.sourceInputHashes["callsites.jsonl"] ||
    sourceHashes["declared-type-facts-pass-a.jsonl"] !==
      replayManifest.pinnedV4.correctedFactsSha256
  )
    throw new Error(
      "TRAIN source/facts hashes differ from pinned replay provenance.",
    );

  const evidencePath = path.join(root, replayManifest.provenance.outputPath);
  const evidenceBytes = readFileSync(evidencePath);
  const evidenceSha256 = sha256(evidenceBytes);
  if (evidenceSha256 !== replayManifest.provenance.outputSha256)
    throw new Error(
      "TRAIN candidate-stage evidence bytes differ from the replay manifest.",
    );
  const replayRows = jsonlRowsForSplit<ReplayRow>(evidenceBytes, "train");
  const stageEvidence = replayRows.map((row) => {
    if (
      !row.decisionFieldsEquivalent ||
      row.candidateStages.sampleId !== row.sampleId
    )
      throw new Error(
        `TRAIN replay decision proof is invalid for ${row.sampleId}.`,
      );
    return row.candidateStages;
  });

  const observations = jsonlRowsForSplit<Phase2EvaluationObservation>(
    predictionsBytes,
    "train",
  );
  if (
    observations.length !== predictionManifest.splitCounts.train ||
    observations.length !== replayManifest.trainSampleIds
  )
    throw new Error(
      "TRAIN prediction count differs from the pinned manifests.",
    );
  const sampleIds = new Set(observations.map((row) => row.sampleId));
  if (sampleIds.size !== observations.length)
    throw new Error("TRAIN source predictions contain duplicate sample IDs.");
  const labels = await labelsForSplitIsolated("train", sampleIds);
  const facts = allFactRows();
  const oracleMapping = candidateOracleTargetMapping(facts);
  const oracleMappingProvenance =
    candidateOracleMappingProvenance(oracleMapping);
  const uniqueInputs = filterInputsToUniqueOracleTargets(
    observations,
    labels,
    oracleMapping,
  );
  const metrics = evaluateCandidateStageSplit({
    observations,
    evidence: stageEvidence,
    labels,
    uniqueInputs,
    split: "train",
  });

  const predictionFileSha256 = sha256(predictionsBytes);
  const sourceEvidenceHash = replayManifest.provenance.inputFingerprint;
  const evaluationCode = hashesForFiles([
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evaluation.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evaluation-runner.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-replay.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts",
    "lib/core/src/semantic/call-resolution-hypothesis-index.ts",
  ]);
  const sortedLabels = [...labels].sort((left, right) =>
    left.sampleId.localeCompare(right.sampleId),
  );
  const labelsHash = canonicalHash(sortedLabels);
  const oracleMappingHash = canonicalHash(oracleMappingProvenance.hashInput);
  const inputFingerprint = canonicalHash({
    measurement: "phase2-p2a-candidate-stage-train-audit/2",
    v4PredictionSha256: predictionFileSha256,
    predictionManifestSha256: sha256(readFileSync(predictionManifestPath)),
    replayManifestSha256: sha256(readFileSync(replayManifestPath)),
    replayEvidenceSha256: evidenceSha256,
    replayInputFingerprint: sourceEvidenceHash,
    sourceInputHashes: sourceHashes,
    correctedFactsSha256: replayManifest.pinnedV4.correctedFactsSha256,
    candidateGeneratorVersion: replayManifest.candidateGeneratorVersion,
    trainSampleIdsHash: replayManifest.trainSampleIdsHash,
    trainLabelsHash: labelsHash,
    oracleMappingHash,
    evaluationCodeHash: evaluationCode.hash,
  });
  const output = {
    schemaVersion: 1,
    measurement: "phase2-p2a-candidate-stage-train-audit/2",
    split: "train",
    labelSplitsRead: ["train"],
    labelsRead: true,
    sourceOnlyPredictionArtifact: true,
    pinnedGenerator: replayManifest.candidateGeneratorVersion,
    denominators: {
      sourcePredictionSites: observations.length,
      allConfirmedEligibleSites: metrics.allConfirmedEligibleSiteCount,
      uniqueMappablePositiveSites: metrics.uniqueMappablePositiveSiteCount,
      uniqueMappablePositiveTargetOccurrences:
        metrics.uniqueMappablePositiveTargetOccurrenceCount,
      ambiguousPositiveTargetOccurrences:
        metrics.ambiguousPositiveTargetOccurrenceCount,
      unmappedPositiveTargetOccurrences:
        metrics.unmappedPositiveTargetOccurrenceCount,
    },
    inputScope: {
      labelRowsRequested: sampleIds.size,
      labelRowsReturned: labels.length,
      allFactRowsUsedForSourceMapping: facts.length,
      snapshotScopedOracleAliases: oracleMappingProvenance.uniqueAliasCount,
      snapshotScopedAllAliases: oracleMappingProvenance.allAliasCount,
      oracleMappingScope: oracleMappingProvenance.scope,
    },
    metrics,
    provenance: {
      predictionPath: path.relative(root, predictionsPath),
      predictionSha256: predictionFileSha256,
      predictionManifestSha256: sha256(readFileSync(predictionManifestPath)),
      candidateStageReplayManifestPath: path.relative(root, replayManifestPath),
      candidateStageReplayManifestSha256: sha256(
        readFileSync(replayManifestPath),
      ),
      candidateStageEvidencePath: path.relative(root, evidencePath),
      candidateStageEvidenceSha256: evidenceSha256,
      candidateStageReplayInputFingerprint: sourceEvidenceHash,
      trainSampleIdsHash: replayManifest.trainSampleIdsHash,
      trainLabelsHash: labelsHash,
      sourceInputHashes: sourceHashes,
      correctedFactsSha256: replayManifest.pinnedV4.correctedFactsSha256,
      candidateGeneratorVersion: replayManifest.candidateGeneratorVersion,
      pinnedV4ImplementationHash: replayManifest.pinnedV4.implementationHash,
      configurationHash: replayManifest.pinnedV4.configurationHash,
      oracleMappingHash,
      evaluationCodeHash: evaluationCode.hash,
      evaluationCodeFiles: evaluationCode.files,
      inputFingerprint,
    },
    interpretation: {
      rankingOrThresholdRecomputed: false,
      candidateGeneratorChanged: false,
      productionBehaviorChanged: false,
      testCalibrationTemporalLabelsRead: false,
      unsupportedOrUnknownCallShapesRemainInAllEligibleSiteDenominators: true,
      recallUsesUniqueMappablePositiveTargetOccurrences: true,
      zeroCandidateRatesUseAllConfirmedEligibleSites: true,
    },
  };
  const outputPath = path.join(
    root,
    OUTPUT_DIRECTORY,
    "candidate-stage-train-summary.json",
  );
  writeJson(outputPath, output);
  console.info(
    `[phase2-p2a] TRAIN candidate-stage audit: ${metrics.allConfirmedEligibleSiteCount} eligible sites, ${metrics.uniqueMappablePositiveTargetOccurrenceCount} unique-mappable positive target occurrences; summary ${path.relative(root, outputPath)} (${sha256(readFileSync(outputPath))}).`,
  );
  console.info(
    `[phase2-p2a] TRAIN raw recall=${metrics.stages.rawGeneratedKeys.overall.candidateRecall}; mapped recall=${metrics.stages.mappedGeneratedTargetIds.overall.candidateRecall}; proposal recall=${metrics.stages.orderedEvidenceProposals.overall.candidateRecall}.`,
  );
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
