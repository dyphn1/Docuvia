import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import {
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_RANKING_POLICY_VERSION,
} from "../../lib/contracts/src/index.js";
import { CallResolutionHypothesisService } from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import {
  buildCalibrationRecords,
  calibrationSourceSidecarHashes,
  evaluatePhase2Split,
  type CalibrationBuildResult,
  type Phase2EvaluationLabel,
  type Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import {
  canonicalHash,
  labelsForSplit,
  licensedPhase2CorpusInputs,
  PHASE2_CORPUS,
  PHASE2_DEFAULT_OUTPUT,
  PHASE2_DEFAULT_REPOSITORIES,
  PHASE2_PHASE1_PARITY,
  readJson,
  sha256,
  writeJson,
  writeJsonl,
} from "./phase2-tiered-call-resolution-support.mjs";
import {
  classifyEvaluationRowLicense,
  EVALUATION_LICENSE_POLICY_VERSION,
} from "./phase2-tiered-call-resolution-license-policy.mjs";
import {
  makeAstProcessor,
  processPhase2Snapshot,
  type Phase2PinnedSnapshot,
  type Phase2SnapshotSourceResult,
} from "./phase2-tiered-call-resolution-source.mjs";

const SOURCE_FILES = [
  "scripts/semantic-corpus/phase2-tiered-call-resolution-runner.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-support.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-evaluation.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-license-policy.mts",
  "scripts/semantic-corpus/phase0-tiered-call-resolution-support.mts",
  "scripts/semantic-corpus/phase0-tiered-call-resolution-replay.mts",
  "scripts/semantic-corpus/phase0-snapshot-safety.mts",
  "lib/core/src/ast/ast-worker.ts",
  "lib/core/src/ast/call-site-shape-facts.ts",
  "lib/ast-core/src/core/edge-computer.ts",
  "lib/contracts/src/interfaces/ast.interfaces.ts",
  "lib/core/src/ast/declared-type-facts.ts",
  "lib/core/src/semantic/call-resolution-hypothesis.service.ts",
  "lib/core/src/semantic/call-resolution-hypothesis-index.ts",
  "lib/core/src/semantic/call-resolution-hypothesis-ranking.ts",
  "lib/core/src/semantic/call-resolution-hypothesis-calibration.ts",
  "lib/core/src/semantic/call-resolution-hypothesis-internal.ts",
  "lib/contracts/src/interfaces/call-resolution-hypothesis.interfaces.ts",
  "lib/contracts/src/interfaces/call-site-shape-facts.interfaces.ts",
  "lib/contracts/src/interfaces/declared-type-facts.interfaces.ts",
].sort();

interface Phase2RunOptions {
  readonly repositoriesDirectory: string;
  readonly outputDirectory: string;
  readonly predictionsOnly: boolean;
}

interface CorpusSpecSnapshot {
  readonly snapshotId: string;
  readonly sourceDir: string;
  readonly subtree: string | null;
}

interface CollectionSnapshot {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly snapshotHash: string;
}

function parseOptions(argv: readonly string[]): Phase2RunOptions {
  const values = new Map<string, string>();
  let predictionsOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--predictions-only") {
      predictionsOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (
      !["--repos", "--out"].includes(key ?? "") ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(
        "Usage: phase2-tiered-call-resolution-runner.mts [--repos <dir>] [--out <dir>] [--predictions-only]",
      );
    values.set(key!, value);
    index++;
  }
  return {
    repositoriesDirectory: path.resolve(
      values.get("--repos") ?? PHASE2_DEFAULT_REPOSITORIES,
    ),
    outputDirectory: path.resolve(values.get("--out") ?? PHASE2_DEFAULT_OUTPUT),
    predictionsOnly,
  };
}

function implementationFingerprint(): {
  readonly hash: string;
  readonly files: Readonly<Record<string, string>>;
} {
  const files: Record<string, string> = {};
  const digest = createHash("sha256");
  for (const file of SOURCE_FILES) {
    const bytes = readFileSync(
      path.resolve(import.meta.dirname, "../..", file),
    );
    files[file] = sha256(bytes);
    digest.update(file).update("\0").update(bytes).update("\0");
  }
  return { hash: digest.digest("hex"), files };
}

function snapshotsForCorpus(): Phase2PinnedSnapshot[] {
  const specification = readJson<{
    snapshots: readonly CorpusSpecSnapshot[];
  }>(
    path.join(
      import.meta.dirname,
      "../../evaluate/semantic-corpus/corpus-spec.v1.json",
    ),
  );
  const collection = readJson<{
    snapshots: readonly CollectionSnapshot[];
  }>(path.join(PHASE2_CORPUS, "collection-report.json"));
  const allowedSnapshots = collection.snapshots.filter(
    (row) => classifyEvaluationRowLicense({ repoId: row.repoId }) === "allowed",
  );
  const specById = new Map(
    specification.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]),
  );
  return allowedSnapshots.map((row) => {
    const source = specById.get(row.snapshotId);
    if (!source) throw new Error(`Corpus spec missing ${row.snapshotId}.`);
    if (source.subtree !== row.subtree)
      throw new Error(`Pinned subtree mismatch for ${row.snapshotId}.`);
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

function groupedBySnapshot<T extends { readonly snapshotId: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const group = result.get(row.snapshotId) ?? [];
    group.push(row);
    result.set(row.snapshotId, group);
  }
  return result;
}

function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))
  ]!;
}

function labelsForObservations(
  split: string,
  observations: readonly Phase2EvaluationObservation[],
): Phase2EvaluationLabel[] {
  const ids = new Set(
    observations
      .filter((observation) => observation.split === split)
      .map((observation) => observation.sampleId),
  );
  return labelsForSplit(split, ids);
}

function calibrationFingerprint(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  inputHashes: Readonly<Record<string, string>>,
  implementationHash: string,
  configurationHash: string,
): string {
  return canonicalHash({
    split: "calibration",
    observations: observations
      .filter((row) => row.split === "calibration")
      .map((row) => ({
        sampleId: row.sampleId,
        ruleSignature: row.ruleSignature,
        candidateTargetIds: row.candidateTargetIds,
        topTargetId: row.topTargetId,
        topRankScore: row.topRankScore,
        tied: row.tied,
        candidateSetComplete: row.candidateSetComplete,
        truncated: row.truncated,
        unsupportedCallShape: row.unsupportedCallShape,
      })),
    labels: [...labels]
      .map((row) => ({
        sampleId: row.sampleId,
        duplicateGroup: row.duplicateGroup,
        repoFamily: row.repoFamily,
        positiveTargetIds: row.positiveTargetIds,
        reviewStatus: row.reviewStatus,
      }))
      .sort((left, right) => left.sampleId.localeCompare(right.sampleId)),
    inputHashes,
    implementationHash,
    configurationHash,
  });
}

function calibrationSummary(build: CalibrationBuildResult) {
  return {
    signatureCount: build.signatures.length,
    calibratedSignatureCount: build.records.length,
    failedSignatureCount: build.signatures.length - build.records.length,
    failureReasons: Object.fromEntries(
      [
        "insufficient-independent-groups",
        "confidence-bound-below-target",
        "family-macro-below-target",
        "no-ranked-candidate",
      ].map((reason) => [
        reason,
        build.signatures.filter((result) => result.reason === reason).length,
      ]),
    ),
    signatures: build.signatures,
  };
}

function codeVersion(): { readonly node: string; readonly typescript: string } {
  return { node: process.version, typescript: ts.version };
}

function sourceSummary(results: readonly Phase2SnapshotSourceResult[]) {
  return {
    snapshots: results.map((result) => ({
      snapshotId: result.snapshotId,
      snapshotHash: result.snapshotHash,
      sourceFingerprint: result.sourceFingerprint,
      sourceFactFileCount: result.sourceFactFileCount,
      sourceIndexComplete: result.sourceIndexComplete,
      ownerInventoryCount: result.ownerInventoryCount,
      incompleteOwnerInventoryCount: result.incompleteOwnerInventoryCount,
      callShapeMappedCount: result.callShapeMappedCount,
      callShapeMissingCount: result.callShapeMissingCount,
      generatedCandidateCount: result.generatedCandidateCount,
      unmappedCandidateCount: result.unmappedCandidateCount,
      ambiguousCandidateMappingCount: result.ambiguousCandidateMappingCount,
      parsedCallFileCount: result.parsedCallFileCount,
      parsedImportTargetFileCount: result.parsedImportTargetFileCount,
      parsedExportSourceFileCount: result.parsedExportSourceFileCount,
      parseFailureCount: result.parseFailureCount,
      parseWallMs: result.parseWallMs,
      hypothesisWallMs: result.hypothesisWallMs,
    })),
    sourceFactFileCount: results.reduce(
      (sum, result) => sum + result.sourceFactFileCount,
      0,
    ),
    sourceIndexComplete: results.every((result) => result.sourceIndexComplete),
    ownerInventoryCount: results.reduce(
      (sum, result) => sum + result.ownerInventoryCount,
      0,
    ),
    incompleteOwnerInventoryCount: results.reduce(
      (sum, result) => sum + result.incompleteOwnerInventoryCount,
      0,
    ),
    callShapeMappedCount: results.reduce(
      (sum, result) => sum + result.callShapeMappedCount,
      0,
    ),
    callShapeMissingCount: results.reduce(
      (sum, result) => sum + result.callShapeMissingCount,
      0,
    ),
    generatedCandidateCount: results.reduce(
      (sum, result) => sum + result.generatedCandidateCount,
      0,
    ),
    unmappedCandidateCount: results.reduce(
      (sum, result) => sum + result.unmappedCandidateCount,
      0,
    ),
    ambiguousCandidateMappingCount: results.reduce(
      (sum, result) => sum + result.ambiguousCandidateMappingCount,
      0,
    ),
    parsedCallFileCount: results.reduce(
      (sum, result) => sum + result.parsedCallFileCount,
      0,
    ),
    parsedImportTargetFileCount: results.reduce(
      (sum, result) => sum + result.parsedImportTargetFileCount,
      0,
    ),
    parsedExportSourceFileCount: results.reduce(
      (sum, result) => sum + result.parsedExportSourceFileCount,
      0,
    ),
    parseFailureCount: results.reduce(
      (sum, result) => sum + result.parseFailureCount,
      0,
    ),
    parseWallMs: results.reduce((sum, result) => sum + result.parseWallMs, 0),
    hypothesisWallMs: results.reduce(
      (sum, result) => sum + result.hypothesisWallMs,
      0,
    ),
    hypothesisLatencyP50Ms: quantile(
      results.flatMap((result) => result.hypothesisLatenciesMs),
      0.5,
    ),
    hypothesisLatencyP95Ms: quantile(
      results.flatMap((result) => result.hypothesisLatenciesMs),
      0.95,
    ),
  };
}

async function run(options: Phase2RunOptions): Promise<void> {
  const started = performance.now();
  const licensedInputs = licensedPhase2CorpusInputs();
  const inputHashes = licensedInputs.sourceInputHashes;
  const implementation = implementationFingerprint();
  const sourceRows = licensedInputs.sourceRows;
  const factRows = licensedInputs.factRows;
  const snapshots = snapshotsForCorpus();
  const snapshotIds = new Set(snapshots.map(({ snapshotId }) => snapshotId));
  if (
    sourceRows.some((row) => !snapshotIds.has(row.snapshotId)) ||
    factRows.some((row) => !snapshotIds.has(row.snapshotId))
  )
    throw new Error(
      "Licensed source rows reference an unavailable corpus snapshot.",
    );
  console.info(
    `[phase2-license] excluded source samples: repository=${licensedInputs.excludedRepositorySampleCount}, enterprise-path=${licensedInputs.excludedEnterprisePathSampleCount}`,
  );
  const sourceBySnapshot = groupedBySnapshot(sourceRows);
  const service = new CallResolutionHypothesisService();
  const processor = makeAstProcessor();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "docuvia-phase2-"));
  const results: Phase2SnapshotSourceResult[] = [];
  try {
    for (const snapshot of snapshots) {
      console.info(
        `[phase2] ${snapshot.snapshotId}: verify, parse calls, rank`,
      );
      const snapshotFacts = factRows.filter(
        (row) => row.snapshotId === snapshot.snapshotId,
      );
      const snapshotRows = sourceBySnapshot.get(snapshot.snapshotId) ?? [];
      const temporaryDirectory = path.join(tempRoot, snapshot.snapshotId);
      const result = await processPhase2Snapshot({
        snapshot,
        repositoriesDirectory: options.repositoriesDirectory,
        temporaryDirectory,
        sourceRows: snapshotRows,
        factRows: snapshotFacts,
        service,
        processor,
        factsSidecarHash: inputHashes["declared-type-facts-pass-a.jsonl"]!,
        includeConfiguredPathAliases: true,
        includeCombinedDefaultImportTargets: true,
      });
      results.push(result);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  const observations = results
    .flatMap((result) => result.observations)
    .sort((left, right) => left.sampleId.localeCompare(right.sampleId));
  const sourceIds = new Set(sourceRows.map((row) => row.sampleId));
  if (
    observations.length !== sourceRows.length ||
    observations.some((row) => !sourceIds.has(row.sampleId)) ||
    new Set(observations.map((row) => row.sampleId)).size !==
      observations.length
  )
    throw new Error(
      "Phase 2 predictions do not exactly cover the source denominator.",
    );

  writeJsonl(
    path.join(options.outputDirectory, "predictions.jsonl"),
    observations,
  );
  const configurationHash = results[0]?.configurationHash;
  if (
    !configurationHash ||
    results.some((row) => row.configurationHash !== configurationHash)
  )
    throw new Error(
      "Hypothesis service configuration changed across snapshots.",
    );
  if (options.predictionsOnly) {
    const splitCounts = Object.fromEntries(
      ["train", "calibration", "test", "temporal"].map((split) => [
        split,
        observations.filter((row) => row.split === split).length,
      ]),
    );
    const predictionsPath = path.join(
      options.outputDirectory,
      "predictions.jsonl",
    );
    writeJson(
      path.join(options.outputDirectory, "candidate-prediction-manifest.json"),
      {
        schemaVersion: 3,
        measurement: "phase2-p2a-candidate-predictions/3",
        licensePolicyVersion: EVALUATION_LICENSE_POLICY_VERSION,
        licenseInputScope: "licensed-source-rows-and-target-facts-only",
        candidateOracleMappingScope: "snapshotId+repoId",
        generatedAt: new Date().toISOString(),
        node: codeVersion().node,
        typescript: codeVersion().typescript,
        candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
        rankingPolicyVersion: CALL_RESOLUTION_RANKING_POLICY_VERSION,
        sourceRows: sourceRows.length,
        predictionRows: observations.length,
        splitCounts,
        predictionSha256: sha256(readFileSync(predictionsPath)),
        sourceInputHashes: inputHashes,
        correctedFactsSha256: inputHashes["declared-type-facts-pass-a.jsonl"],
        implementationHash: implementation.hash,
        implementationFiles: implementation.files,
        sourceFingerprints: results.map((row) => ({
          snapshotId: row.snapshotId,
          snapshotHash: row.snapshotHash,
          sourceFingerprint: row.sourceFingerprint,
        })),
        configurationHash,
        source: sourceSummary(results),
        labelsRead: false,
      },
    );
    console.info(
      `[phase2-p2a] source-only complete: ${observations.length} predictions, labels not read, ${Math.round(performance.now() - started)}ms`,
    );
    return;
  }
  const calibrationObservations = observations.filter(
    (row) => row.split === "calibration",
  );
  const calibrationLabels = labelsForObservations(
    "calibration",
    calibrationObservations,
  );
  const calibrationInputFingerprint = calibrationFingerprint(
    observations,
    calibrationLabels,
    calibrationSourceSidecarHashes(inputHashes),
    implementation.hash,
    configurationHash,
  );
  const calibration = buildCalibrationRecords(
    calibrationObservations,
    calibrationLabels,
    {
      configurationHash,
      calibrationInputFingerprint,
      minimumIndependentGroups: 100,
      minimumConfidenceLowerBound: 0.9,
      targetFamilyMacroTop1: 0.9,
    },
  );
  const calibrationRowsPath = path.join(
    options.outputDirectory,
    "calibration-records.jsonl",
  );
  writeJsonl(calibrationRowsPath, calibration.records);
  const calibrationArtifactHash = sha256(readFileSync(calibrationRowsPath));
  const frozenAt = new Date().toISOString();
  writeJson(path.join(options.outputDirectory, "calibration-freeze.json"), {
    schemaVersion: 1,
    split: "calibration",
    frozenAt,
    calibrationArtifactHash,
    calibrationInputFingerprint,
    configurationHash,
    implementationHash: implementation.hash,
  });

  const calibrationMetrics = evaluatePhase2Split(
    calibrationObservations,
    calibrationLabels,
    calibration.records,
    "calibration",
  );
  const testObservations = observations.filter((row) => row.split === "test");
  const testLabels = labelsForObservations("test", testObservations);
  const testMetrics = evaluatePhase2Split(
    testObservations,
    testLabels,
    calibration.records,
    "test",
  );
  const temporalObservations = observations.filter(
    (row) => row.split === "temporal",
  );
  const temporalLabels = labelsForObservations(
    "temporal",
    temporalObservations,
  );
  const temporalMetrics = evaluatePhase2Split(
    temporalObservations,
    temporalLabels,
    calibration.records,
    "temporal",
  );
  const phase1ParityChecksums = readJson<{
    outputs: Record<string, string>;
  }>(path.join(PHASE2_PHASE1_PARITY, "checksums.json"));
  const summary = {
    schemaVersion: 1,
    measurement: "phase2-tiered-call-resolution/1",
    measuredAt: new Date().toISOString(),
    node: codeVersion().node,
    typescript: codeVersion().typescript,
    corpus: {
      sourceRows: sourceRows.length,
      predictionRows: observations.length,
      splitCounts: Object.fromEntries(
        ["train", "calibration", "test", "temporal"].map((split) => [
          split,
          observations.filter((row) => row.split === split).length,
        ]),
      ),
    },
    inputs: {
      phase1Sidecars: inputHashes,
      correctedDeclaredFactsSha256:
        inputHashes["declared-type-facts-pass-a.jsonl"],
      correctedFactsPassBEqualsPassA:
        phase1ParityChecksums.outputs["declared-type-facts-pass-a.jsonl"] ===
        phase1ParityChecksums.outputs["declared-type-facts-pass-b.jsonl"],
      phase1FactsSummarySha256: phase1ParityChecksums.outputs["summary.json"],
      corpusManifestSha256: sha256(
        readFileSync(path.join(PHASE2_CORPUS, "corpus-manifest.json")),
      ),
      collectionReportSha256: sha256(
        readFileSync(path.join(PHASE2_CORPUS, "collection-report.json")),
      ),
      corpusSpecSha256: sha256(
        readFileSync(
          path.join(
            import.meta.dirname,
            "../../evaluate/semantic-corpus/corpus-spec.v1.json",
          ),
        ),
      ),
      implementationHash: implementation.hash,
      implementationFiles: implementation.files,
      sourceFingerprints: results.map((row) => ({
        snapshotId: row.snapshotId,
        snapshotHash: row.snapshotHash,
        sourceFingerprint: row.sourceFingerprint,
      })),
      configurationHash,
    },
    source: sourceSummary(results),
    calibration: {
      frozenAt,
      calibrationArtifactHash,
      calibrationInputFingerprint,
      thresholds: {
        minimumIndependentGroups: 100,
        minimumConfidenceLowerBound: 0.9,
        targetFamilyMacroEndToEndTop1: 0.9,
        selection:
          "max accepted coverage among thresholds satisfying all gates",
      },
      build: calibrationSummary(calibration),
      metrics: calibrationMetrics,
    },
    heldOut: {
      calibrationArtifactHashUsed: calibrationArtifactHash,
      test: testMetrics,
      temporal: temporalMetrics,
    },
    operational: {
      lspRequestsLaunched: 0,
      serviceCalls: sourceSummary(results).callShapeMappedCount,
      elapsedWallMs: performance.now() - started,
      certification:
        "not-run; all data are previously seen regression evidence",
      tierBSkipEnabled: false,
    },
  };
  writeJson(path.join(options.outputDirectory, "summary.json"), summary);
  console.info(
    `[phase2] complete: ${observations.length} predictions, ${calibration.records.length} calibrated signatures, ${Math.round(performance.now() - started)}ms`,
  );
}

const options = parseOptions(process.argv.slice(2));
run(options).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
