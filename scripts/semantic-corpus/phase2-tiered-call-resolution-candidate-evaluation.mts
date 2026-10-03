import path from "node:path";
import { readFileSync } from "node:fs";
import {
  evaluateCandidateRecallSplit,
  type Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import {
  applyCallShapesFromCurrentPredictions,
  candidateOracleTargetMapping,
  compareGeneratedCandidateCounts,
  compareCandidateSets,
  filterInputsToUniqueOracleTargets,
  summarizeCandidateSetDistribution,
} from "./phase2-tiered-call-resolution-candidate-audit.mjs";
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

const ALLOWED_SPLITS = ["train", "calibration", "test", "temporal"] as const;
type EvaluationSplit = (typeof ALLOWED_SPLITS)[number];

interface CandidatePredictionManifest {
  readonly schemaVersion: 1;
  readonly measurement: "phase2-p2a-candidate-predictions/1";
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
    manifest.schemaVersion !== 1 ||
    manifest.measurement !== "phase2-p2a-candidate-predictions/1"
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
  const observations = allObservations.filter(
    (row) => row.split === options.split,
  );
  const sampleIds = new Set(observations.map((row) => row.sampleId));
  if (sampleIds.size !== observations.length)
    throw new Error("Candidate prediction split has duplicate sample IDs.");
  const labels = await labelsForSplitIsolated(options.split, sampleIds);
  const verifiedSourceHashes = verifyPhase1SourceSidecars();
  for (const [name, hash] of Object.entries(manifest.sourceInputHashes))
    if (verifiedSourceHashes[name] !== hash)
      throw new Error(`Candidate source input hash changed for ${name}.`);
  const oracleMapping = candidateOracleTargetMapping(allFactRows());
  const uniqueOracleAliasHash = canonicalHash(
    [...oracleMapping.uniquelyMappedAliases].sort(),
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
      };
    }>(baselineSummaryPath);
    if (
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
    baselineComparison = {
      baselineRuleVersion: "declared-member-hypothesis-v2",
      currentRuleVersion: manifest.candidateGeneratorVersion,
      baselineImplementationHash: baselineSummary.inputs.implementationHash,
      baselinePredictionSha256,
      commonSourceInputs: manifest.sourceInputHashes,
      commonCorrectedFactsSha256: manifest.correctedFactsSha256,
      commonLabelRowsHash: labelRowsHash,
      commonOracleAliasAllowlistHash: uniqueOracleAliasHash,
      commonUniqueOracleAliasCount: oracleMapping.uniquelyMappedAliases.size,
      callShapeGrouping:
        "current source-only prediction rows, joined by sampleId for both versions",
      baselineMetrics,
      currentMetrics: metrics,
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
        "Both versions are re-evaluated with the same current unique candidate-alias allowlist built from the pinned corrected facts. The unique-oracle denominator excludes positive aliases that are ambiguous or absent in those facts. Candidate-set sizes use raw generatedCandidateCount and include every confirmed site. Test and temporal splits are not part of this train/calibration comparison.",
    };
  }
  const result = {
    schemaVersion: 1,
    measurement: "phase2-p2a-candidate-recall/1",
    evaluatedAt: new Date().toISOString(),
    split: options.split,
    provenance: {
      predictionSha256: manifest.predictionSha256,
      labelRowsHash,
      correctedFactsSha256: manifest.correctedFactsSha256,
      sourceInputHashes: manifest.sourceInputHashes,
      implementationHash: manifest.implementationHash,
      candidateGeneratorVersion: manifest.candidateGeneratorVersion,
      uniqueOracleAliasAllowlistHash: uniqueOracleAliasHash,
      uniqueOracleAliasCount: oracleMapping.uniquelyMappedAliases.size,
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
  console.info(
    `[phase2-p2a] ${options.split}: ${metrics.coveredGoldTargetCount}/${metrics.candidateGoldTargetCount} unique-mappable positive-target occurrences covered across ${metrics.eligibleSiteCount} sites; raw zero-candidate sites ${candidateSetDistribution.overall.zeroCandidateSiteCount}/${candidateSetDistribution.overall.eligibleSiteCount}; candidate size p50/p95 ${candidateSetDistribution.overall.candidateSetSizeP50}/${candidateSetDistribution.overall.candidateSetSizeP95}; wrote ${outputPath}`,
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
