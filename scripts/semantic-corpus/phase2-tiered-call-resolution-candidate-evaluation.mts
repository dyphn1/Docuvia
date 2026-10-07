import path from "node:path";
import { readFileSync } from "node:fs";
import {
  evaluateCandidateRecallSplit,
  evaluateTierACandidateListRecall,
  type Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import {
  applyCallShapesFromCurrentPredictions,
  candidateOracleMappingProvenance,
  candidateOracleTargetMapping,
  compareGeneratedCandidateCounts,
  compareCandidateSets,
  filterInputsToUniqueOracleTargets,
  summarizeCandidateSetDistribution,
} from "./phase2-tiered-call-resolution-candidate-audit.mjs";
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

const MAPPING_IMPLEMENTATION_FILES = [
  "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts",
  "scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts",
].sort();

function mappingImplementationProvenance(): {
  readonly hash: string;
  readonly files: Readonly<Record<string, string>>;
} {
  const root = path.resolve(import.meta.dirname, "../..");
  const files = Object.fromEntries(
    MAPPING_IMPLEMENTATION_FILES.map((file) => [
      file,
      sha256(readFileSync(path.join(root, file))),
    ]),
  );
  return { hash: canonicalHash(files), files };
}

const ALLOWED_SPLITS = ["train", "calibration", "test", "temporal"] as const;
type EvaluationSplit = (typeof ALLOWED_SPLITS)[number];

interface CandidatePredictionManifest {
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
  readonly splitCounts: Readonly<Record<EvaluationSplit, number>>;
  readonly sourceInputHashes: Readonly<Record<string, string>>;
}

interface CandidateEvaluationOptions {
  readonly predictionsPath: string;
  readonly baselinePredictionsPath: string | null;
  readonly split: EvaluationSplit;
  readonly outputPath: string | null;
}

function parseOptions(argv: readonly string[]): CandidateEvaluationOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !["--predictions", "--baseline-predictions", "--split", "--out"].includes(
        key ?? "",
      ) ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(
        "Usage: phase2-tiered-call-resolution-candidate-evaluation.mts --predictions <file> --split <train|calibration|test|temporal> [--baseline-predictions <file>] [--out <file>]",
      );
    values.set(key!, value);
  }
  const predictionsPath = values.get("--predictions");
  const split = values.get("--split");
  if (
    !predictionsPath ||
    !split ||
    !ALLOWED_SPLITS.includes(split as EvaluationSplit)
  )
    throw new Error("A prediction artifact and supported split are required.");
  return {
    predictionsPath: path.resolve(predictionsPath),
    baselinePredictionsPath: values.has("--baseline-predictions")
      ? path.resolve(values.get("--baseline-predictions")!)
      : null,
    split: split as EvaluationSplit,
    outputPath: values.has("--out") ? path.resolve(values.get("--out")!) : null,
  };
}

async function run(options: CandidateEvaluationOptions): Promise<void> {
  const manifestPath = path.join(
    path.dirname(options.predictionsPath),
    "candidate-prediction-manifest.json",
  );
  const manifest = readJson<CandidatePredictionManifest>(manifestPath);
  if (
    manifest.schemaVersion !== 3 ||
    manifest.measurement !== "phase2-p2a-candidate-predictions/3" ||
    manifest.licensePolicyVersion !== EVALUATION_LICENSE_POLICY_VERSION ||
    manifest.licenseInputScope !==
      "licensed-source-rows-and-target-facts-only" ||
    manifest.candidateOracleMappingScope !== "snapshotId+repoId"
  )
    throw new Error("Unsupported candidate prediction manifest.");
  const predictionsBytesHash = sha256(readFileSync(options.predictionsPath));
  if (predictionsBytesHash !== manifest.predictionSha256)
    throw new Error("Candidate prediction bytes do not match their manifest.");
  const allObservations = readJsonl<Phase2EvaluationObservation>(
    options.predictionsPath,
  );
  if (allObservations.length !== manifest.predictionRows)
    throw new Error("Candidate prediction row count differs from manifest.");
  for (const row of allObservations) {
    if (!row.repoId || !row.callerFilePath)
      throw new Error(
        "Candidate prediction row lacks licensed source identity.",
      );
    assertEvaluationRowAllowed({
      repoId: row.repoId,
      callerFilePath: row.callerFilePath,
    });
    if (
      row.repoId.toLowerCase() === "github.com/nestjs/nest" &&
      row.revision?.startsWith("35142c3eca") &&
      (row.split === "train" || row.split === "calibration")
    )
      throw new Error("Regression-only Nest source reached candidate tuning.");
  }
  const sourceObservations = allObservations.filter(
    (row) => row.split === options.split,
  );
  const sampleIds = new Set(sourceObservations.map((row) => row.sampleId));
  if (sampleIds.size !== sourceObservations.length)
    throw new Error("Candidate prediction split has duplicate sample IDs.");
  if (
    sourceObservations.some(
      (row) =>
        row.snapshotId === undefined ||
        row.repoId === undefined ||
        row.callerFilePath === undefined,
    )
  )
    throw new Error(
      "Snapshot-scoped predictions require licensed source identities.",
    );
  const licensedInputs = licensedPhase2CorpusInputs();
  if (
    canonicalHash(licensedInputs.sourceInputHashes) !==
    canonicalHash(manifest.sourceInputHashes)
  )
    throw new Error(
      "Licensed source inputs changed after candidate prediction.",
    );
  const rawLabels = await labelsForSplitIsolated(options.split, sampleIds);
  const rawLabelsById = new Map(
    rawLabels.map((label) => [label.sampleId, label]),
  );
  const observations: Phase2EvaluationObservation[] = [];
  const labels: typeof rawLabels = [];
  let licenseExcludedEnterprisePathSampleCount = 0;
  for (const row of sourceObservations) {
    const label = rawLabelsById.get(row.sampleId);
    if (!label)
      throw new Error(`Missing ${options.split} label ${row.sampleId}.`);
    const targetFilePaths = label.positiveTargetIds.map((targetId) => {
      const separator = targetId.indexOf("#");
      return separator < 0 ? targetId : targetId.slice(0, separator);
    });
    const classification = classifyEvaluationRowLicense({
      repoId: row.repoId!,
      callerFilePath: row.callerFilePath!,
      targetFilePaths,
    });
    if (classification === "excluded-repository")
      throw new Error("Excluded repository reached candidate evaluation.");
    if (classification === "excluded-path") {
      licenseExcludedEnterprisePathSampleCount++;
      continue;
    }
    observations.push(row);
    labels.push(label);
  }
  assertEvaluationSplitLicenseAllowed(observations, labels);
  const oracleMapping = candidateOracleTargetMapping(licensedInputs.factRows);
  const oracleMappingProvenance =
    candidateOracleMappingProvenance(oracleMapping);
  const mappingImplementation = mappingImplementationProvenance();
  const uniqueOracleAliasHash = canonicalHash(
    oracleMappingProvenance.hashInput,
  );
  const currentUniqueInputs = filterInputsToUniqueOracleTargets(
    observations,
    labels,
    oracleMapping,
  );
  const metrics = evaluateCandidateRecallSplit(
    currentUniqueInputs.observations,
    currentUniqueInputs.labels,
    options.split,
  );
  const tierACandidateListRecall = evaluateTierACandidateListRecall(
    observations,
    labels,
    options.split,
  );
  const candidateSetDistribution = summarizeCandidateSetDistribution(
    currentUniqueInputs.observations,
    labels,
    options.split,
  );
  const labelRowsHash = canonicalHash(
    [...labels].sort((left, right) =>
      left.sampleId.localeCompare(right.sampleId),
    ),
  );
  let baselineComparison: Record<string, unknown> | undefined;
  if (options.baselinePredictionsPath) {
    const baselineSummaryPath = path.join(
      path.dirname(options.baselinePredictionsPath),
      "summary.json",
    );
    const baselineSummary = readJson<{
      readonly corpus?: {
        readonly predictionRows?: number;
        readonly splitCounts?: Partial<Record<EvaluationSplit, number>>;
      };
      readonly inputs?: {
        readonly phase1Sidecars?: Readonly<Record<string, string>>;
        readonly correctedDeclaredFactsSha256?: string;
        readonly implementationHash?: string;
        readonly licensePolicyVersion?: string;
      };
    }>(baselineSummaryPath);
    if (
      baselineSummary.inputs?.licensePolicyVersion !==
        EVALUATION_LICENSE_POLICY_VERSION ||
      baselineSummary.inputs?.phase1Sidecars?.["callsites.jsonl"] !==
        manifest.sourceInputHashes?.["callsites.jsonl"] ||
      baselineSummary.inputs?.correctedDeclaredFactsSha256 !==
        manifest.correctedFactsSha256 ||
      baselineSummary.corpus?.predictionRows !== manifest.predictionRows ||
      baselineSummary.corpus?.splitCounts?.[options.split] !==
        manifest.splitCounts[options.split]
    )
      throw new Error(
        "Baseline predictions do not share the current source, facts, and split denominator.",
      );

    const baselinePredictionSha256 = sha256(
      readFileSync(options.baselinePredictionsPath),
    );
    const baselineRows = readJsonl<Phase2EvaluationObservation>(
      options.baselinePredictionsPath,
    );
    if (baselineRows.length !== baselineSummary.corpus.predictionRows)
      throw new Error(
        "Baseline prediction row count differs from its summary.",
      );
    const baselineSplitRows = baselineRows.filter(
      (row) => row.split === options.split,
    );
    for (const row of baselineRows) {
      if (!row.repoId || !row.callerFilePath)
        throw new Error(
          "Baseline prediction row lacks licensed source identity.",
        );
      assertEvaluationRowAllowed({
        repoId: row.repoId,
        callerFilePath: row.callerFilePath,
      });
    }
    if (baselineSplitRows.length !== manifest.splitCounts[options.split])
      throw new Error(
        "Baseline split row count differs from current predictions.",
      );
    const baselineWithCurrentShapes = applyCallShapesFromCurrentPredictions(
      baselineSplitRows,
      observations,
    );
    const baselineUniqueInputs = filterInputsToUniqueOracleTargets(
      baselineWithCurrentShapes,
      labels,
      oracleMapping,
    );
    const baselineDistribution = summarizeCandidateSetDistribution(
      baselineUniqueInputs.observations,
      labels,
      options.split,
    );
    const baselineMetrics = evaluateCandidateRecallSplit(
      baselineUniqueInputs.observations,
      baselineUniqueInputs.labels,
      options.split,
    );
    const baselineTierACandidateListRecall = evaluateTierACandidateListRecall(
      baselineWithCurrentShapes,
      labels,
      options.split,
    );
    baselineComparison = {
      baselineRuleVersion: "declared-member-hypothesis-v2",
      currentRuleVersion: manifest.candidateGeneratorVersion,
      baselineImplementationHash: baselineSummary.inputs.implementationHash,
      baselinePredictionSha256,
      commonSourceInputs: manifest.sourceInputHashes,
      commonCorrectedFactsSha256: manifest.correctedFactsSha256,
      commonLabelRowsHash: labelRowsHash,
      commonSnapshotScopedOracleMappingHash: uniqueOracleAliasHash,
      commonUniqueOracleAliasCount: oracleMappingProvenance.uniqueAliasCount,
      commonCandidateOracleMappingImplementationHash:
        mappingImplementation.hash,
      callShapeGrouping:
        "current source-only prediction rows, joined by sampleId for both versions",
      baselineMetrics,
      currentMetrics: metrics,
      baselineTierACandidateListRecall,
      currentTierACandidateListRecall: tierACandidateListRecall,
      uniqueOracleTargetDomain: {
        baseline: {
          siteCount: baselineUniqueInputs.siteCount,
          rawCandidateSiteCount: baselineUniqueInputs.rawCandidateSiteCount,
          uniquelyMappedCandidateSiteCount:
            baselineUniqueInputs.uniquelyMappedCandidateSiteCount,
          sitesWithCandidatesButNoUniqueTargetCount:
            baselineUniqueInputs.sitesWithCandidatesButNoUniqueTargetCount,
          candidateAliasMembershipCountBeforeFiltering:
            baselineUniqueInputs.candidateAliasMembershipCountBeforeFiltering,
          uniqueCandidateMembershipCount:
            baselineUniqueInputs.uniqueCandidateMembershipCount,
          uniqueMappedPositiveTargetOccurrenceCount:
            baselineUniqueInputs.uniqueMappedPositiveTargetOccurrenceCount,
          ambiguousPositiveTargetOccurrenceCount:
            baselineUniqueInputs.ambiguousPositiveTargetOccurrenceCount,
          unmappedPositiveTargetOccurrenceCount:
            baselineUniqueInputs.unmappedPositiveTargetOccurrenceCount,
          uniqueMappedPositiveSiteCount:
            baselineUniqueInputs.uniqueMappedPositiveSiteCount,
          sitesWithoutUniquePositiveTargetCount:
            baselineUniqueInputs.sitesWithoutUniquePositiveTargetCount,
          droppedAmbiguousCandidateMembershipCount:
            baselineUniqueInputs.droppedAmbiguousCandidateMembershipCount,
          droppedUnmappedCandidateMembershipCount:
            baselineUniqueInputs.droppedUnmappedCandidateMembershipCount,
        },
        current: {
          siteCount: currentUniqueInputs.siteCount,
          rawCandidateSiteCount: currentUniqueInputs.rawCandidateSiteCount,
          uniquelyMappedCandidateSiteCount:
            currentUniqueInputs.uniquelyMappedCandidateSiteCount,
          sitesWithCandidatesButNoUniqueTargetCount:
            currentUniqueInputs.sitesWithCandidatesButNoUniqueTargetCount,
          candidateAliasMembershipCountBeforeFiltering:
            currentUniqueInputs.candidateAliasMembershipCountBeforeFiltering,
          uniqueCandidateMembershipCount:
            currentUniqueInputs.uniqueCandidateMembershipCount,
          uniqueMappedPositiveTargetOccurrenceCount:
            currentUniqueInputs.uniqueMappedPositiveTargetOccurrenceCount,
          ambiguousPositiveTargetOccurrenceCount:
            currentUniqueInputs.ambiguousPositiveTargetOccurrenceCount,
          unmappedPositiveTargetOccurrenceCount:
            currentUniqueInputs.unmappedPositiveTargetOccurrenceCount,
          uniqueMappedPositiveSiteCount:
            currentUniqueInputs.uniqueMappedPositiveSiteCount,
          sitesWithoutUniquePositiveTargetCount:
            currentUniqueInputs.sitesWithoutUniquePositiveTargetCount,
          droppedAmbiguousCandidateMembershipCount:
            currentUniqueInputs.droppedAmbiguousCandidateMembershipCount,
          droppedUnmappedCandidateMembershipCount:
            currentUniqueInputs.droppedUnmappedCandidateMembershipCount,
        },
      },
      comparison: compareCandidateSets(
        baselineUniqueInputs.observations,
        currentUniqueInputs.observations,
        currentUniqueInputs.labels,
        options.split,
      ),
      generatedCandidateCounts: compareGeneratedCandidateCounts(
        baselineSplitRows,
        observations,
        options.split,
      ),
      baselineCandidateSetDistribution: baselineDistribution,
      currentCandidateSetDistribution: candidateSetDistribution,
      interpretation:
        "Both versions are re-evaluated with the same snapshotId+repoId-scoped unique candidate-alias mapping built from the pinned corrected facts. The unique-oracle denominator excludes positive aliases that are ambiguous or absent within that source snapshot. Candidate-set sizes use raw generatedCandidateCount and include every confirmed site. Test and temporal splits are not part of this train/calibration comparison.",
    };
  }
  const result = {
    schemaVersion: 2,
    measurement: "phase2-p2b-candidate-list-recall/1",
    evaluatedAt: new Date().toISOString(),
    split: options.split,
    licenseExcludedEnterprisePathSampleCount,
    provenance: {
      licensePolicyVersion: EVALUATION_LICENSE_POLICY_VERSION,
      predictionSha256: manifest.predictionSha256,
      labelRowsHash,
      correctedFactsSha256: manifest.correctedFactsSha256,
      sourceInputHashes: manifest.sourceInputHashes,
      implementationHash: manifest.implementationHash,
      candidateGeneratorVersion: manifest.candidateGeneratorVersion,
      snapshotScopedOracleMappingHash: uniqueOracleAliasHash,
      uniqueOracleAliasCount: oracleMappingProvenance.uniqueAliasCount,
      candidateOracleMappingScope: oracleMappingProvenance.scope,
      candidateOracleMappingScopeCount:
        oracleMappingProvenance.hashInput.length,
      allOracleAliasCount: oracleMappingProvenance.allAliasCount,
      candidateOracleMappingImplementationHash: mappingImplementation.hash,
      candidateOracleMappingImplementationFiles: mappingImplementation.files,
    },
    candidateRecallDomain: {
      totalConfirmedPositiveSiteCount: labels.filter(
        (row) =>
          row.reviewStatus === "confirmed" && row.positiveTargetIds.length > 0,
      ).length,
      ...{
        uniqueMappedPositiveTargetOccurrenceCount:
          currentUniqueInputs.uniqueMappedPositiveTargetOccurrenceCount,
        ambiguousPositiveTargetOccurrenceCount:
          currentUniqueInputs.ambiguousPositiveTargetOccurrenceCount,
        unmappedPositiveTargetOccurrenceCount:
          currentUniqueInputs.unmappedPositiveTargetOccurrenceCount,
        uniqueMappedPositiveSiteCount:
          currentUniqueInputs.uniqueMappedPositiveSiteCount,
        sitesWithoutUniquePositiveTargetCount:
          currentUniqueInputs.sitesWithoutUniquePositiveTargetCount,
      },
    },
    metrics,
    tierACandidateListRecall,
    candidateSetDistribution,
    ...(baselineComparison ? { baselineComparison } : {}),
  };
  const outputPath =
    options.outputPath ??
    path.join(
      path.dirname(options.predictionsPath),
      `candidate-recall-${options.split}.json`,
    );
  writeJson(outputPath, result);
  const boundedProposalList = tierACandidateListRecall.boundedProposalList;
  console.info(
    `[phase2-p2b] ${options.split}: generated candidate-list recall ${tierACandidateListRecall.candidateCoveredSiteCount}/${tierACandidateListRecall.resolvedSiteCount}; family mean/worst ${(tierACandidateListRecall.familyMeanRecall ?? 0).toFixed(4)}/${(tierACandidateListRecall.worstFamilyRecall ?? 0).toFixed(4)}; size p50/p90/p99 ${tierACandidateListRecall.candidateListSize.p50}/${tierACandidateListRecall.candidateListSize.p90}/${tierACandidateListRecall.candidateListSize.p99}; single/multi/zero ${tierACandidateListRecall.singleCandidateSiteCount} (${(tierACandidateListRecall.singleCandidateSiteRate * 100).toFixed(2)}%)/${tierACandidateListRecall.multiCandidateSiteCount} (${(tierACandidateListRecall.multiCandidateSiteRate * 100).toFixed(2)}%)/${tierACandidateListRecall.zeroCandidateSiteCount}; correct singleton ${tierACandidateListRecall.correctSingleCandidateCount}/${tierACandidateListRecall.singleCandidateSiteCount}, precision ${(tierACandidateListRecall.singleCandidateAcceptedPrecision ?? 0).toFixed(4)}, no-LSP ${(tierACandidateListRecall.noLspResolvableRate * 100).toFixed(2)}%; bounded proposal recall ${boundedProposalList.candidateCoveredSiteCount}/${boundedProposalList.resolvedSiteCount}; bounded size p50/p90/p99 ${boundedProposalList.candidateListSize.p50}/${boundedProposalList.candidateListSize.p90}/${boundedProposalList.candidateListSize.p99}; bounded truncation ${boundedProposalList.truncatedSiteCount} (${(boundedProposalList.truncatedSiteRate * 100).toFixed(2)}%); wrote ${outputPath}`,
  );
  if (baselineComparison) {
    const comparison = baselineComparison.comparison as {
      readonly candidateRecallDelta: number;
      readonly addedCandidateMembershipCount: number;
      readonly newlyCoveredGoldTargetCount: number;
    };
    const generated = baselineComparison.generatedCandidateCounts as {
      readonly generatedCandidateCountDelta: number;
      readonly sitesWithFewerGeneratedCandidates: number;
    };
    console.info(
      `[phase2-p2a] v2→v3 ${options.split}: unique-oracle recall delta ${comparison.candidateRecallDelta}; added ${comparison.addedCandidateMembershipCount} memberships, newly covered ${comparison.newlyCoveredGoldTargetCount} gold targets; generated candidates ${generated.generatedCandidateCountDelta >= 0 ? "+" : ""}${generated.generatedCandidateCountDelta}, fewer sites ${generated.sitesWithFewerGeneratedCandidates}`,
    );
  }
}

run(parseOptions(process.argv.slice(2))).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
