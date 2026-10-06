import { readFileSync } from "node:fs";
import path from "node:path";
import {
  candidateOracleMappingProvenance,
  candidateOracleTargetMapping,
  filterInputsToUniqueOracleTargets,
} from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import {
  evaluateProposalFilterStageSplit,
  type ProposalFilterStageSplitMetrics,
} from "./phase2-tiered-call-resolution-proposal-filter-stage-evaluation.mjs";
import type { CandidateStageEvidence } from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import type { ProposalFilterStageEvidence } from "./phase2-tiered-call-resolution-proposal-filter-stage-evidence.mjs";
import {
  allFactRows,
  canonicalHash,
  labelsForSplitIsolated,
  readJson,
  sha256,
  verifyPhase1SourceSidecars,
  writeJson,
} from "./phase2-tiered-call-resolution-support.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPLAY_DIRECTORY = path.join(
  ROOT,
  "evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-proposal-filter-stage-replay",
);
const OUTPUT_DIRECTORY = path.join(
  ROOT,
  "evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-proposal-filter-stage-evaluation",
);

interface ReplayManifest {
  readonly schemaVersion: 1;
  readonly measurement: "phase2-p2a-proposal-filter-stage-replay/1";
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
  readonly decisions: {
    readonly equivalentTrainRows: number;
    readonly totalTrainRows: number;
    readonly allEquivalent: boolean;
    readonly decisionProofHash: string;
  };
  readonly provenance: {
    readonly sourceInputHashes: Readonly<Record<string, string>>;
    readonly outputPath: string;
    readonly outputSha256: string;
    readonly inputFingerprint: string;
  };
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
  readonly proposalFilterStages: ProposalFilterStageEvidence;
}

function rowsForSplit<T extends { readonly split: string }>(
  bytes: Buffer,
  split: string,
): T[] {
  const rows: T[] = [];
  for (const line of bytes.toString("utf8").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const match = /"split"\s*:\s*"([^"\\]*)"/u.exec(line);
    if (!match) throw new Error("Source prediction row has no split field.");
    if (match[1] !== split) continue;
    const row = JSON.parse(line) as T;
    if (row.split !== split)
      throw new Error("Source prediction row has conflicting split values.");
    rows.push(row);
  }
  return rows;
}

function implementationHashes(): {
  readonly files: Readonly<Record<string, string>>;
  readonly hash: string;
} {
  const files = [
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-replay.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evidence.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evaluation.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evaluation-runner.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-support.mts",
  ].sort();
  const hashes = Object.fromEntries(
    files.map((file) => [file, sha256(readFileSync(path.join(ROOT, file)))]),
  );
  return { files: hashes, hash: canonicalHash(hashes) };
}

function validateManifests(
  replay: ReplayManifest,
  prediction: PredictionManifest,
  predictionBytes: Buffer,
  replayBytes: Buffer,
  sourceHashes: Readonly<Record<string, string>>,
): void {
  if (
    replay.schemaVersion !== 1 ||
    replay.measurement !== "phase2-p2a-proposal-filter-stage-replay/1" ||
    replay.split !== "train" ||
    replay.labelsRead !== false ||
    replay.labelSplitsRead.length !== 0 ||
    replay.candidateGeneratorVersion !== "declared-member-hypothesis-v4" ||
    !replay.decisions.allEquivalent ||
    replay.decisions.equivalentTrainRows !== replay.trainSampleIds ||
    replay.decisions.totalTrainRows !== replay.trainSampleIds ||
    sha256(replayBytes) !== replay.provenance.outputSha256
  )
    throw new Error(
      "Proposal-stage replay is not a verified TRAIN-only v4 artifact.",
    );
  if (
    prediction.schemaVersion !== 2 ||
    prediction.measurement !== "phase2-p2a-candidate-predictions/2" ||
    prediction.candidateOracleMappingScope !== "snapshotId+repoId" ||
    prediction.labelsRead !== false ||
    prediction.candidateGeneratorVersion !== replay.candidateGeneratorVersion ||
    prediction.predictionSha256 !== replay.pinnedV4.predictionSha256 ||
    sha256(predictionBytes) !== replay.pinnedV4.predictionSha256 ||
    prediction.implementationHash !== replay.pinnedV4.implementationHash ||
    prediction.correctedFactsSha256 !== replay.pinnedV4.correctedFactsSha256 ||
    prediction.configurationHash !== replay.pinnedV4.configurationHash
  )
    throw new Error(
      "Pinned v4 source prediction bytes differ from replay provenance.",
    );
  for (const [name, hash] of Object.entries(replay.pinnedV4.sourceInputHashes))
    if (sourceHashes[name] !== hash)
      throw new Error(`Pinned Phase 1 source hash differs for ${name}.`);
  for (const [name, hash] of Object.entries(
    replay.provenance.sourceInputHashes,
  ))
    if (sourceHashes[name] !== hash)
      throw new Error(`Replay source hash differs for ${name}.`);
  if (
    sourceHashes["declared-type-facts-pass-a.jsonl"] !==
    replay.pinnedV4.correctedFactsSha256
  )
    throw new Error(
      "Replay facts do not use the corrected Phase 1 facts artifact.",
    );
}

function assertReplayRows(
  rows: readonly ReplayRow[],
  observations: readonly Phase2EvaluationObservation[],
  manifest: ReplayManifest,
): void {
  const observationById = new Map(
    observations.map((row) => [row.sampleId, row]),
  );
  const replayIds = new Set(rows.map((row) => row.sampleId));
  if (
    rows.length !== manifest.trainSampleIds ||
    replayIds.size !== rows.length ||
    rows.some((row) => {
      const observation = observationById.get(row.sampleId);
      return (
        row.split !== "train" ||
        !row.decisionFieldsEquivalent ||
        row.candidateStages.sampleId !== row.sampleId ||
        row.proposalFilterStages.sampleId !== row.sampleId ||
        !observation ||
        observation.split !== "train"
      );
    })
  )
    throw new Error(
      "Proposal-filter replay rows do not exactly cover TRAIN predictions.",
    );
}

function summarizeInputs(
  metrics: ProposalFilterStageSplitMetrics,
  sourcePredictionSites: number,
): Record<string, unknown> {
  return {
    sourcePredictionSites,
    allConfirmedEligibleSites: metrics.allConfirmedEligibleSiteCount,
    uniqueMappablePositiveSites: metrics.uniqueMappablePositiveSiteCount,
    uniqueMappablePositiveTargetOccurrences:
      metrics.uniqueMappablePositiveTargetOccurrenceCount,
    ambiguousPositiveTargetOccurrences:
      metrics.ambiguousPositiveTargetOccurrenceCount,
    unmappedPositiveTargetOccurrences:
      metrics.unmappedPositiveTargetOccurrenceCount,
  };
}

async function run(): Promise<void> {
  const replayManifestPath = path.join(REPLAY_DIRECTORY, "manifest.json");
  const replayManifest = readJson<ReplayManifest>(replayManifestPath);
  const predictionPath = path.join(
    ROOT,
    replayManifest.pinnedV4.predictionsPath,
  );
  const predictionBytes = readFileSync(predictionPath);
  const replayEvidencePath = path.join(
    ROOT,
    replayManifest.provenance.outputPath,
  );
  const replayBytes = readFileSync(replayEvidencePath);
  const predictionManifestPath = path.join(
    path.dirname(predictionPath),
    "candidate-prediction-manifest.json",
  );
  const predictionManifest = readJson<PredictionManifest>(
    predictionManifestPath,
  );
  const sourceHashes = verifyPhase1SourceSidecars();
  validateManifests(
    replayManifest,
    predictionManifest,
    predictionBytes,
    replayBytes,
    sourceHashes,
  );

  const observations = rowsForSplit<Phase2EvaluationObservation>(
    predictionBytes,
    "train",
  );
  const replayRows = rowsForSplit<ReplayRow>(replayBytes, "train");
  if (
    observations.length !== replayManifest.trainSampleIds ||
    new Set(observations.map((row) => row.sampleId)).size !==
      observations.length ||
    canonicalHash(
      observations
        .map((row) => row.sampleId)
        .sort((left, right) => left.localeCompare(right)),
    ) !== replayManifest.trainSampleIdsHash
  )
    throw new Error(
      "Pinned v4 predictions do not match the TRAIN sample-ID manifest.",
    );
  assertReplayRows(replayRows, observations, replayManifest);
  const sampleIds = new Set(observations.map((row) => row.sampleId));
  const labels: readonly Phase2EvaluationLabel[] = await labelsForSplitIsolated(
    "train",
    sampleIds,
  );
  if (
    labels.length !== sampleIds.size ||
    labels.some((row) => row.split !== "train")
  )
    throw new Error("TRAIN label loader returned missing or non-TRAIN rows.");

  const facts = allFactRows();
  const oracleMapping = candidateOracleTargetMapping(facts);
  const oracleProvenance = candidateOracleMappingProvenance(oracleMapping);
  const uniqueInputs = filterInputsToUniqueOracleTargets(
    observations,
    labels,
    oracleMapping,
  );
  const metrics = evaluateProposalFilterStageSplit({
    observations,
    candidateStages: replayRows.map((row) => row.candidateStages),
    evidence: replayRows.map((row) => row.proposalFilterStages),
    labels,
    uniqueInputs,
    split: "train",
  });
  const labelsHash = canonicalHash(
    [...labels].sort((left, right) =>
      left.sampleId.localeCompare(right.sampleId),
    ),
  );
  const implementation = implementationHashes();
  const inputFingerprint = canonicalHash({
    measurement: "phase2-p2a-proposal-filter-stage-train-evaluation/1",
    predictionSha256: sha256(predictionBytes),
    predictionManifestSha256: sha256(readFileSync(predictionManifestPath)),
    replayManifestSha256: sha256(readFileSync(replayManifestPath)),
    replayEvidenceSha256: sha256(replayBytes),
    replayInputFingerprint: replayManifest.provenance.inputFingerprint,
    sourceInputHashes: sourceHashes,
    correctedFactsSha256: replayManifest.pinnedV4.correctedFactsSha256,
    candidateGeneratorVersion: replayManifest.candidateGeneratorVersion,
    trainSampleIdsHash: replayManifest.trainSampleIdsHash,
    trainLabelsHash: labelsHash,
    oracleMappingHash: canonicalHash(oracleProvenance.hashInput),
    implementationHash: implementation.hash,
  });
  const output = {
    schemaVersion: 1,
    measurement: "phase2-p2a-proposal-filter-stage-train-evaluation/1",
    split: "train",
    labelSplitsRead: ["train"],
    labelsRead: true,
    sourceOnlyPredictionArtifact: true,
    generatorVersion: replayManifest.candidateGeneratorVersion,
    denominators: summarizeInputs(metrics, observations.length),
    stageSemantics: {
      candidateRecallDenominator:
        "uniquely-mappable confirmed positive target occurrences, joined by snapshotId+repoId source facts",
      zeroCandidateAndSetSizeDenominator:
        "all confirmed eligible sites, including unscorable targets and rows without call-shape evidence",
      rawCandidateKeys:
        "exact keys emitted by candidate generation before mapping; not interchangeable with mapped target IDs",
      proposalStages:
        "exact target-key sequences captured from the production filter path; ambiguous/unmapped keys remain counted but cannot cover a gold target",
      sizeQuantileConvention:
        "nearest-rank ceil(p*n)-1, over all confirmed eligible sites; candidateKeySize counts keys and uniqueMappedTargetSize counts unique IDs",
    },
    metrics,
    sourceScope: {
      factRowsLoaded: facts.length,
      snapshotScopedOracleAliases: oracleProvenance.uniqueAliasCount,
      snapshotScopedAllAliases: oracleProvenance.allAliasCount,
      oracleMappingScope: oracleProvenance.scope,
    },
    provenance: {
      predictionPath: path.relative(ROOT, predictionPath),
      predictionSha256: sha256(predictionBytes),
      predictionManifestSha256: sha256(readFileSync(predictionManifestPath)),
      replayManifestPath: path.relative(ROOT, replayManifestPath),
      replayManifestSha256: sha256(readFileSync(replayManifestPath)),
      replayEvidencePath: path.relative(ROOT, replayEvidencePath),
      replayEvidenceSha256: sha256(replayBytes),
      replayInputFingerprint: replayManifest.provenance.inputFingerprint,
      decisionProofHash: replayManifest.decisions.decisionProofHash,
      trainSampleIdsHash: replayManifest.trainSampleIdsHash,
      trainLabelsHash: labelsHash,
      sourceInputHashes: sourceHashes,
      correctedFactsSha256: replayManifest.pinnedV4.correctedFactsSha256,
      candidateGeneratorVersion: replayManifest.candidateGeneratorVersion,
      pinnedV4ImplementationHash: replayManifest.pinnedV4.implementationHash,
      configurationHash: replayManifest.pinnedV4.configurationHash,
      oracleMappingHash: canonicalHash(oracleProvenance.hashInput),
      implementationHash: implementation.hash,
      implementationFiles: implementation.files,
      inputFingerprint,
    },
    interpretation: {
      rankingOrThresholdRecomputed: false,
      filterOrderChanged: false,
      productionBehaviorChanged: false,
      calibrationTestTemporalLabelsRead: false,
      candidateSetCompletenessRequired: false,
      preCapEqualsPostArgumentShape: true,
      capIsRankedPrefixWithMaximum: 25,
      heldoutCertification: false,
    },
  };
  const outputPath = path.join(
    OUTPUT_DIRECTORY,
    "proposal-filter-stage-train-summary.json",
  );
  writeJson(outputPath, output);
  const outputHash = sha256(readFileSync(outputPath));
  const rawMetrics = metrics.stages.rawGeneratedKeys.overall;
  const finalMetrics = metrics.stages.afterMaxCandidates.overall;
  console.info(
    `[phase2-p2a] TRAIN proposal-filter audit: ${metrics.allConfirmedEligibleSiteCount} eligible sites; ${metrics.uniqueMappablePositiveTargetOccurrenceCount} mappable positive target occurrences; raw recall=${rawMetrics.coveredGoldTargetOccurrenceCount}/${rawMetrics.candidateGoldTargetOccurrenceCount}, final recall=${finalMetrics.coveredGoldTargetOccurrenceCount}/${finalMetrics.candidateGoldTargetOccurrenceCount}.`,
  );
  console.info(
    `[phase2-p2a] Raw-present misses=${metrics.dropAudit.rawPresentThenDroppedGoldTargetOccurrenceCount}; first-drop=${JSON.stringify(metrics.dropAudit.rawPresentThenDroppedByFirstStage)}; cap-dropped=${metrics.dropAudit.afterCapDroppedGoldTargetOccurrenceCount}; summary ${path.relative(ROOT, outputPath)} (${outputHash}).`,
  );
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
