import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CallResolutionHypothesisService } from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import {
  assertCandidateStageTrainScope,
  assertV4ObservationDecisionEquivalent,
  candidateObservationDecisionFingerprint,
  type CandidateStageEvidence,
} from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import type { Phase2EvaluationObservation } from "./phase2-tiered-call-resolution-evaluation.mjs";
import type { ProposalFilterStageEvidence } from "./phase2-tiered-call-resolution-proposal-filter-stage-evidence.mjs";
import {
  allFactRows,
  allSourceRows,
  canonicalHash,
  PHASE2_CORPUS,
  PHASE2_DEFAULT_REPOSITORIES,
  PHASE2_PHASE1_PARITY,
  PHASE2_ROOT,
  readJson,
  sha256,
  verifyPhase1SourceSidecars,
  writeJson,
  writeJsonl,
} from "./phase2-tiered-call-resolution-support.mjs";
import {
  makeAstProcessor,
  processPhase2Snapshot,
  type Phase2PinnedSnapshot,
} from "./phase2-tiered-call-resolution-source.mjs";

const PINNED_V4_PREDICTIONS_SHA256 =
  "6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622";
const PINNED_V4_IMPLEMENTATION_HASH =
  "f51c86da6dc003082a3dc5e4015d45e60e25696fa694912e782d92b57b247182";
const PINNED_CALLSITES_SHA256 =
  "b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362";
const PINNED_FACTS_SHA256 =
  "ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e";
const PINNED_V4_SOURCE_DIRECTORY =
  "phase2-p2a-direct-import-alias-final-source-reproduction";
const REPLAY_OUTPUT_DIRECTORY = "phase2-p2a-v4-train-candidate-stage-replay";
const PROPOSAL_FILTER_REPLAY_OUTPUT_DIRECTORY =
  "phase2-p2a-v4-train-proposal-filter-stage-replay";
const PINNED_V4_SOURCE_FILE =
  "scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts";

interface CandidatePredictionManifest {
  readonly schemaVersion: 2;
  readonly measurement: "phase2-p2a-candidate-predictions/2";
  readonly candidateOracleMappingScope: "snapshotId+repoId";
  readonly predictionRows: number;
  readonly predictionSha256: string;
  readonly correctedFactsSha256: string;
  readonly implementationHash: string;
  readonly implementationFiles: Readonly<Record<string, string>>;
  readonly candidateGeneratorVersion: string;
  readonly splitCounts: Readonly<Record<string, number>>;
  readonly sourceInputHashes: Readonly<Record<string, string>>;
  readonly configurationHash: string;
  readonly labelsRead: false;
}

interface CollectionReport {
  readonly snapshots: readonly {
    readonly snapshotId: string;
    readonly repoId: string;
    readonly revision: string;
    readonly subtree: string | null;
    readonly snapshotHash: string;
  }[];
}

interface CorpusSpec {
  readonly snapshots: readonly {
    readonly snapshotId: string;
    readonly sourceDir: string;
    readonly subtree: string | null;
  }[];
}

interface ReplayOptions {
  readonly repositoriesDirectory: string;
  readonly outputDirectory: string;
  readonly includeProposalFilterStages: boolean;
}

interface ReplayRow {
  readonly sampleId: string;
  readonly split: "train";
  readonly pinnedV4DecisionSha256: string;
  readonly replayedDecisionSha256: string;
  readonly decisionFieldsEquivalent: true;
  readonly candidateStages: CandidateStageEvidence;
  readonly proposalFilterStages?: ProposalFilterStageEvidence;
}

const PINNED_V4_PREDICTION_PATH = path.join(
  PHASE2_ROOT,
  "evaluate/results/semantic-corpus/v1",
  PINNED_V4_SOURCE_DIRECTORY,
  "predictions.jsonl",
);
const PINNED_V4_MANIFEST_PATH = path.join(
  PHASE2_ROOT,
  "evaluate/results/semantic-corpus/v1",
  PINNED_V4_SOURCE_DIRECTORY,
  "candidate-prediction-manifest.json",
);

function parseOptions(argv: readonly string[]): ReplayOptions {
  const values = new Map<string, string>();
  let includeProposalFilterStages = false;
  for (let index = 0; index < argv.length;) {
    const key = argv[index];
    if (key === "--capture-proposal-filter-stages") {
      includeProposalFilterStages = true;
      index++;
      continue;
    }
    const value = argv[index + 1];
    if (
      !["--repos", "--out"].includes(key ?? "") ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(
        "Usage: phase2-tiered-call-resolution-candidate-stage-replay.mts [--repos <dir>] [--out <dir>] [--capture-proposal-filter-stages]",
      );
    values.set(key!, value);
    index += 2;
  }
  return {
    repositoriesDirectory: path.resolve(
      values.get("--repos") ?? PHASE2_DEFAULT_REPOSITORIES,
    ),
    outputDirectory: path.resolve(
      values.get("--out") ??
        path.join(
          PHASE2_CORPUS,
          includeProposalFilterStages
            ? PROPOSAL_FILTER_REPLAY_OUTPUT_DIRECTORY
            : REPLAY_OUTPUT_DIRECTORY,
        ),
    ),
    includeProposalFilterStages,
  };
}

function jsonLines<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function assertPinnedV4Inputs(
  predictionsBytes: Buffer,
  manifest: CandidatePredictionManifest,
): void {
  const predictionHash = sha256(predictionsBytes);
  if (
    manifest.schemaVersion !== 2 ||
    manifest.measurement !== "phase2-p2a-candidate-predictions/2" ||
    manifest.candidateOracleMappingScope !== "snapshotId+repoId" ||
    manifest.candidateGeneratorVersion !== "declared-member-hypothesis-v4" ||
    manifest.predictionSha256 !== PINNED_V4_PREDICTIONS_SHA256 ||
    predictionHash !== PINNED_V4_PREDICTIONS_SHA256 ||
    manifest.implementationHash !== PINNED_V4_IMPLEMENTATION_HASH ||
    manifest.correctedFactsSha256 !== PINNED_FACTS_SHA256 ||
    manifest.sourceInputHashes["callsites.jsonl"] !== PINNED_CALLSITES_SHA256 ||
    manifest.sourceInputHashes["declared-type-facts-pass-a.jsonl"] !==
      PINNED_FACTS_SHA256 ||
    manifest.labelsRead !== false
  )
    throw new Error(
      "Candidate-stage replay requires the pinned source-only v4 artifact.",
    );
}

function currentReplayImplementation(
  pinnedFiles: Readonly<Record<string, string>>,
): {
  readonly hash: string;
  readonly files: Readonly<Record<string, string>>;
  readonly allowedV4ImplementationDifferences: readonly {
    readonly file: string;
    readonly v4Sha256: string;
    readonly replaySha256: string;
    readonly reason: string;
  }[];
} {
  const root = PHASE2_ROOT;
  const currentFiles: Record<string, string> = {};
  const differences: string[] = [];
  const measurementOnlyChanges = new Set([
    PINNED_V4_SOURCE_FILE,
    "lib/core/src/semantic/call-resolution-hypothesis-ranking.ts",
    "lib/core/src/semantic/call-resolution-hypothesis.service.ts",
  ]);
  for (const [file, expected] of Object.entries(pinnedFiles).sort()) {
    const current = sha256(readFileSync(path.join(root, file)));
    currentFiles[file] = current;
    if (current !== expected && !measurementOnlyChanges.has(file))
      differences.push(file);
  }
  if (differences.length > 0)
    throw new Error(
      `Pinned v4 implementation differs at ${differences.join(", ")}.`,
    );
  for (const file of [
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-replay.mts",
    "scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evidence.mts",
  ])
    currentFiles[file] = sha256(readFileSync(path.join(root, file)));
  const allowedV4ImplementationDifferences = [...measurementOnlyChanges]
    .map((file) => ({
      file,
      v4Sha256: pinnedFiles[file],
      replaySha256: currentFiles[file],
      reason:
        "opt-in proposal-stage identity capture only; v4 decision fingerprints are compared for every TRAIN row",
    }))
    .filter(
      (difference) =>
        difference.v4Sha256 !== undefined &&
        difference.v4Sha256 !== difference.replaySha256,
    );
  if (allowedV4ImplementationDifferences.length === 0)
    throw new Error("Expected proposal-stage measurement instrumentation.");
  return {
    hash: canonicalHash(currentFiles),
    files: currentFiles,
    allowedV4ImplementationDifferences,
  };
}

function trainSnapshots(): Phase2PinnedSnapshot[] {
  const specification = readJson<CorpusSpec>(
    path.join(PHASE2_ROOT, "evaluate/semantic-corpus/corpus-spec.v1.json"),
  );
  const collection = readJson<CollectionReport>(
    path.join(PHASE2_CORPUS, "collection-report.json"),
  );
  const specById = new Map(
    specification.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]),
  );
  return collection.snapshots.map((row) => {
    const source = specById.get(row.snapshotId);
    if (!source || source.subtree !== row.subtree)
      throw new Error(`Pinned corpus spec mismatch for ${row.snapshotId}.`);
    return {
      snapshotId: row.snapshotId,
      repoId: row.repoId,
      revision: row.revision,
      subtree: row.subtree,
      sourceDir: source.sourceDir,
      snapshotHash: row.snapshotHash,
    };
  });
}

function groupedTrainRows<T extends { readonly snapshotId: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const group = grouped.get(row.snapshotId) ?? [];
    group.push(row);
    grouped.set(row.snapshotId, group);
  }
  return grouped;
}

function decisionFingerprintMap(
  rows: readonly Phase2EvaluationObservation[],
): Map<string, string> {
  return new Map(
    rows.map((row) => [
      row.sampleId,
      candidateObservationDecisionFingerprint(row),
    ]),
  );
}

async function replayTrainCandidateStages(
  options: ReplayOptions,
  manifest: CandidatePredictionManifest,
  observations: readonly Phase2EvaluationObservation[],
  inputHashes: Readonly<Record<string, string>>,
  implementation: ReturnType<typeof currentReplayImplementation>,
): Promise<void> {
  const trainObservations = observations
    .filter((row) => row.split === "train")
    .sort((left, right) => left.sampleId.localeCompare(right.sampleId));
  const expectedIds = new Set(trainObservations.map((row) => row.sampleId));
  if (
    trainObservations.length !== manifest.splitCounts.train ||
    expectedIds.size !== trainObservations.length
  )
    throw new Error("Pinned v4 TRAIN rows do not match their manifest.");

  const sourceRows = allSourceRows().filter((row) => row.split === "train");
  if (
    sourceRows.length !== expectedIds.size ||
    sourceRows.some((row) => !expectedIds.has(row.sampleId)) ||
    new Set(sourceRows.map((row) => row.sampleId)).size !== sourceRows.length
  )
    throw new Error("TRAIN source rows do not exactly match pinned v4 IDs.");

  const sourceBySnapshot = groupedTrainRows(sourceRows);
  const factRows = allFactRows();
  const service = new CallResolutionHypothesisService();
  const processor = makeAstProcessor();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "docuvia-stage-replay-"));
  const replayedObservations: Phase2EvaluationObservation[] = [];
  const stageEvidence: CandidateStageEvidence[] = [];
  const proposalFilterStageEvidence: ProposalFilterStageEvidence[] = [];
  const snapshotFingerprints: Record<string, string> = {};
  const snapshotFactRowCounts: Record<string, number> = {};
  const snapshotParseCounts: Record<
    string,
    { readonly callsiteFiles: number; readonly importTargetFiles: number }
  > = {};
  const configurations = new Set<string>();

  try {
    for (const snapshot of trainSnapshots()) {
      const snapshotRows = sourceBySnapshot.get(snapshot.snapshotId) ?? [];
      if (snapshotRows.length === 0) continue;
      const result = await processPhase2Snapshot({
        snapshot,
        repositoriesDirectory: options.repositoriesDirectory,
        temporaryDirectory: path.join(tempRoot, snapshot.snapshotId),
        sourceRows: snapshotRows,
        factRows: factRows.filter(
          (row) => row.snapshotId === snapshot.snapshotId,
        ),
        service,
        processor,
        factsSidecarHash: PINNED_FACTS_SHA256,
        includeCandidateStageEvidence: true,
        ...(options.includeProposalFilterStages
          ? { includeProposalFilterStageEvidence: true }
          : {}),
      });
      replayedObservations.push(...result.observations);
      stageEvidence.push(...(result.candidateStageEvidence ?? []));
      proposalFilterStageEvidence.push(
        ...(result.proposalFilterStageEvidence ?? []),
      );
      snapshotFingerprints[snapshot.snapshotId] = result.sourceFingerprint;
      snapshotFactRowCounts[snapshot.snapshotId] = result.sourceFactFileCount;
      snapshotParseCounts[snapshot.snapshotId] = {
        callsiteFiles: result.parsedCallFileCount,
        importTargetFiles: result.parsedImportTargetFileCount,
      };
      configurations.add(result.configurationHash);
      if (result.snapshotHash !== snapshot.snapshotHash)
        throw new Error(
          `Snapshot changed during replay: ${snapshot.snapshotId}.`,
        );
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const sortedReplay = replayedObservations.sort((left, right) =>
    left.sampleId.localeCompare(right.sampleId),
  );
  const sortedEvidence = stageEvidence.sort((left, right) =>
    left.sampleId.localeCompare(right.sampleId),
  );
  const sortedProposalFilterEvidence = proposalFilterStageEvidence.sort(
    (left, right) => left.sampleId.localeCompare(right.sampleId),
  );
  assertCandidateStageTrainScope(trainObservations, sortedReplay);
  assertCandidateStageTrainScope(trainObservations, sortedEvidence);
  if (options.includeProposalFilterStages)
    assertCandidateStageTrainScope(
      trainObservations,
      sortedProposalFilterEvidence,
    );
  if (
    configurations.size !== 1 ||
    !configurations.has(manifest.configurationHash)
  )
    throw new Error(
      "Source replay service configuration differs from pinned v4.",
    );

  const pinnedFingerprints = decisionFingerprintMap(trainObservations);
  const replayedFingerprints = decisionFingerprintMap(sortedReplay);
  const evidenceById = new Map(
    sortedEvidence.map((row) => [row.sampleId, row]),
  );
  const proposalFilterEvidenceById = new Map(
    sortedProposalFilterEvidence.map((row) => [row.sampleId, row]),
  );
  const replayedById = new Map(sortedReplay.map((row) => [row.sampleId, row]));
  const replayRows: ReplayRow[] = trainObservations.map((pinned) => {
    const replayed = replayedById.get(pinned.sampleId);
    const evidence = evidenceById.get(pinned.sampleId);
    const proposalFilterStages = proposalFilterEvidenceById.get(
      pinned.sampleId,
    );
    if (!replayed || !evidence)
      throw new Error(`TRAIN replay evidence missing for ${pinned.sampleId}.`);
    if (options.includeProposalFilterStages && !proposalFilterStages)
      throw new Error(
        `TRAIN proposal-filter evidence missing for ${pinned.sampleId}.`,
      );
    try {
      assertV4ObservationDecisionEquivalent(pinned, replayed);
    } catch (error) {
      throw new Error(`Decision mismatch at ${pinned.sampleId}.`, {
        cause: error,
      });
    }
    if (
      evidence.generatedCandidateKeys.length !==
        pinned.generatedCandidateCount ||
      evidence.orderedEvidenceProposals.length !==
        pinned.proposedCandidateCount ||
      JSON.stringify(evidence.mappedCandidateTargetIds) !==
        JSON.stringify(pinned.candidateTargetIds) ||
      (proposalFilterStages !== undefined &&
        (JSON.stringify(
          proposalFilterStages.stages
            .find(({ stage }) => stage === "beforeVisibility")
            ?.candidateKeys.slice()
            .sort(),
        ) !== JSON.stringify(evidence.generatedCandidateKeys.slice().sort()) ||
          JSON.stringify(
            proposalFilterStages.stages.find(
              ({ stage }) => stage === "afterMaxCandidates",
            )?.candidateKeys,
          ) !==
            JSON.stringify(
              evidence.orderedEvidenceProposals.map(
                ({ targetKey }) => targetKey,
              ),
            )))
    )
      throw new Error(
        `Candidate stage count or membership mismatch at ${pinned.sampleId}.`,
      );
    return {
      sampleId: pinned.sampleId,
      split: "train",
      pinnedV4DecisionSha256: pinnedFingerprints.get(pinned.sampleId)!,
      replayedDecisionSha256: replayedFingerprints.get(pinned.sampleId)!,
      decisionFieldsEquivalent: true,
      candidateStages: evidence,
      ...(proposalFilterStages ? { proposalFilterStages } : {}),
    };
  });

  mkdirSync(options.outputDirectory, { recursive: true });
  const outputPath = path.join(
    options.outputDirectory,
    options.includeProposalFilterStages
      ? "proposal-filter-stage-evidence-train.jsonl"
      : "candidate-stage-evidence-train.jsonl",
  );
  writeJsonl(outputPath, replayRows);
  const outputSha256 = sha256(readFileSync(outputPath));
  const trainSampleIdsHash = canonicalHash(
    trainObservations.map((row) => row.sampleId),
  );
  const decisionProofHash = canonicalHash(
    replayRows.map((row) => ({
      sampleId: row.sampleId,
      pinnedV4DecisionSha256: row.pinnedV4DecisionSha256,
      replayedDecisionSha256: row.replayedDecisionSha256,
    })),
  );
  const inputFingerprint = canonicalHash({
    predictionSha256: manifest.predictionSha256,
    sourceInputHashes: inputHashes,
    correctedFactsSha256: manifest.correctedFactsSha256,
    candidateGeneratorVersion: manifest.candidateGeneratorVersion,
    pinnedV4ImplementationHash: manifest.implementationHash,
    replayImplementationHash: implementation.hash,
    trainSampleIdsHash,
    snapshotParseCounts,
    snapshotFactRowCounts,
    snapshotFingerprints,
    configurationHash: manifest.configurationHash,
    proposalFilterStageCapture: options.includeProposalFilterStages,
  });
  writeJson(path.join(options.outputDirectory, "manifest.json"), {
    schemaVersion: 1,
    measurement: options.includeProposalFilterStages
      ? "phase2-p2a-proposal-filter-stage-replay/1"
      : "phase2-p2a-candidate-stage-replay/1",
    split: "train",
    labelSplitsRead: [],
    labelsRead: false,
    candidateGenerationReplayed: true,
    corpusRecollected: false,
    declaredFactsRebuilt: false,
    callShapeInputsReparsed: true,
    callsiteFilesParsed: Object.values(snapshotParseCounts).reduce(
      (count, row) => count + row.callsiteFiles,
      0,
    ),
    importTargetFilesParsed: Object.values(snapshotParseCounts).reduce(
      (count, row) => count + row.importTargetFiles,
      0,
    ),
    snapshotParseCounts,
    snapshotFactRowCounts,
    pinnedFactsRowsLoaded: factRows.length,
    verifiedTrainSnapshotFacts: Object.values(snapshotFactRowCounts).reduce(
      (count, row) => count + row,
      0,
    ),
    trainSampleIds: expectedIds.size,
    trainSampleIdsHash,
    candidateGeneratorVersion: manifest.candidateGeneratorVersion,
    pinnedV4: {
      predictionsPath: path.relative(PHASE2_ROOT, PINNED_V4_PREDICTION_PATH),
      predictionSha256: manifest.predictionSha256,
      implementationHash: manifest.implementationHash,
      implementationFiles: manifest.implementationFiles,
      sourceInputHashes: manifest.sourceInputHashes,
      correctedFactsSha256: manifest.correctedFactsSha256,
      configurationHash: manifest.configurationHash,
    },
    replay: {
      implementationHash: implementation.hash,
      implementationFiles: implementation.files,
      allowedV4ImplementationDifferences:
        implementation.allowedV4ImplementationDifferences,
      snapshotFingerprints,
      configurationHash: manifest.configurationHash,
    },
    decisions: {
      comparedDecisionFields: [
        "sampleId",
        "split",
        "duplicateGroup",
        "repoFamily",
        "snapshotId",
        "repoId",
        "calleeKind",
        "ruleSignature",
        "candidateTargetIds",
        "topTargetId",
        "topRankScore",
        "tied",
        "candidateSetComplete",
        "truncated",
        "unsupportedCallShape",
        "generatedCandidateCount",
        "ambiguousCandidateMappingCount",
        "unmappedGeneratedCandidateCount",
        "proposedCandidateCount",
        "reason",
      ],
      equivalentTrainRows: replayRows.length,
      totalTrainRows: trainObservations.length,
      allEquivalent: replayRows.length === trainObservations.length,
      decisionProofHash,
    },
    provenance: {
      sourceInputHashes: inputHashes,
      outputPath: path.relative(PHASE2_ROOT, outputPath),
      outputSha256,
      inputFingerprint,
    },
  });
  console.info(
    `[phase2-p2a] TRAIN ${options.includeProposalFilterStages ? "proposal-filter" : "candidate-stage"} replay preserved ${replayRows.length} v4 decisions; wrote ${outputPath} (${outputSha256}).`,
  );
}

async function run(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const predictionsBytes = readFileSync(PINNED_V4_PREDICTION_PATH);
  const manifest = readJson<CandidatePredictionManifest>(
    PINNED_V4_MANIFEST_PATH,
  );
  assertPinnedV4Inputs(predictionsBytes, manifest);
  const inputHashes = verifyPhase1SourceSidecars();
  for (const [name, pinned] of Object.entries(manifest.sourceInputHashes))
    if (inputHashes[name] !== pinned)
      throw new Error(`Pinned source input changed for ${name}.`);
  if (
    inputHashes["callsites.jsonl"] !== PINNED_CALLSITES_SHA256 ||
    inputHashes["declared-type-facts-pass-a.jsonl"] !== PINNED_FACTS_SHA256
  )
    throw new Error("Candidate-stage replay source/facts hashes changed.");
  const implementation = currentReplayImplementation(
    manifest.implementationFiles,
  );
  const observations = jsonLines<Phase2EvaluationObservation>(
    PINNED_V4_PREDICTION_PATH,
  );
  if (observations.length !== manifest.predictionRows)
    throw new Error("Pinned v4 observation count differs from its manifest.");
  await replayTrainCandidateStages(
    options,
    manifest,
    observations,
    inputHashes,
    implementation,
  );
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
