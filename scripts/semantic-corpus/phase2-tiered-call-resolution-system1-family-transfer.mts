import { candidateOracleMappingForSource } from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import { reliabilityBinForProbability } from "./phase2-tiered-call-resolution-system1-confidence-calibration.mjs";
import {
  evaluateSystemOneSplit,
  selectSystemOne,
  type SystemOneOracleAliases,
  type SystemOneSplitMetrics,
} from "./phase2-tiered-call-resolution-system1-evaluation.mjs";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import { canonicalHash } from "./phase2-tiered-call-resolution-support.mjs";

const PROBABILITY_BIN_COUNT = 10;
const MINIMUM_MAP_GROUP_COUNT = 50;
const MINIMUM_MAP_SCORE_LEVEL_COUNT = 5;
const PROBABILITY_MAP_METHOD = "beta-smoothed-isotonic-v1";

interface IsotonicBlock {
  readonly firstScore: number;
  readonly lastScore: number;
  readonly weight: number;
  readonly successes: number;
}

interface IsotonicExample {
  readonly sampleId: string;
  readonly duplicateGroup: string;
  readonly score: number;
  readonly outcome: 0 | 1;
  readonly weight: number;
}

interface ProbabilityMap {
  readonly status: "supported" | "unsupported" | "not-fit";
  readonly reason: string | null;
  readonly fitHash: string | null;
  readonly trainingExamplesHash: string;
  readonly selectedTrainingSiteCount: number;
  readonly trainingDuplicateGroupCount: number;
  readonly scoreLevelCount: number;
  readonly blocks: readonly IsotonicBlock[];
}

interface EvaluatedSite {
  readonly observation: Phase2EvaluationObservation;
  readonly label: Phase2EvaluationLabel;
  readonly scorable: boolean;
  readonly selected: boolean;
  readonly selectedSiteCorrect: boolean;
  readonly probabilityOutcome: 0 | 1;
}

export interface SystemOneFamilyTransferReliabilityMetric {
  readonly siteCount: number;
  readonly duplicateGroupCount: number;
  readonly brierScore: number | null;
  readonly expectedCalibrationError: number | null;
}

export interface SystemOneFamilyTransferProbabilityMetrics {
  readonly selectedSiteCount: number;
  readonly selectedScorableSiteCount: number;
  readonly selectedUnscorableSiteCount: number;
  readonly selectedDuplicateGroupCount: number;
  readonly siteWeighted: SystemOneFamilyTransferReliabilityMetric;
  readonly scorableOnlySiteWeighted: SystemOneFamilyTransferReliabilityMetric;
  readonly duplicateGroupWeighted: SystemOneFamilyTransferReliabilityMetric;
  readonly callShapes: readonly {
    readonly name: string;
    readonly selectedSiteCount: number;
    readonly siteWeighted: SystemOneFamilyTransferReliabilityMetric;
    readonly scorableOnlySiteWeighted: SystemOneFamilyTransferReliabilityMetric;
    readonly duplicateGroupWeighted: SystemOneFamilyTransferReliabilityMetric;
  }[];
}

export interface SystemOneFamilyTransferCandidateMetric {
  readonly name: string;
  readonly eligibleSiteCount: number;
  readonly generatedCountAvailableSiteCount: number;
  readonly generatedCandidateZeroSiteCount: number;
  readonly generatedCandidateSizeP50: number | null;
  readonly generatedCandidateSizeP95: number | null;
  readonly generatedCandidateSizeMax: number | null;
  readonly mappedCandidateZeroSiteCount: number;
  readonly mappedCandidateSizeP50: number | null;
  readonly mappedCandidateSizeP95: number | null;
  readonly mappedCandidateSizeMax: number | null;
  readonly proposalCountAvailableSiteCount: number;
  readonly proposalZeroSiteCount: number;
  readonly proposalSizeP50: number | null;
  readonly proposalSizeP95: number | null;
  readonly proposalSizeMax: number | null;
}

export interface SystemOneFamilyTransferFold {
  readonly heldOutFamily: string;
  readonly trainingFamilyNames: readonly string[];
  readonly heldOutSourceRowCount: number;
  readonly heldOutEligibleSiteCount: number;
  readonly trainingSourceRowCount: number;
  readonly trainingEligibleSiteCount: number;
  readonly trainingDuplicateGroupCount: number;
  readonly heldOutDuplicateGroupCount: number;
  readonly excludedCrossFamilyTrainingRowCount: number;
  readonly excludedCrossFamilyTrainingSiteCount: number;
  readonly excludedCrossFamilyTrainingGroupCount: number;
  readonly trainingHeldGroupOverlapCount: number;
  readonly trainingSampleIdsHash: string;
  readonly heldOutSampleIdsHash: string;
  readonly trainingLabelRowsHash: string;
  readonly heldOutLabelRowsHash: string;
  readonly excludedCrossFamilyGroupsHash: string;
  readonly thresholdScore: number | null;
  readonly thresholdCandidateCount: number;
  readonly thresholdQualifyingCount: number;
  readonly thresholdTrainingMetrics: SystemOneSplitMetrics | null;
  readonly probabilityMap: Omit<ProbabilityMap, "blocks">;
  readonly heldOutMetrics: SystemOneSplitMetrics;
  readonly candidateAvailability: {
    readonly allEligibleSiteCount: number;
    readonly generatedCandidateZeroSiteCount: number;
    readonly mappedCandidateZeroSiteCount: number;
    readonly proposalZeroSiteCount: number;
    readonly byFamily: readonly SystemOneFamilyTransferCandidateMetric[];
    readonly byCallShape: readonly SystemOneFamilyTransferCandidateMetric[];
  };
  readonly selectedProbabilityMetrics: SystemOneFamilyTransferProbabilityMetrics;
  readonly abstentionAttribution: {
    readonly eligibleSiteCount: number;
    readonly abstainedSiteCount: number;
    readonly byCallShapeAndReason: readonly {
      readonly callShape: string;
      readonly reason: string;
      readonly abstainedSiteCount: number;
      readonly zeroRankScoreSiteCount: number;
      readonly lowRankScoreSiteCount: number;
      readonly missingSignalCounts: Readonly<Record<string, number>>;
    }[];
  };
}

export interface SystemOneFamilyTransferTrainResult {
  readonly schemaVersion: 1;
  readonly measurement: "phase2-p2b-system1-family-transfer-calibrated-lofo/1";
  readonly split: "train";
  readonly thresholdSelectionSource: "calibration-freeze";
  readonly thresholdScore: number | null;
  readonly probabilityMapMethod: string;
  readonly probabilityMapSupportRule: {
    readonly minimumTrainingDuplicateGroups: number;
    readonly minimumTrainingScoreLevels: number;
  };
  readonly sourceRowCount: number;
  readonly eligibleSiteCount: number;
  readonly duplicateGroupCount: number;
  readonly crossFamilyDuplicateGroupCount: number;
  readonly crossFamilyDuplicateGroupsHash: string;
  readonly crossFamilyGroupFamiliesHash: string;
  readonly familyMacroRawTop1: number | null;
  readonly worstFamilyRawTop1: number | null;
  readonly familyMacroEndToEndTop1: number | null;
  readonly worstFamilyEndToEndTop1: number | null;
  readonly folds: readonly SystemOneFamilyTransferFold[];
  readonly limitations: readonly string[];
}

interface CandidateSizeAccumulator {
  readonly name: string;
  readonly eligibleSiteCount: number;
  readonly generatedAvailable: number[];
  readonly generatedZeroCount: number;
  readonly mappedSizes: number[];
  readonly mappedZeroCount: number;
  readonly proposalsAvailable: number[];
  readonly proposalZeroCount: number;
}

function canonicalTarget(targetId: string): string {
  return targetId.replace(/@L\d+(?:#\d+)?$/, "");
}

function aliasesFor(
  aliases: SystemOneOracleAliases,
  observation: Phase2EvaluationObservation,
): ReadonlySet<string> {
  if (!("bySnapshotAndRepo" in aliases)) return aliases;
  return (
    candidateOracleMappingForSource(aliases, observation)
      ?.uniquelyMappedAliases ?? new Set<string>()
  );
}

function validateTrainInputs(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
): Map<string, Phase2EvaluationLabel> {
  const labelsBySample = new Map(
    labels.map((label) => [label.sampleId, label]),
  );
  if (labelsBySample.size !== labels.length)
    throw new Error("TRAIN labels contain duplicate sample IDs.");
  if (
    new Set(observations.map(({ sampleId }) => sampleId)).size !==
    observations.length
  )
    throw new Error("TRAIN observations contain duplicate sample IDs.");
  for (const label of labels)
    if (label.split !== "train")
      throw new Error("Family transfer accepts TRAIN labels only.");
  for (const observation of observations) {
    if (observation.split !== "train")
      throw new Error("Family transfer accepts TRAIN predictions only.");
    const label = labelsBySample.get(observation.sampleId);
    if (!label)
      throw new Error(`TRAIN label missing for ${observation.sampleId}.`);
    if (
      label.repoFamily !== observation.repoFamily ||
      label.duplicateGroup !== observation.duplicateGroup ||
      (label.repoId !== undefined && label.repoId !== observation.repoId)
    )
      throw new Error(`TRAIN grouping mismatch for ${observation.sampleId}.`);
  }
  if (observations.length !== labels.length)
    throw new Error("TRAIN observations and labels have different row counts.");
  return labelsBySample;
}

function labelSignature(label: Phase2EvaluationLabel): string {
  return [...new Set(label.positiveTargetIds.map(canonicalTarget))]
    .sort()
    .join("\0");
}

function groupFamilies(
  labels: readonly Phase2EvaluationLabel[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const label of labels) {
    const families = result.get(label.duplicateGroup) ?? new Set<string>();
    families.add(label.repoFamily);
    result.set(label.duplicateGroup, families);
  }
  return result;
}

function crossFamilyGroups(
  familiesByGroup: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, readonly string[]> {
  return new Map(
    [...familiesByGroup]
      .filter(([, families]) => families.size > 1)
      .map(([group, families]) => [group, [...families].sort()]),
  );
}

function conflictGroups(labels: readonly Phase2EvaluationLabel[]): Set<string> {
  const signaturesByGroup = new Map<string, Set<string>>();
  for (const label of labels) {
    if (
      label.reviewStatus !== "confirmed" ||
      label.positiveTargetIds.length === 0
    )
      continue;
    const signatures =
      signaturesByGroup.get(label.duplicateGroup) ?? new Set<string>();
    signatures.add(labelSignature(label));
    signaturesByGroup.set(label.duplicateGroup, signatures);
  }
  return new Set(
    [...signaturesByGroup]
      .filter(([, signatures]) => signatures.size > 1)
      .map(([group]) => group),
  );
}

function eligible(label: Phase2EvaluationLabel): boolean {
  return (
    label.reviewStatus === "confirmed" && label.positiveTargetIds.length > 0
  );
}

function uniquePositiveTargets(
  observation: Phase2EvaluationObservation,
  label: Phase2EvaluationLabel,
  aliases: SystemOneOracleAliases,
): string[] {
  const uniqueAliases = aliasesFor(aliases, observation);
  return [
    ...new Set(
      label.positiveTargetIds
        .map(canonicalTarget)
        .filter((targetId) => uniqueAliases.has(targetId)),
    ),
  ].sort();
}

function eligibleSiteCount(
  observations: readonly Phase2EvaluationObservation[],
  labelsBySample: ReadonlyMap<string, Phase2EvaluationLabel>,
): number {
  return observations.filter((observation) =>
    eligible(labelsBySample.get(observation.sampleId)!),
  ).length;
}

function rowIdsHash(rows: readonly { readonly sampleId: string }[]): string {
  return canonicalHash(rows.map(({ sampleId }) => sampleId).sort());
}

function labelRowsHash(labels: readonly Phase2EvaluationLabel[]): string {
  return canonicalHash(
    [...labels].sort((left, right) =>
      left.sampleId.localeCompare(right.sampleId),
    ),
  );
}

function selectedRows(
  observations: readonly Phase2EvaluationObservation[],
  labelsBySample: ReadonlyMap<string, Phase2EvaluationLabel>,
  aliases: SystemOneOracleAliases,
  thresholdScore: number | null,
  conflicts: ReadonlySet<string>,
): EvaluatedSite[] {
  return observations.flatMap((observation) => {
    const label = labelsBySample.get(observation.sampleId)!;
    if (!eligible(label)) return [];
    const decision = selectSystemOne(observation, thresholdScore, aliases);
    const selected = decision.status === "likely";
    const positives = uniquePositiveTargets(observation, label, aliases);
    const selectedSiteCorrect =
      selected &&
      observation.topTargetId !== null &&
      positives.includes(canonicalTarget(observation.topTargetId));
    const probabilityOutcome =
      selectedSiteCorrect && !conflicts.has(label.duplicateGroup) ? 1 : 0;
    return [
      {
        observation,
        label,
        scorable: positives.length > 0,
        selected,
        selectedSiteCorrect,
        probabilityOutcome: probabilityOutcome as 0 | 1,
      },
    ];
  });
}

function groupWeightedExamples(
  rows: readonly EvaluatedSite[],
): IsotonicExample[] {
  const selected = rows.filter(
    (row) => row.selected && row.observation.topRankScore !== null,
  );
  const groupCounts = new Map<string, number>();
  for (const row of selected) {
    const group = row.label.duplicateGroup;
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }
  return selected.map((row) => ({
    sampleId: row.observation.sampleId,
    duplicateGroup: row.label.duplicateGroup,
    score: row.observation.topRankScore!,
    outcome: row.probabilityOutcome,
    weight: 1 / groupCounts.get(row.label.duplicateGroup)!,
  }));
}

function blockMean(block: IsotonicBlock): number {
  return block.successes / block.weight;
}

function mergeBlocks(left: IsotonicBlock, right: IsotonicBlock): IsotonicBlock {
  return {
    firstScore: left.firstScore,
    lastScore: right.lastScore,
    weight: left.weight + right.weight,
    successes: left.successes + right.successes,
  };
}

function isotonicBlocks(examples: readonly IsotonicExample[]): IsotonicBlock[] {
  const totals = new Map<number, { weight: number; successes: number }>();
  for (const example of examples) {
    const total = totals.get(example.score) ?? { weight: 0, successes: 0 };
    total.weight += example.weight;
    total.successes += example.weight * example.outcome;
    totals.set(example.score, total);
  }
  const blocks = [...totals]
    .sort(([left], [right]) => left - right)
    .map(([score, total]) => ({
      firstScore: score,
      lastScore: score,
      weight: total.weight + 2,
      successes: total.successes + 1,
    }));
  for (let index = 1; index < blocks.length;) {
    if (blockMean(blocks[index - 1]!) <= blockMean(blocks[index]!)) {
      index++;
    } else {
      blocks.splice(
        index - 1,
        2,
        mergeBlocks(blocks[index - 1]!, blocks[index]!),
      );
      index = Math.max(1, index - 1);
    }
  }
  return blocks;
}

function fitProbabilityMap(
  examples: readonly IsotonicExample[],
): ProbabilityMap {
  const trainingDuplicateGroupCount = new Set(
    examples.map(({ duplicateGroup }) => duplicateGroup),
  ).size;
  const scoreLevelCount = new Set(examples.map(({ score }) => score)).size;
  const trainingExamplesHash = canonicalHash({
    method: PROBABILITY_MAP_METHOD,
    betaPrior: { correct: 1, incorrect: 1 },
    examples: [...examples].sort((left, right) =>
      left.sampleId.localeCompare(right.sampleId),
    ),
  });
  const unsupportedReason =
    trainingDuplicateGroupCount < MINIMUM_MAP_GROUP_COUNT
      ? "insufficient-training-duplicate-groups"
      : scoreLevelCount < MINIMUM_MAP_SCORE_LEVEL_COUNT
        ? "insufficient-training-score-levels"
        : null;
  if (examples.length === 0)
    return {
      status: "not-fit",
      reason: "no-selected-training-outputs",
      fitHash: null,
      trainingExamplesHash,
      selectedTrainingSiteCount: 0,
      trainingDuplicateGroupCount,
      scoreLevelCount,
      blocks: [],
    };
  if (unsupportedReason)
    return {
      status: "unsupported",
      reason: unsupportedReason,
      fitHash: null,
      trainingExamplesHash,
      selectedTrainingSiteCount: examples.length,
      trainingDuplicateGroupCount,
      scoreLevelCount,
      blocks: [],
    };
  const blocks = isotonicBlocks(examples);
  return {
    status: "supported",
    reason: null,
    fitHash: canonicalHash({ trainingExamplesHash, blocks }),
    trainingExamplesHash,
    selectedTrainingSiteCount: examples.length,
    trainingDuplicateGroupCount,
    scoreLevelCount,
    blocks,
  };
}

function probabilityForScore(map: ProbabilityMap, score: number): number {
  const block = map.blocks.find(({ lastScore }) => score <= lastScore);
  const selected = block ?? map.blocks.at(-1);
  if (!selected) throw new Error("Supported probability map has no blocks.");
  return blockMean(selected);
}

interface ReliabilityInput {
  readonly duplicateGroup: string;
  readonly probability: number;
  readonly outcome: 0 | 1;
}

function reliabilityMetric(
  rows: readonly ReliabilityInput[],
  groupWeighted: boolean,
): SystemOneFamilyTransferReliabilityMetric {
  const groupCounts = new Map<string, number>();
  for (const row of rows)
    groupCounts.set(
      row.duplicateGroup,
      (groupCounts.get(row.duplicateGroup) ?? 0) + 1,
    );
  const weighted = rows.map((row) => ({
    row,
    weight: groupWeighted ? 1 / groupCounts.get(row.duplicateGroup)! : 1,
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0)
    return {
      siteCount: 0,
      duplicateGroupCount: 0,
      brierScore: null,
      expectedCalibrationError: null,
    };
  const bins = Array.from({ length: PROBABILITY_BIN_COUNT }, () => ({
    weight: 0,
    predicted: 0,
    observed: 0,
  }));
  let brier = 0;
  for (const item of weighted) {
    const { row, weight } = item;
    brier += weight * (row.probability - row.outcome) ** 2;
    const bin = reliabilityBinForProbability(
      row.probability,
      PROBABILITY_BIN_COUNT,
    );
    const bucket = bins[bin.binIndex]!;
    bucket.weight += weight;
    bucket.predicted += weight * row.probability;
    bucket.observed += weight * row.outcome;
  }
  const expectedCalibrationError = bins.reduce((sum, bucket) => {
    if (bucket.weight === 0) return sum;
    return (
      sum +
      (bucket.weight / totalWeight) *
        Math.abs(
          bucket.predicted / bucket.weight - bucket.observed / bucket.weight,
        )
    );
  }, 0);
  return {
    siteCount: rows.length,
    duplicateGroupCount: groupCounts.size,
    brierScore: brier / totalWeight,
    expectedCalibrationError,
  };
}

function selectedProbabilityMetrics(
  rows: readonly EvaluatedSite[],
  map: ProbabilityMap,
): SystemOneFamilyTransferProbabilityMetrics {
  const selected = rows.filter((row) => row.selected);
  const withProbability =
    map.status === "supported"
      ? selected.map((row) => ({
          row,
          probability: probabilityForScore(map, row.observation.topRankScore!),
        }))
      : [];
  const asReliabilityRows = (
    source: typeof withProbability,
  ): ReliabilityInput[] =>
    source.map(({ row, probability }) => ({
      duplicateGroup: row.label.duplicateGroup,
      probability,
      outcome: row.probabilityOutcome,
    }));
  const summary = (source: typeof withProbability) => {
    const all = asReliabilityRows(source);
    const scorable = source
      .filter(({ row }) => row.scorable)
      .map(({ row, probability }) => ({
        duplicateGroup: row.label.duplicateGroup,
        probability,
        outcome: row.probabilityOutcome,
      }));
    return {
      siteWeighted: reliabilityMetric(all, false),
      scorableOnlySiteWeighted: reliabilityMetric(scorable, false),
      duplicateGroupWeighted: reliabilityMetric(all, true),
    };
  };
  const total = summary(withProbability);
  const shapeNames = [
    ...new Set(
      selected.map(({ observation }) => observation.calleeKind ?? "unknown"),
    ),
  ].sort();
  const callShapes = shapeNames.map((name) => {
    const group = withProbability.filter(
      ({ row }) => (row.observation.calleeKind ?? "unknown") === name,
    );
    return {
      name,
      selectedSiteCount: selected.filter(
        ({ observation }) => (observation.calleeKind ?? "unknown") === name,
      ).length,
      ...summary(group),
    };
  });
  return {
    selectedSiteCount: selected.length,
    selectedScorableSiteCount: selected.filter((row) => row.scorable).length,
    selectedUnscorableSiteCount: selected.filter((row) => !row.scorable).length,
    selectedDuplicateGroupCount: new Set(
      selected.map(({ label }) => label.duplicateGroup),
    ).size,
    ...total,
    callShapes,
  };
}

function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

function candidateMetric(
  name: string,
  observations: readonly Phase2EvaluationObservation[],
  labelsBySample: ReadonlyMap<string, Phase2EvaluationLabel>,
): SystemOneFamilyTransferCandidateMetric {
  const eligibleRows = observations.filter((observation) =>
    eligible(labelsBySample.get(observation.sampleId)!),
  );
  const generated = eligibleRows.flatMap(({ generatedCandidateCount }) =>
    generatedCandidateCount === undefined ? [] : [generatedCandidateCount],
  );
  const mapped = eligibleRows.map(
    ({ candidateTargetIds }) => candidateTargetIds.length,
  );
  const proposals = eligibleRows.flatMap(({ proposedCandidateCount }) =>
    proposedCandidateCount === undefined ? [] : [proposedCandidateCount],
  );
  return {
    name,
    eligibleSiteCount: eligibleRows.length,
    generatedCountAvailableSiteCount: generated.length,
    generatedCandidateZeroSiteCount: generated.filter((count) => count === 0)
      .length,
    generatedCandidateSizeP50: nearestRankPercentile(generated, 0.5),
    generatedCandidateSizeP95: nearestRankPercentile(generated, 0.95),
    generatedCandidateSizeMax:
      generated.length === 0 ? null : Math.max(...generated),
    mappedCandidateZeroSiteCount: mapped.filter((count) => count === 0).length,
    mappedCandidateSizeP50: nearestRankPercentile(mapped, 0.5),
    mappedCandidateSizeP95: nearestRankPercentile(mapped, 0.95),
    mappedCandidateSizeMax: mapped.length === 0 ? null : Math.max(...mapped),
    proposalCountAvailableSiteCount: proposals.length,
    proposalZeroSiteCount: proposals.filter((count) => count === 0).length,
    proposalSizeP50: nearestRankPercentile(proposals, 0.5),
    proposalSizeP95: nearestRankPercentile(proposals, 0.95),
    proposalSizeMax: proposals.length === 0 ? null : Math.max(...proposals),
  };
}

function candidateAvailability(
  observations: readonly Phase2EvaluationObservation[],
  labelsBySample: ReadonlyMap<string, Phase2EvaluationLabel>,
): SystemOneFamilyTransferFold["candidateAvailability"] {
  const eligibleRows = observations.filter((observation) =>
    eligible(labelsBySample.get(observation.sampleId)!),
  );
  const byDimension = (
    keyFor: (row: Phase2EvaluationObservation) => string,
  ) => {
    const names = [...new Set(eligibleRows.map((row) => keyFor(row)))].sort();
    return names.map((name) =>
      candidateMetric(
        name,
        eligibleRows.filter((row) => keyFor(row) === name),
        labelsBySample,
      ),
    );
  };
  const total = candidateMetric("all", eligibleRows, labelsBySample);
  return {
    allEligibleSiteCount: total.eligibleSiteCount,
    generatedCandidateZeroSiteCount: total.generatedCandidateZeroSiteCount,
    mappedCandidateZeroSiteCount: total.mappedCandidateZeroSiteCount,
    proposalZeroSiteCount: total.proposalZeroSiteCount,
    byFamily: byDimension((row) => row.repoFamily),
    byCallShape: byDimension((row) => row.calleeKind ?? "unknown"),
  };
}

function abstentionAttribution(
  observations: readonly Phase2EvaluationObservation[],
  labelsBySample: ReadonlyMap<string, Phase2EvaluationLabel>,
  aliases: SystemOneOracleAliases,
  thresholdScore: number | null,
): SystemOneFamilyTransferFold["abstentionAttribution"] {
  const groups = new Map<
    string,
    {
      callShape: string;
      reason: string;
      abstainedSiteCount: number;
      zeroRankScoreSiteCount: number;
      lowRankScoreSiteCount: number;
      missingSignalCounts: Record<string, number>;
    }
  >();
  let eligibleCount = 0;
  let abstainedCount = 0;
  for (const observation of observations) {
    if (!eligible(labelsBySample.get(observation.sampleId)!)) continue;
    eligibleCount++;
    const decision = selectSystemOne(observation, thresholdScore, aliases);
    if (decision.status !== "ambiguous") continue;
    abstainedCount++;
    const callShape = observation.calleeKind ?? "unknown";
    const reason = decision.reason ?? "unknown";
    const key = `${callShape}\0${reason}`;
    const group = groups.get(key) ?? {
      callShape,
      reason,
      abstainedSiteCount: 0,
      zeroRankScoreSiteCount: 0,
      lowRankScoreSiteCount: 0,
      missingSignalCounts: {},
    };
    group.abstainedSiteCount++;
    if (observation.topRankScore === 0) group.zeroRankScoreSiteCount++;
    if (
      observation.topRankScore !== null &&
      observation.topRankScore > 0 &&
      thresholdScore !== null &&
      observation.topRankScore < thresholdScore
    )
      group.lowRankScoreSiteCount++;
    if (observation.topTargetId !== null && observation.topRankScore !== null) {
      const signals = new Set(observation.topRankingSignals ?? []);
      const presentSignals = new Set<string>();
      if (signals.has("explicit-receiver-type"))
        presentSignals.add("explicit-receiver-type");
      if (
        signals.has("same-binding-peer-members") ||
        signals.has("partial-binding-peer-member-usage")
      )
        presentSignals.add("structural-peer-member-usage");
      if (signals.has("compatible-argument-count"))
        presentSignals.add("compatible-argument-count");
      if (signals.has("same-directory")) presentSignals.add("same-directory");
      for (const signal of [
        "explicit-receiver-type",
        "structural-peer-member-usage",
        "compatible-argument-count",
        "same-directory",
      ])
        if (!presentSignals.has(signal))
          group.missingSignalCounts[signal] =
            (group.missingSignalCounts[signal] ?? 0) + 1;
    }
    groups.set(key, group);
  }
  return {
    eligibleSiteCount: eligibleCount,
    abstainedSiteCount: abstainedCount,
    byCallShapeAndReason: [...groups.values()].sort(
      (left, right) =>
        left.callShape.localeCompare(right.callShape) ||
        left.reason.localeCompare(right.reason),
    ),
  };
}

function conservativeDuplicateGroupMetrics(
  metrics: SystemOneSplitMetrics,
  selected: readonly EvaluatedSite[],
  conflicts: ReadonlySet<string>,
): SystemOneSplitMetrics {
  const selectedRows = selected.filter((row) => row.selected);
  const grouped = new Map<string, EvaluatedSite[]>();
  for (const row of selectedRows) {
    const group = row.label.duplicateGroup;
    const rows = grouped.get(group) ?? [];
    rows.push(row);
    grouped.set(group, rows);
  }
  const correctAcceptedDuplicateGroupCount = [...grouped].filter(
    ([group, rows]) =>
      !conflicts.has(group) && rows.every((row) => row.selectedSiteCorrect),
  ).length;
  return {
    ...metrics,
    acceptedDuplicateGroupCount: grouped.size,
    correctAcceptedDuplicateGroupCount,
    duplicateGroupPrecision:
      grouped.size === 0
        ? null
        : correctAcceptedDuplicateGroupCount / grouped.size,
  };
}

function transferFold(
  heldOutFamily: string,
  observations: readonly Phase2EvaluationObservation[],
  labelsBySample: ReadonlyMap<string, Phase2EvaluationLabel>,
  aliases: SystemOneOracleAliases,
  crossGroups: ReadonlyMap<string, readonly string[]>,
  allConflicts: ReadonlySet<string>,
  thresholdScore: number | null,
): SystemOneFamilyTransferFold {
  const held = observations.filter((row) => row.repoFamily === heldOutFamily);
  const possibleTraining = observations.filter(
    (row) => row.repoFamily !== heldOutFamily,
  );
  const excludedCrossRows = possibleTraining.filter((row) =>
    crossGroups.has(row.duplicateGroup),
  );
  const training = possibleTraining.filter(
    (row) => !crossGroups.has(row.duplicateGroup),
  );
  const trainingLabels = training.map(({ sampleId }) =>
    labelsBySample.get(sampleId)!,
  );
  const heldLabels = held.map(({ sampleId }) => labelsBySample.get(sampleId)!);
  const trainingGroups = new Set(
    training.map(({ duplicateGroup }) => duplicateGroup),
  );
  const heldGroups = new Set(held.map(({ duplicateGroup }) => duplicateGroup));
  const trainingHeldGroupOverlapCount = [...trainingGroups].filter((group) =>
    heldGroups.has(group),
  ).length;
  if (trainingHeldGroupOverlapCount !== 0)
    throw new Error(`Duplicate-group leakage in held family ${heldOutFamily}.`);
  const trainingLabelMap = new Map(
    trainingLabels.map((label) => [label.sampleId, label]),
  );
  const selectedTraining = selectedRows(
    training,
    trainingLabelMap,
    aliases,
    thresholdScore,
    allConflicts,
  );
  const probabilityMap = fitProbabilityMap(
    groupWeightedExamples(selectedTraining),
  );
  const heldLabelMap = new Map(
    heldLabels.map((label) => [label.sampleId, label]),
  );
  const heldMetrics = conservativeDuplicateGroupMetrics(
    evaluateSystemOneSplit(held, heldLabels, aliases, thresholdScore, "train"),
    selectedRows(held, heldLabelMap, aliases, thresholdScore, allConflicts),
    allConflicts,
  );
  const heldEvaluatedRows = selectedRows(
    held,
    heldLabelMap,
    aliases,
    thresholdScore,
    allConflicts,
  );
  const excludedCrossGroupNames = [
    ...new Set(excludedCrossRows.map(({ duplicateGroup }) => duplicateGroup)),
  ].sort();
  const familyNames = [
    ...new Set(observations.map(({ repoFamily }) => repoFamily)),
  ].sort();
  return {
    heldOutFamily,
    trainingFamilyNames: familyNames.filter(
      (family) => family !== heldOutFamily,
    ),
    heldOutSourceRowCount: held.length,
    heldOutEligibleSiteCount: heldMetrics.eligibleSiteCount,
    trainingSourceRowCount: training.length,
    trainingEligibleSiteCount: eligibleSiteCount(training, trainingLabelMap),
    trainingDuplicateGroupCount: trainingGroups.size,
    heldOutDuplicateGroupCount: heldGroups.size,
    excludedCrossFamilyTrainingRowCount: excludedCrossRows.length,
    excludedCrossFamilyTrainingSiteCount: eligibleSiteCount(
      excludedCrossRows,
      new Map(
        excludedCrossRows.map((row) => [
          row.sampleId,
          labelsBySample.get(row.sampleId)!,
        ]),
      ),
    ),
    excludedCrossFamilyTrainingGroupCount: excludedCrossGroupNames.length,
    trainingHeldGroupOverlapCount,
    trainingSampleIdsHash: rowIdsHash(training),
    heldOutSampleIdsHash: rowIdsHash(held),
    trainingLabelRowsHash: labelRowsHash(trainingLabels),
    heldOutLabelRowsHash: labelRowsHash(heldLabels),
    excludedCrossFamilyGroupsHash: canonicalHash(excludedCrossGroupNames),
    thresholdScore,
    thresholdCandidateCount: 0,
    thresholdQualifyingCount: 0,
    thresholdTrainingMetrics: null,
    probabilityMap: {
      status: probabilityMap.status,
      reason: probabilityMap.reason,
      fitHash: probabilityMap.fitHash,
      trainingExamplesHash: probabilityMap.trainingExamplesHash,
      selectedTrainingSiteCount: probabilityMap.selectedTrainingSiteCount,
      trainingDuplicateGroupCount: probabilityMap.trainingDuplicateGroupCount,
      scoreLevelCount: probabilityMap.scoreLevelCount,
    },
    heldOutMetrics: heldMetrics,
    candidateAvailability: candidateAvailability(held, heldLabelMap),
    selectedProbabilityMetrics: selectedProbabilityMetrics(
      heldEvaluatedRows,
      probabilityMap,
    ),
    abstentionAttribution: abstentionAttribution(
      held,
      heldLabelMap,
      aliases,
      thresholdScore,
    ),
  };
}

export function evaluateSystemOneFamilyTransferAtThreshold(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  aliases: SystemOneOracleAliases,
  thresholdScore: number | null,
): SystemOneFamilyTransferTrainResult {
  const labelsBySample = validateTrainInputs(observations, labels);
  const familiesByGroup = groupFamilies(labels);
  const crossGroups = crossFamilyGroups(familiesByGroup);
  const conflicts = conflictGroups(labels);
  const familyNames = [
    ...new Set(observations.map(({ repoFamily }) => repoFamily)),
  ].sort();
  const folds = familyNames.map((family) =>
    transferFold(
      family,
      observations,
      labelsBySample,
      aliases,
      crossGroups,
      conflicts,
      thresholdScore,
    ),
  );
  const heldMetrics = folds.map(({ heldOutMetrics }) => heldOutMetrics);
  const mean = (values: readonly number[]) =>
    values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  const groupFamiliesHash = canonicalHash(
    [...crossGroups].sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    schemaVersion: 1,
    measurement: "phase2-p2b-system1-family-transfer-calibrated-lofo/1",
    split: "train",
    thresholdSelectionSource: "calibration-freeze",
    thresholdScore,
    probabilityMapMethod: PROBABILITY_MAP_METHOD,
    probabilityMapSupportRule: {
      minimumTrainingDuplicateGroups: MINIMUM_MAP_GROUP_COUNT,
      minimumTrainingScoreLevels: MINIMUM_MAP_SCORE_LEVEL_COUNT,
    },
    sourceRowCount: observations.length,
    eligibleSiteCount: heldMetrics.reduce(
      (sum, metrics) => sum + metrics.eligibleSiteCount,
      0,
    ),
    duplicateGroupCount: new Set(
      labels.map(({ duplicateGroup }) => duplicateGroup),
    ).size,
    crossFamilyDuplicateGroupCount: crossGroups.size,
    crossFamilyDuplicateGroupsHash: canonicalHash(
      [...crossGroups.keys()].sort(),
    ),
    crossFamilyGroupFamiliesHash: groupFamiliesHash,
    familyMacroRawTop1: mean(heldMetrics.map(({ rawTop1 }) => rawTop1)),
    worstFamilyRawTop1:
      heldMetrics.length === 0
        ? null
        : Math.min(...heldMetrics.map(({ rawTop1 }) => rawTop1)),
    familyMacroEndToEndTop1: mean(
      heldMetrics.map(({ endToEndTop1 }) => endToEndTop1),
    ),
    worstFamilyEndToEndTop1:
      heldMetrics.length === 0
        ? null
        : Math.min(...heldMetrics.map(({ endToEndTop1 }) => endToEndTop1)),
    folds,
    limitations: [
      "This is train-family transfer analysis, not unseen-family certification.",
      "The threshold is frozen from calibration; each held-family probability map fits only on other TRAIN families.",
      "Cross-family duplicate groups are excluded from each fold's fit rows and retained in held-family evaluation.",
      "The probability map is a Beta-smoothed isotonic estimate with conservative unscorable outcomes; abstentions receive no probability.",
      "No calibration, test, or temporal labels are read; no System One heldout mode is invoked.",
    ],
  };
}
