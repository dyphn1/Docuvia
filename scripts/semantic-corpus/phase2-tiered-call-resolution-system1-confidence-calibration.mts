import { createHash } from "node:crypto";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import { candidateOracleMappingForSource } from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import {
  evaluateSystemOneSplit,
  selectSystemOne,
  selectSystemOneThreshold,
  type SystemOneOracleAliases,
} from "./phase2-tiered-call-resolution-system1-evaluation.mjs";

const DEFAULT_FOLD_COUNT = 5;
const DEFAULT_BIN_COUNT = 10;
const DEFAULT_TARGET_ACCEPTED_PRECISION = 0.9;
const DEFAULT_TARGET_DUPLICATE_GROUP_PRECISION = 0.9;
const METHOD = "equal-duplicate-group-weighted-beta-smoothed-isotonic-v1";
const SHAPE_MAP_MIN_TRAINING_GROUPS = 50;
const SHAPE_MAP_MIN_SCORE_LEVELS = 5;

export interface SystemOneCalibrationQualityOptions {
  readonly foldCount?: number;
  readonly binCount?: number;
  readonly targetAcceptedPrecision?: number;
  readonly targetDuplicateGroupPrecision?: number;
}

interface EligibleRow {
  readonly observation: Phase2EvaluationObservation;
  readonly label: Phase2EvaluationLabel;
  readonly positiveTargetIds: readonly string[];
  readonly scorable: boolean;
  readonly labelsConflict: boolean;
}

interface CalibrationExample {
  readonly sampleId: string;
  readonly duplicateGroup: string;
  readonly callShape: string;
  readonly score: number;
  readonly outcome: 0 | 1;
  readonly weight: number;
}

interface IsotonicBlock {
  readonly firstScore: number;
  readonly lastScore: number;
  readonly weight: number;
  readonly successes: number;
}

interface IsotonicModel {
  readonly blocks: readonly IsotonicBlock[];
  readonly scoreLevelCount: number;
  readonly fitHash: string;
}

interface OutputRow extends EligibleRow {
  readonly foldIndex: number;
  readonly selected: boolean;
  readonly selectedCorrect: boolean;
  readonly probability: number | null;
  readonly callShapeProbability: number | null;
}

interface ReliabilityRow {
  readonly sampleId: string;
  readonly duplicateGroup: string;
  readonly repoFamily: string;
  readonly callShape: string;
  readonly probability: number;
  readonly outcome: 0 | 1;
  readonly scorable: boolean;
}

interface ReliabilityBinBounds {
  readonly binIndex: number;
  readonly lowerInclusive: number;
  readonly upperBound: number;
  readonly upperBoundInclusive: boolean;
}

interface ReliabilityBin extends ReliabilityBinBounds {
  readonly siteCount: number;
  readonly duplicateGroupCount: number;
  readonly predictedProbability: number | null;
  readonly observedSuccessRate: number | null;
  readonly weightedSiteCount: number;
}

interface ReliabilityMetric {
  readonly siteCount: number;
  readonly duplicateGroupCount: number;
  readonly brierScore: number | null;
  readonly expectedCalibrationError: number | null;
  readonly bins?: readonly ReliabilityBin[];
}

interface SubgroupMetric {
  readonly name: string;
  readonly eligibleSiteCount: number;
  readonly eligibleDuplicateGroupCount: number;
  readonly selectedSiteCount: number;
  readonly selectedDuplicateGroupCount: number;
  readonly selectedScorableSiteCount: number;
  readonly selectedUnscorableSiteCount: number;
  readonly coverage: number;
  readonly siteWeightedBrierScore: number | null;
  readonly siteWeightedExpectedCalibrationError: number | null;
  readonly duplicateGroupWeightedBrierScore: number | null;
  readonly duplicateGroupWeightedExpectedCalibrationError: number | null;
}

interface FoldMetric {
  readonly foldIndex: number;
  readonly heldOutDuplicateGroupCount: number;
  readonly trainingDuplicateGroupCount: number;
  readonly heldOutEligibleSiteCount: number;
  readonly heldOutSelectedSiteCount: number;
  readonly heldOutSelectedScorableSiteCount: number;
  readonly heldOutSelectedUnscorableSiteCount: number;
  readonly trainingSelectedSiteCount: number;
  readonly trainingSelectedDuplicateGroupCount: number;
  readonly thresholdScore: number | null;
  readonly thresholdSelectionReason: string;
  readonly calibratorScoreLevelCount: number;
  readonly trainingLabelRowsHash: string;
  readonly calibratorFitHash: string;
  readonly callShapeCalibrators: readonly CallShapeCalibratorFoldMetric[];
}

interface CallShapeCalibratorFoldMetric {
  readonly callShape: string;
  readonly trainingSelectedSiteCount: number;
  readonly trainingSelectedDuplicateGroupCount: number;
  readonly scoreLevelCount: number;
  readonly status: "fitted" | "unsupported";
  readonly reason: string | null;
  readonly fitHash: string;
}

interface CallShapeSensitivityMetric {
  readonly name: string;
  readonly eligibleSiteCount: number;
  readonly eligibleDuplicateGroupCount: number;
  readonly selectedSiteCount: number;
  readonly selectedDuplicateGroupCount: number;
  readonly mappedSelectedSiteCount: number;
  readonly mappedSelectedDuplicateGroupCount: number;
  readonly unmappedSelectedSiteCount: number;
  readonly selectionCoverage: number;
  readonly mapCoverageOfSelected: number | null;
  readonly siteWeighted: ReliabilityMetric;
  readonly scorableOnlySiteWeighted: ReliabilityMetric;
  readonly duplicateGroupWeighted: ReliabilityMetric;
}

interface CallShapeSensitivity {
  readonly method: string;
  readonly minimumTrainingDuplicateGroups: number;
  readonly minimumTrainingScoreLevels: number;
  readonly total: CallShapeSensitivityMetric;
  readonly callShapes: readonly CallShapeSensitivityMetric[];
}

export interface SystemOneCalibrationQualityResult {
  readonly schemaVersion: 4;
  readonly measurement: "phase2-p2b-system1-calibration-quality-oof/4";
  readonly split: "calibration";
  readonly method: string;
  readonly probabilityMeaning: string;
  readonly foldCount: number;
  readonly binCount: number;
  readonly targetAcceptedPrecision: number;
  readonly targetDuplicateGroupPrecision: number;
  readonly eligibleSiteCount: number;
  readonly eligibleDuplicateGroupCount: number;
  readonly scorableEligibleSiteCount: number;
  readonly unscorableEligibleSiteCount: number;
  readonly conflictingDuplicateGroupCount: number;
  readonly selectedSiteCount: number;
  readonly selectedScorableSiteCount: number;
  readonly selectedUnscorableSiteCount: number;
  readonly selectedDuplicateGroupCount: number;
  readonly correctSelectedDuplicateGroupCount: number;
  readonly selectedDuplicateGroupPrecision: number | null;
  readonly abstentionCount: number;
  readonly coverage: number;
  readonly abstentionRate: number;
  readonly siteWeighted: ReliabilityMetric;
  readonly scorableOnlySiteWeighted: ReliabilityMetric;
  readonly duplicateGroupWeighted: ReliabilityMetric;
  readonly familyMacroSiteWeightedBrierScore: number | null;
  readonly worstFamilySiteWeightedBrierScore: number | null;
  readonly familyMacroSiteWeightedEce: number | null;
  readonly worstFamilySiteWeightedEce: number | null;
  readonly families: readonly SubgroupMetric[];
  readonly callShapes: readonly SubgroupMetric[];
  readonly callShapeSensitivity: CallShapeSensitivity;
  readonly folds: readonly FoldMetric[];
  readonly outOfFoldRowsHash: string;
  readonly limitations: readonly string[];
}

interface Options {
  readonly foldCount: number;
  readonly binCount: number;
  readonly targetAcceptedPrecision: number;
  readonly targetDuplicateGroupPrecision: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function canonicalTarget(targetId: string): string {
  return targetId.replace(/@L\d+(?:#\d+)?$/, "");
}

function validateOptions(options: SystemOneCalibrationQualityOptions): Options {
  const foldCount = options.foldCount ?? DEFAULT_FOLD_COUNT;
  const binCount = options.binCount ?? DEFAULT_BIN_COUNT;
  const targetAcceptedPrecision =
    options.targetAcceptedPrecision ?? DEFAULT_TARGET_ACCEPTED_PRECISION;
  const targetDuplicateGroupPrecision =
    options.targetDuplicateGroupPrecision ??
    DEFAULT_TARGET_DUPLICATE_GROUP_PRECISION;
  if (!Number.isInteger(foldCount) || foldCount < 2 || foldCount > 10)
    throw new Error("Calibration fold count must be an integer in [2, 10].");
  if (!Number.isInteger(binCount) || binCount < 2 || binCount > 50)
    throw new Error("Calibration bin count must be an integer in [2, 50].");
  if (
    !Number.isFinite(targetAcceptedPrecision) ||
    targetAcceptedPrecision <= 0 ||
    targetAcceptedPrecision > 1 ||
    !Number.isFinite(targetDuplicateGroupPrecision) ||
    targetDuplicateGroupPrecision <= 0 ||
    targetDuplicateGroupPrecision > 1
  )
    throw new Error("Precision targets must be in (0, 1].");
  return {
    foldCount,
    binCount,
    targetAcceptedPrecision,
    targetDuplicateGroupPrecision,
  };
}

export function assignDuplicateGroupFolds(
  duplicateGroups: readonly string[],
  foldCount: number,
): ReadonlyMap<string, number> {
  if (!Number.isInteger(foldCount) || foldCount < 2)
    throw new Error("Calibration fold count must be at least two.");
  const orderedGroups = [...new Set(duplicateGroups)].sort((left, right) => {
    const leftHash = sha256(`system1-calibration-fold-v1\0${left}`);
    const rightHash = sha256(`system1-calibration-fold-v1\0${right}`);
    return leftHash.localeCompare(rightHash) || left.localeCompare(right);
  });
  if (orderedGroups.length < foldCount)
    throw new Error("Calibration fold count cannot exceed duplicate groups.");
  return new Map(
    orderedGroups.map((groupId, index) => [groupId, index % foldCount]),
  );
}

function aliasesFor(
  aliases: SystemOneOracleAliases,
  observation: Phase2EvaluationObservation,
): ReadonlySet<string> {
  if ("bySnapshotAndRepo" in aliases)
    return (
      candidateOracleMappingForSource(aliases, observation)
        ?.uniquelyMappedAliases ?? new Set<string>()
    );
  return aliases;
}

function labelConflictGroups(
  labels: readonly Phase2EvaluationLabel[],
): ReadonlySet<string> {
  const positivesByGroup = new Map<string, Set<string>>();
  for (const label of labels) {
    if (
      label.reviewStatus !== "confirmed" ||
      label.positiveTargetIds.length === 0
    )
      continue;
    const signatures = positivesByGroup.get(label.duplicateGroup) ?? new Set();
    signatures.add(
      [...new Set(label.positiveTargetIds.map(canonicalTarget))]
        .sort()
        .join("\0"),
    );
    positivesByGroup.set(label.duplicateGroup, signatures);
  }
  return new Set(
    [...positivesByGroup]
      .filter(([, signatures]) => signatures.size > 1)
      .map(([groupId]) => groupId),
  );
}

function eligibleRows(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  aliases: SystemOneOracleAliases,
  conflictingGroups: ReadonlySet<string>,
): EligibleRow[] {
  const labelsBySample = new Map(
    labels.map((label) => [label.sampleId, label]),
  );
  return observations.flatMap((observation) => {
    const label = labelsBySample.get(observation.sampleId);
    if (
      !label ||
      label.reviewStatus !== "confirmed" ||
      label.positiveTargetIds.length === 0
    )
      return [];
    const uniqueAliases = aliasesFor(aliases, observation);
    const positiveTargetIds = [
      ...new Set(
        label.positiveTargetIds
          .map(canonicalTarget)
          .filter((targetId) => uniqueAliases.has(targetId)),
      ),
    ].sort();
    return [
      {
        observation,
        label,
        positiveTargetIds,
        scorable: positiveTargetIds.length > 0,
        labelsConflict: conflictingGroups.has(label.duplicateGroup),
      },
    ];
  });
}

function selectedRows(
  rows: readonly EligibleRow[],
  thresholdScore: number | null,
  aliases: SystemOneOracleAliases,
): OutputRow[] {
  return rows.map((row) => {
    const decision = selectSystemOne(row.observation, thresholdScore, aliases);
    const selected = decision.status === "likely";
    const selectedTargetId = decision.selectedTargetId
      ? canonicalTarget(decision.selectedTargetId)
      : null;
    const selectedCorrect =
      selected &&
      row.scorable &&
      !row.labelsConflict &&
      selectedTargetId !== null &&
      row.positiveTargetIds.includes(selectedTargetId);
    return {
      ...row,
      foldIndex: -1,
      selected,
      selectedCorrect,
      probability: null,
      callShapeProbability: null,
    };
  });
}

function stableLabelsHash(labels: readonly Phase2EvaluationLabel[]): string {
  return hashJson(
    [...labels]
      .sort((left, right) => left.sampleId.localeCompare(right.sampleId))
      .map((label) => ({
        sampleId: label.sampleId,
        duplicateGroup: label.duplicateGroup,
        repoFamily: label.repoFamily,
        split: label.split,
        reviewStatus: label.reviewStatus,
        positiveTargetIds: [...label.positiveTargetIds].sort(),
      })),
  );
}

function selectedTrainingExamples(
  rows: readonly EligibleRow[],
  thresholdScore: number | null,
  aliases: SystemOneOracleAliases,
): CalibrationExample[] {
  const selected = selectedRows(rows, thresholdScore, aliases).filter(
    (row) => row.selected && row.observation.topRankScore !== null,
  );
  const groupCounts = new Map<string, number>();
  for (const row of selected)
    groupCounts.set(
      row.label.duplicateGroup,
      (groupCounts.get(row.label.duplicateGroup) ?? 0) + 1,
    );
  return selected.map((row) => ({
    sampleId: row.observation.sampleId,
    duplicateGroup: row.label.duplicateGroup,
    callShape: row.observation.calleeKind ?? "unknown",
    score: row.observation.topRankScore!,
    outcome: row.selectedCorrect ? 1 : 0,
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

function isotonicBlocks(
  examples: readonly CalibrationExample[],
): IsotonicBlock[] {
  const levelTotals = new Map<number, { weight: number; successes: number }>();
  for (const example of examples) {
    const total = levelTotals.get(example.score) ?? {
      weight: 0,
      successes: 0,
    };
    total.weight += example.weight;
    total.successes += example.weight * example.outcome;
    levelTotals.set(example.score, total);
  }
  const blocks = [...levelTotals]
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
      continue;
    }
    blocks.splice(
      index - 1,
      2,
      mergeBlocks(blocks[index - 1]!, blocks[index]!),
    );
    index = Math.max(1, index - 1);
  }
  return blocks;
}

function fitIsotonicModel(
  examples: readonly CalibrationExample[],
): IsotonicModel {
  const blocks = isotonicBlocks(examples);
  return {
    blocks,
    scoreLevelCount: new Set(examples.map(({ score }) => score)).size,
    fitHash: hashJson({
      method: METHOD,
      prior: { correct: 1, incorrect: 1 },
      examples: [...examples].sort((left, right) =>
        left.sampleId.localeCompare(right.sampleId),
      ),
      blocks,
    }),
  };
}

function predictProbability(model: IsotonicModel, score: number): number {
  const block = model.blocks.find((candidate) => score <= candidate.lastScore);
  const selected = block ?? model.blocks.at(-1);
  if (!selected) throw new Error("Selected calibration row has no fitted map.");
  return blockMean(selected);
}

function fitReliabilityRows(
  rows: readonly OutputRow[],
  model: IsotonicModel,
  foldIndex: number,
  callShapeModels: ReadonlyMap<string, IsotonicModel>,
): OutputRow[] {
  return rows.map((row) => {
    const selected = row.selected && row.observation.topRankScore !== null;
    const callShapeModel = callShapeModels.get(
      row.observation.calleeKind ?? "unknown",
    );
    if (selected && model.blocks.length === 0)
      throw new Error(
        "A selected calibration output has no fitted probability map.",
      );
    return {
      ...row,
      foldIndex,
      probability:
        selected && model.blocks.length > 0
          ? predictProbability(model, row.observation.topRankScore!)
          : null,
      callShapeProbability:
        selected && callShapeModel && callShapeModel.blocks.length > 0
          ? predictProbability(callShapeModel, row.observation.topRankScore!)
          : null,
    };
  });
}

function reliabilityRows(
  rows: readonly OutputRow[],
  probabilityKind: "global" | "call-shape" = "global",
): ReliabilityRow[] {
  return rows.flatMap((row) =>
    row.selected &&
    (probabilityKind === "global"
      ? row.probability !== null
      : row.callShapeProbability !== null)
      ? [
          {
            sampleId: row.observation.sampleId,
            duplicateGroup: row.label.duplicateGroup,
            repoFamily: row.label.repoFamily,
            callShape: row.observation.calleeKind ?? "unknown",
            probability:
              probabilityKind === "global"
                ? row.probability!
                : row.callShapeProbability!,
            outcome: row.selectedCorrect ? 1 : 0,
            scorable: row.scorable,
          },
        ]
      : [],
  );
}

function binIndex(probability: number, binCount: number): number {
  return Math.min(binCount - 1, Math.floor(probability * binCount));
}

function binBounds(
  binIndexValue: number,
  binCount: number,
): ReliabilityBinBounds {
  return {
    binIndex: binIndexValue,
    lowerInclusive: binIndexValue / binCount,
    upperBound: (binIndexValue + 1) / binCount,
    upperBoundInclusive: binIndexValue === binCount - 1,
  };
}

export function reliabilityBinForProbability(
  probability: number,
  binCount: number,
): ReliabilityBinBounds {
  if (
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1 ||
    !Number.isInteger(binCount) ||
    binCount < 1
  ) {
    throw new Error("A reliability-bin probability or bin count is invalid.");
  }
  return binBounds(binIndex(probability, binCount), binCount);
}

function metricWeights(
  rows: readonly ReliabilityRow[],
  groupWeighted: boolean,
): readonly number[] {
  if (!groupWeighted) return rows.map(() => 1);
  const groupCounts = new Map<string, number>();
  for (const row of rows)
    groupCounts.set(
      row.duplicateGroup,
      (groupCounts.get(row.duplicateGroup) ?? 0) + 1,
    );
  return rows.map((row) => 1 / groupCounts.get(row.duplicateGroup)!);
}

function reliabilityMetric(
  rows: readonly ReliabilityRow[],
  binCount: number,
  groupWeighted: boolean,
  withBins = false,
): ReliabilityMetric {
  const weights = metricWeights(rows, groupWeighted);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (rows.length === 0 || totalWeight === 0)
    return {
      siteCount: 0,
      duplicateGroupCount: 0,
      brierScore: null,
      expectedCalibrationError: null,
      ...(withBins ? { bins: emptyBins(binCount) } : {}),
    };
  const buckets = Array.from({ length: binCount }, () => ({
    rows: [] as number[],
    weight: 0,
    predicted: 0,
    observed: 0,
    groups: new Set<string>(),
  }));
  let brierTotal = 0;
  rows.forEach((row, index) => {
    const weight = weights[index]!;
    brierTotal += weight * (row.probability - row.outcome) ** 2;
    const assignment = reliabilityBinForProbability(row.probability, binCount);
    const bucket = buckets[assignment.binIndex]!;
    bucket.rows.push(index);
    bucket.weight += weight;
    bucket.predicted += weight * row.probability;
    bucket.observed += weight * row.outcome;
    bucket.groups.add(row.duplicateGroup);
  });
  let expectedCalibrationError = 0;
  const bins = buckets.map((bucket, index): ReliabilityBin => {
    if (bucket.weight === 0)
      return {
        ...binBounds(index, binCount),
        siteCount: 0,
        duplicateGroupCount: 0,
        predictedProbability: null,
        observedSuccessRate: null,
        weightedSiteCount: 0,
      };
    const predictedProbability = bucket.predicted / bucket.weight;
    const observedSuccessRate = bucket.observed / bucket.weight;
    expectedCalibrationError +=
      (bucket.weight / totalWeight) *
      Math.abs(predictedProbability - observedSuccessRate);
    return {
      ...binBounds(index, binCount),
      siteCount: bucket.rows.length,
      duplicateGroupCount: bucket.groups.size,
      predictedProbability,
      observedSuccessRate,
      weightedSiteCount: bucket.weight,
    };
  });
  return {
    siteCount: rows.length,
    duplicateGroupCount: new Set(
      rows.map(({ duplicateGroup }) => duplicateGroup),
    ).size,
    brierScore: brierTotal / totalWeight,
    expectedCalibrationError,
    ...(withBins ? { bins } : {}),
  };
}

function emptyBins(binCount: number): ReliabilityBin[] {
  return Array.from({ length: binCount }, (_, index) => ({
    ...binBounds(index, binCount),
    siteCount: 0,
    duplicateGroupCount: 0,
    predictedProbability: null,
    observedSuccessRate: null,
    weightedSiteCount: 0,
  }));
}

function subgroupMetrics(
  rows: readonly OutputRow[],
  selected: readonly ReliabilityRow[],
  keyForRow: (row: OutputRow) => string,
  binCount: number,
): SubgroupMetric[] {
  const keys = [...new Set(rows.map(keyForRow))].sort((left, right) =>
    left.localeCompare(right),
  );
  return keys.map((name) => {
    const eligible = rows.filter((row) => keyForRow(row) === name);
    const eligibleSampleIds = new Set(
      eligible.map(({ observation }) => observation.sampleId),
    );
    const selectedForGroup = selected.filter(({ sampleId }) =>
      eligibleSampleIds.has(sampleId),
    );
    const scorableSelected = selectedForGroup.filter((row) => row.scorable);
    const siteMetric = reliabilityMetric(selectedForGroup, binCount, false);
    const groupMetric = reliabilityMetric(
      selectedForGroup,
      binCount,
      true,
      true,
    );
    return {
      name,
      eligibleSiteCount: eligible.length,
      eligibleDuplicateGroupCount: new Set(
        eligible.map(({ label }) => label.duplicateGroup),
      ).size,
      selectedSiteCount: selectedForGroup.length,
      selectedDuplicateGroupCount: new Set(
        selectedForGroup.map(({ duplicateGroup }) => duplicateGroup),
      ).size,
      selectedScorableSiteCount: scorableSelected.length,
      selectedUnscorableSiteCount:
        selectedForGroup.length - scorableSelected.length,
      coverage:
        eligible.length === 0 ? 0 : selectedForGroup.length / eligible.length,
      siteWeightedBrierScore: siteMetric.brierScore,
      siteWeightedExpectedCalibrationError: siteMetric.expectedCalibrationError,
      duplicateGroupWeightedBrierScore: groupMetric.brierScore,
      duplicateGroupWeightedExpectedCalibrationError:
        groupMetric.expectedCalibrationError,
    };
  });
}

function callShapeSensitivityMetric(
  name: string,
  eligibleRows: readonly OutputRow[],
  mappedSelectedRows: readonly ReliabilityRow[],
  binCount: number,
): CallShapeSensitivityMetric {
  const eligibleSampleIds = new Set(
    eligibleRows.map(({ observation }) => observation.sampleId),
  );
  const mapped = mappedSelectedRows.filter(({ sampleId }) =>
    eligibleSampleIds.has(sampleId),
  );
  const selected = eligibleRows.filter(({ selected }) => selected);
  const scorable = mapped.filter(({ scorable }) => scorable);
  const siteMetric = reliabilityMetric(mapped, binCount, false, true);
  const groupMetric = reliabilityMetric(mapped, binCount, true, true);
  return {
    name,
    eligibleSiteCount: eligibleRows.length,
    eligibleDuplicateGroupCount: new Set(
      eligibleRows.map(({ label }) => label.duplicateGroup),
    ).size,
    selectedSiteCount: selected.length,
    selectedDuplicateGroupCount: new Set(
      selected.map(({ label }) => label.duplicateGroup),
    ).size,
    mappedSelectedSiteCount: mapped.length,
    mappedSelectedDuplicateGroupCount: new Set(
      mapped.map(({ duplicateGroup }) => duplicateGroup),
    ).size,
    unmappedSelectedSiteCount: selected.length - mapped.length,
    selectionCoverage:
      eligibleRows.length === 0 ? 0 : selected.length / eligibleRows.length,
    mapCoverageOfSelected:
      selected.length === 0 ? null : mapped.length / selected.length,
    siteWeighted: siteMetric,
    scorableOnlySiteWeighted: reliabilityMetric(
      scorable,
      binCount,
      false,
      true,
    ),
    duplicateGroupWeighted: groupMetric,
  };
}

function callShapeSensitivity(
  rows: readonly OutputRow[],
  binCount: number,
): CallShapeSensitivity {
  const mappedRows = reliabilityRows(rows, "call-shape");
  const callShapeNames = [
    ...new Set(
      rows.map(({ observation }) => observation.calleeKind ?? "unknown"),
    ),
  ].sort((left, right) => left.localeCompare(right));
  return {
    method:
      "per-call-shape-isotonic-with-global-selection-and-group-cross-fit-v1",
    minimumTrainingDuplicateGroups: SHAPE_MAP_MIN_TRAINING_GROUPS,
    minimumTrainingScoreLevels: SHAPE_MAP_MIN_SCORE_LEVELS,
    total: callShapeSensitivityMetric(
      "all-call-shapes",
      rows,
      mappedRows,
      binCount,
    ),
    callShapes: callShapeNames.map((name) =>
      callShapeSensitivityMetric(
        name,
        rows.filter(
          ({ observation }) => (observation.calleeKind ?? "unknown") === name,
        ),
        mappedRows,
        binCount,
      ),
    ),
  };
}

function duplicateGroupPrecision(rows: readonly OutputRow[]): {
  readonly groupCount: number;
  readonly correctGroupCount: number;
  readonly precision: number | null;
} {
  const accepted = new Map<string, OutputRow[]>();
  for (const row of rows) {
    if (!row.selected) continue;
    const groupRows = accepted.get(row.label.duplicateGroup) ?? [];
    groupRows.push(row);
    accepted.set(row.label.duplicateGroup, groupRows);
  }
  const correctGroupCount = [...accepted.values()].filter((groupRows) =>
    groupRows.every((row) => row.selectedCorrect),
  ).length;
  return {
    groupCount: accepted.size,
    correctGroupCount,
    precision: accepted.size === 0 ? null : correctGroupCount / accepted.size,
  };
}

function selectedScorableRows(
  rows: readonly ReliabilityRow[],
): ReliabilityRow[] {
  return rows.filter(({ scorable }) => scorable);
}

function applyFold(
  foldIndex: number,
  allRows: readonly EligibleRow[],
  allObservations: readonly Phase2EvaluationObservation[],
  allLabels: readonly Phase2EvaluationLabel[],
  folds: ReadonlyMap<string, number>,
  aliases: SystemOneOracleAliases,
  options: Options,
  callShapes: readonly string[],
): { readonly rows: OutputRow[]; readonly metric: FoldMetric } {
  const trainingObservations = allObservations.filter(
    (row) => folds.get(row.duplicateGroup) !== foldIndex,
  );
  const trainingLabels = allLabels.filter(
    (label) => folds.get(label.duplicateGroup) !== foldIndex,
  );
  const threshold = selectSystemOneThreshold(
    trainingObservations,
    trainingLabels,
    aliases,
    options.targetAcceptedPrecision,
    options.targetDuplicateGroupPrecision,
  );
  const trainingRows = allRows.filter(
    (row) => folds.get(row.label.duplicateGroup) !== foldIndex,
  );
  const heldOutRows = allRows.filter(
    (row) => folds.get(row.label.duplicateGroup) === foldIndex,
  );
  const examples = selectedTrainingExamples(
    trainingRows,
    threshold.thresholdScore,
    aliases,
  );
  const model = fitIsotonicModel(examples);
  const shapeModelEntries = callShapes.map((callShape) => {
    const shapeRows = trainingRows.filter(
      (row) => (row.observation.calleeKind ?? "unknown") === callShape,
    );
    const shapeExamples = selectedTrainingExamples(
      shapeRows,
      threshold.thresholdScore,
      aliases,
    );
    const shapeModel = fitIsotonicModel(shapeExamples);
    const trainingSelectedDuplicateGroupCount = new Set(
      shapeExamples.map(({ duplicateGroup }) => duplicateGroup),
    ).size;
    const reasons: string[] = [];
    if (trainingSelectedDuplicateGroupCount < SHAPE_MAP_MIN_TRAINING_GROUPS)
      reasons.push("insufficient-training-duplicate-groups");
    if (shapeModel.scoreLevelCount < SHAPE_MAP_MIN_SCORE_LEVELS)
      reasons.push("insufficient-score-level-support");
    const supported = reasons.length === 0;
    return {
      callShape,
      model: supported ? shapeModel : null,
      metric: {
        callShape,
        trainingSelectedSiteCount: shapeExamples.length,
        trainingSelectedDuplicateGroupCount,
        scoreLevelCount: shapeModel.scoreLevelCount,
        status: supported ? ("fitted" as const) : ("unsupported" as const),
        reason: supported ? null : reasons.join(";"),
        fitHash: shapeModel.fitHash,
      },
    };
  });
  const supportedShapeModels = new Map(
    shapeModelEntries.flatMap(({ callShape, model }) =>
      model ? [[callShape, model] as const] : [],
    ),
  );
  const output = fitReliabilityRows(
    selectedRows(heldOutRows, threshold.thresholdScore, aliases),
    model,
    foldIndex,
    supportedShapeModels,
  );
  const selectedTrainingGroups = new Set(
    examples.map(({ duplicateGroup }) => duplicateGroup),
  );
  const heldOutSelected = output.filter((row) => row.selected);
  return {
    rows: output,
    metric: {
      foldIndex,
      heldOutDuplicateGroupCount: new Set(
        heldOutRows.map(({ label }) => label.duplicateGroup),
      ).size,
      trainingDuplicateGroupCount: new Set(
        trainingRows.map(({ label }) => label.duplicateGroup),
      ).size,
      heldOutEligibleSiteCount: heldOutRows.length,
      heldOutSelectedSiteCount: heldOutSelected.length,
      heldOutSelectedScorableSiteCount: heldOutSelected.filter(
        (row) => row.scorable,
      ).length,
      heldOutSelectedUnscorableSiteCount: heldOutSelected.filter(
        (row) => !row.scorable,
      ).length,
      trainingSelectedSiteCount: examples.length,
      trainingSelectedDuplicateGroupCount: selectedTrainingGroups.size,
      thresholdScore: threshold.thresholdScore,
      thresholdSelectionReason: threshold.reason,
      calibratorScoreLevelCount: model.scoreLevelCount,
      trainingLabelRowsHash: stableLabelsHash(trainingLabels),
      calibratorFitHash: model.fitHash,
      callShapeCalibrators: shapeModelEntries.map(({ metric }) => metric),
    },
  };
}

function meanOrNull(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length === 0
    ? null
    : available.reduce((sum, value) => sum + value, 0) / available.length;
}

function maximumOrNull(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length === 0 ? null : Math.max(...available);
}

export function evaluateSystemOneCalibrationQualityOof(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  oracleAliases: SystemOneOracleAliases,
  inputOptions: SystemOneCalibrationQualityOptions = {},
): SystemOneCalibrationQualityResult {
  const options = validateOptions(inputOptions);
  evaluateSystemOneSplit(
    observations,
    labels,
    oracleAliases,
    null,
    "calibration",
  );
  const groupIds = labels.map(({ duplicateGroup }) => duplicateGroup);
  const effectiveFoldCount = Math.min(
    options.foldCount,
    new Set(groupIds).size,
  );
  if (effectiveFoldCount < 2)
    throw new Error(
      "Group-cross-fitted calibration requires at least two duplicate groups.",
    );
  const assignments = assignDuplicateGroupFolds(groupIds, effectiveFoldCount);
  const conflictingGroups = labelConflictGroups(labels);
  const baseRows = eligibleRows(
    observations,
    labels,
    oracleAliases,
    conflictingGroups,
  );
  const callShapes = [
    ...new Set(
      baseRows.map(({ observation }) => observation.calleeKind ?? "unknown"),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const foldResults = Array.from({ length: effectiveFoldCount }, (_, index) =>
    applyFold(
      index,
      baseRows,
      observations,
      labels,
      assignments,
      oracleAliases,
      options,
      callShapes,
    ),
  );
  const outOfFoldRows = foldResults.flatMap(({ rows }) => rows);
  const selectedRowsOnly = outOfFoldRows.filter((row) => row.selected);
  const selectedMetrics = reliabilityRows(selectedRowsOnly);
  const scorableMetrics = selectedScorableRows(selectedMetrics);
  const siteWeighted = reliabilityMetric(
    selectedMetrics,
    options.binCount,
    false,
    true,
  );
  const duplicateGroupWeighted = reliabilityMetric(
    selectedMetrics,
    options.binCount,
    true,
    true,
  );
  const scorableOnlySiteWeighted = reliabilityMetric(
    scorableMetrics,
    options.binCount,
    false,
  );
  const families = subgroupMetrics(
    outOfFoldRows,
    selectedMetrics,
    (row) => row.label.repoFamily,
    options.binCount,
  );
  const callShapeMetrics = subgroupMetrics(
    outOfFoldRows,
    selectedMetrics,
    (row) => row.observation.calleeKind ?? "unknown",
    options.binCount,
  );
  const callShapeSensitivityMetrics = callShapeSensitivity(
    outOfFoldRows,
    options.binCount,
  );
  const groupPrecision = duplicateGroupPrecision(outOfFoldRows);
  const scorableEligibleSiteCount = baseRows.filter(
    ({ scorable }) => scorable,
  ).length;
  const selectedSiteCount = selectedRowsOnly.length;
  const abstentionCount = baseRows.length - selectedSiteCount;
  return {
    schemaVersion: 4,
    measurement: "phase2-p2b-system1-calibration-quality-oof/4",
    split: "calibration",
    method: METHOD,
    probabilityMeaning:
      "Cross-fitted estimate of the probability that an accepted top-ranked target is correct; abstentions have no probability and are excluded from ECE/Brier but remain in all-site coverage denominators.",
    foldCount: effectiveFoldCount,
    binCount: options.binCount,
    targetAcceptedPrecision: options.targetAcceptedPrecision,
    targetDuplicateGroupPrecision: options.targetDuplicateGroupPrecision,
    eligibleSiteCount: baseRows.length,
    eligibleDuplicateGroupCount: new Set(
      baseRows.map(({ label }) => label.duplicateGroup),
    ).size,
    scorableEligibleSiteCount,
    unscorableEligibleSiteCount: baseRows.length - scorableEligibleSiteCount,
    conflictingDuplicateGroupCount: conflictingGroups.size,
    selectedSiteCount,
    selectedScorableSiteCount: selectedRowsOnly.filter((row) => row.scorable)
      .length,
    selectedUnscorableSiteCount: selectedRowsOnly.filter((row) => !row.scorable)
      .length,
    selectedDuplicateGroupCount: groupPrecision.groupCount,
    correctSelectedDuplicateGroupCount: groupPrecision.correctGroupCount,
    selectedDuplicateGroupPrecision: groupPrecision.precision,
    abstentionCount,
    coverage: baseRows.length === 0 ? 0 : selectedSiteCount / baseRows.length,
    abstentionRate:
      baseRows.length === 0 ? 0 : abstentionCount / baseRows.length,
    siteWeighted,
    scorableOnlySiteWeighted,
    duplicateGroupWeighted,
    familyMacroSiteWeightedBrierScore: meanOrNull(
      families.map(({ siteWeightedBrierScore }) => siteWeightedBrierScore),
    ),
    worstFamilySiteWeightedBrierScore: maximumOrNull(
      families.map(({ siteWeightedBrierScore }) => siteWeightedBrierScore),
    ),
    familyMacroSiteWeightedEce: meanOrNull(
      families.map(
        ({ siteWeightedExpectedCalibrationError }) =>
          siteWeightedExpectedCalibrationError,
      ),
    ),
    worstFamilySiteWeightedEce: maximumOrNull(
      families.map(
        ({ siteWeightedExpectedCalibrationError }) =>
          siteWeightedExpectedCalibrationError,
      ),
    ),
    families,
    callShapes: callShapeMetrics,
    callShapeSensitivity: callShapeSensitivityMetrics,
    folds: foldResults.map(({ metric }) => metric),
    outOfFoldRowsHash: hashJson(
      outOfFoldRows
        .sort((left, right) =>
          left.observation.sampleId.localeCompare(right.observation.sampleId),
        )
        .map((row) => ({
          sampleId: row.observation.sampleId,
          duplicateGroup: row.label.duplicateGroup,
          foldIndex: row.foldIndex,
          selected: row.selected,
          score: row.observation.topRankScore,
          probability: row.probability,
          callShapeProbability: row.callShapeProbability,
          scorable: row.scorable,
          success: row.selectedCorrect,
        })),
    ),
    limitations: [
      "Calibration labels are reused only through deterministic duplicateGroup cross-fitting; each held group is excluded from its fold threshold and probability-map fit.",
      "The outcome for accepted rows with unmappable positive labels or conflicting duplicate labels is conservatively counted as failure; a separate scorable-only metric is reported.",
      "ECE/Brier cover accepted outputs only; abstentions receive no probability and are covered by the all-eligible coverage/abstention metrics.",
      "The isotonic probabilities and all metrics are calibration-split, two-family descriptive estimates; they are not production confidence, a confidence bound, certification, or heldout generalization evidence.",
    ],
  };
}
