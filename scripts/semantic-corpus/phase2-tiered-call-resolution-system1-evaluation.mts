import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";

export interface SystemOneSelectionDecision {
  readonly status: "likely" | "ambiguous";
  readonly selectedTargetId: string | null;
  readonly reason:
    | "selected-by-calibrated-threshold"
    | "no-calibrated-threshold"
    | "no-ranked-candidate"
    | "rank-tie"
    | "truncated-candidate-list"
    | "unsupported-call-shape"
    | "unmapped-target"
    | "score-below-threshold";
}

export interface SystemOneGroupMetric {
  readonly name: string;
  readonly eligibleSiteCount: number;
  readonly rawTop1CorrectCount: number;
  readonly rawTop1: number;
  readonly selectedSiteCount: number;
  readonly selectedCorrectSiteCount: number;
  readonly acceptedSitePrecision: number | null;
  readonly endToEndTop1: number;
}

export interface SystemOneSplitMetrics {
  readonly split: string;
  readonly eligibleSiteCount: number;
  readonly scorableLabelSiteCount: number;
  readonly unscorableLabelSiteCount: number;
  readonly rawTop1CorrectCount: number;
  readonly rawTop1: number;
  readonly selectedSiteCount: number;
  readonly coverage: number;
  readonly abstentionCount: number;
  readonly abstentionRate: number;
  readonly selectedCorrectSiteCount: number;
  readonly acceptedSitePrecision: number | null;
  readonly endToEndTop1: number;
  readonly acceptedDuplicateGroupCount: number;
  readonly correctAcceptedDuplicateGroupCount: number;
  readonly duplicateGroupPrecision: number | null;
  readonly selectedIncompleteInventorySiteCount: number;
  readonly familyMacroRawTop1: number | null;
  readonly worstFamilyRawTop1: number | null;
  readonly familyMacroEndToEndTop1: number | null;
  readonly worstFamilyEndToEndTop1: number | null;
  readonly families: readonly SystemOneGroupMetric[];
  readonly callShapes: readonly SystemOneGroupMetric[];
}

export interface SystemOneThresholdSelection {
  readonly thresholdScore: number | null;
  readonly targetAcceptedPrecision: number;
  readonly candidateThresholdCount: number;
  readonly qualifyingThresholdCount: number;
  readonly metrics: SystemOneSplitMetrics | null;
  readonly reason: "selected-max-coverage" | "no-threshold-meets-precision";
}

interface ScoredSystemOneRow {
  readonly observation: Phase2EvaluationObservation;
  readonly label: Phase2EvaluationLabel;
  readonly uniquePositiveTargetIds: readonly string[];
  readonly scorable: boolean;
  readonly rawCorrect: boolean;
  readonly selected: boolean;
  readonly selectedCorrect: boolean;
}

interface MutableGroupMetric {
  eligibleSiteCount: number;
  rawTop1CorrectCount: number;
  selectedSiteCount: number;
  selectedCorrectSiteCount: number;
}

interface GroupedRows {
  readonly rows: readonly ScoredSystemOneRow[];
  readonly labelsConflict: boolean;
}

function canonicalTarget(targetId: string): string {
  return targetId.replace(/@L\d+(?:#\d+)?$/, "");
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateSplitInputs(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  requiredSplit: string,
): Map<string, Phase2EvaluationLabel> {
  const labelsBySample = new Map(
    labels.map((label) => [label.sampleId, label]),
  );
  if (labelsBySample.size !== labels.length)
    throw new Error("System One labels contain duplicate sample IDs.");
  if (
    new Set(observations.map(({ sampleId }) => sampleId)).size !==
    observations.length
  )
    throw new Error("System One observations contain duplicate sample IDs.");
  for (const label of labels) {
    if (label.split !== requiredSplit)
      throw new Error(
        `System One labels must come from the ${requiredSplit} split.`,
      );
  }
  for (const observation of observations) {
    if (observation.split !== requiredSplit)
      throw new Error(
        `System One observations must come from the ${requiredSplit} split.`,
      );
    const label = labelsBySample.get(observation.sampleId);
    if (!label)
      throw new Error(`System One label missing for ${observation.sampleId}.`);
    if (
      label.duplicateGroup !== observation.duplicateGroup ||
      label.repoFamily !== observation.repoFamily
    )
      throw new Error(
        `System One grouping mismatch for ${observation.sampleId}.`,
      );
  }
  if (observations.length !== labels.length)
    throw new Error(
      "System One observations and labels have different row counts.",
    );
  return labelsBySample;
}

function eligibleSystemOneRows(
  observations: readonly Phase2EvaluationObservation[],
  labelsBySample: ReadonlyMap<string, Phase2EvaluationLabel>,
  uniqueAliases: ReadonlySet<string>,
): {
  readonly rows: readonly ScoredSystemOneRow[];
  readonly eligibleSiteCount: number;
} {
  const rows: ScoredSystemOneRow[] = [];
  let eligibleSiteCount = 0;
  for (const observation of observations) {
    const label = labelsBySample.get(observation.sampleId)!;
    if (
      label.reviewStatus !== "confirmed" ||
      label.positiveTargetIds.length === 0
    )
      continue;
    eligibleSiteCount++;
    const uniquePositiveTargetIds = [
      ...new Set(
        label.positiveTargetIds
          .map(canonicalTarget)
          .filter((targetId) => uniqueAliases.has(targetId)),
      ),
    ].sort();
    const rawCorrect =
      !observation.tied &&
      observation.topTargetId !== null &&
      uniqueAliases.has(canonicalTarget(observation.topTargetId)) &&
      label.positiveTargetIds
        .map(canonicalTarget)
        .includes(canonicalTarget(observation.topTargetId));
    rows.push({
      observation,
      label,
      uniquePositiveTargetIds,
      scorable: uniquePositiveTargetIds.length > 0,
      rawCorrect,
      selected: false,
      selectedCorrect: false,
    });
  }
  return { rows, eligibleSiteCount };
}

function groupSystemOneRows(
  rows: readonly ScoredSystemOneRow[],
): Map<string, GroupedRows> {
  const groups = new Map<string, ScoredSystemOneRow[]>();
  for (const row of rows) {
    const groupRows = groups.get(row.label.duplicateGroup) ?? [];
    groupRows.push(row);
    groups.set(row.label.duplicateGroup, groupRows);
  }
  return new Map(
    [...groups].map(([groupId, groupRows]) => {
      const positiveSets = new Set(
        groupRows.map((row) =>
          [...new Set(row.label.positiveTargetIds.map(canonicalTarget))]
            .sort()
            .join("\0"),
        ),
      );
      return [
        groupId,
        {
          rows: groupRows,
          labelsConflict: positiveSets.size > 1,
        },
      ];
    }),
  );
}

function groupMetricBucket(): MutableGroupMetric {
  return {
    eligibleSiteCount: 0,
    rawTop1CorrectCount: 0,
    selectedSiteCount: 0,
    selectedCorrectSiteCount: 0,
  };
}

function summarizeGroupMetric(
  name: string,
  bucket: MutableGroupMetric,
): SystemOneGroupMetric {
  return {
    name,
    ...bucket,
    rawTop1:
      bucket.eligibleSiteCount === 0
        ? 0
        : bucket.rawTop1CorrectCount / bucket.eligibleSiteCount,
    acceptedSitePrecision:
      bucket.selectedSiteCount === 0
        ? null
        : bucket.selectedCorrectSiteCount / bucket.selectedSiteCount,
    endToEndTop1:
      bucket.eligibleSiteCount === 0
        ? 0
        : bucket.selectedCorrectSiteCount / bucket.eligibleSiteCount,
  };
}

function groupMetrics(rows: readonly ScoredSystemOneRow[]): {
  readonly families: readonly SystemOneGroupMetric[];
  readonly callShapes: readonly SystemOneGroupMetric[];
} {
  const families = new Map<string, MutableGroupMetric>();
  const callShapes = new Map<string, MutableGroupMetric>();
  for (const row of rows) {
    for (const [map, key] of [
      [families, row.label.repoFamily],
      [callShapes, row.observation.calleeKind ?? "unknown"],
    ] as const) {
      const bucket = map.get(key) ?? groupMetricBucket();
      bucket.eligibleSiteCount++;
      if (row.rawCorrect) bucket.rawTop1CorrectCount++;
      if (row.selected) bucket.selectedSiteCount++;
      if (row.selectedCorrect) bucket.selectedCorrectSiteCount++;
      map.set(key, bucket);
    }
  }
  const summarize = (map: ReadonlyMap<string, MutableGroupMetric>) =>
    [...map]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, bucket]) => summarizeGroupMetric(name, bucket));
  return { families: summarize(families), callShapes: summarize(callShapes) };
}

export function selectSystemOne(
  observation: Phase2EvaluationObservation,
  thresholdScore: number | null,
  uniqueAliases: ReadonlySet<string>,
): SystemOneSelectionDecision {
  if (thresholdScore === null)
    return {
      status: "ambiguous",
      selectedTargetId: null,
      reason: "no-calibrated-threshold",
    };
  if (observation.unsupportedCallShape)
    return {
      status: "ambiguous",
      selectedTargetId: null,
      reason: "unsupported-call-shape",
    };
  if (observation.truncated)
    return {
      status: "ambiguous",
      selectedTargetId: null,
      reason: "truncated-candidate-list",
    };
  if (!observation.topTargetId || observation.topRankScore === null)
    return {
      status: "ambiguous",
      selectedTargetId: null,
      reason:
        observation.candidateTargetIds.length === 0
          ? "no-ranked-candidate"
          : "unmapped-target",
    };
  if (observation.tied)
    return { status: "ambiguous", selectedTargetId: null, reason: "rank-tie" };
  if (!uniqueAliases.has(canonicalTarget(observation.topTargetId)))
    return {
      status: "ambiguous",
      selectedTargetId: null,
      reason: "unmapped-target",
    };
  if (observation.topRankScore < thresholdScore)
    return {
      status: "ambiguous",
      selectedTargetId: null,
      reason: "score-below-threshold",
    };
  // candidateSetComplete intentionally does not gate empirical likely selection.
  // The strict proof result and Tier B authority remain separate consumers.
  return {
    status: "likely",
    selectedTargetId: observation.topTargetId,
    reason: "selected-by-calibrated-threshold",
  };
}

export function evaluateSystemOneSplit(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  uniqueAliases: ReadonlySet<string>,
  thresholdScore: number | null,
  split = observations[0]?.split ?? "unknown",
): SystemOneSplitMetrics {
  const labelsBySample = validateSplitInputs(observations, labels, split);
  const built = eligibleSystemOneRows(
    observations,
    labelsBySample,
    uniqueAliases,
  );
  const rows = built.rows.map((row) => {
    const selection = selectSystemOne(
      row.observation,
      thresholdScore,
      uniqueAliases,
    );
    const selected = selection.status === "likely";
    return {
      ...row,
      selected,
      selectedCorrect:
        selected &&
        row.uniquePositiveTargetIds.includes(
          canonicalTarget(row.observation.topTargetId!),
        ),
    };
  });
  const groups = groupSystemOneRows(rows);
  const selectedGroups = [...groups.values()].filter((group) =>
    group.rows.some((row) => row.selected),
  );
  const correctAcceptedDuplicateGroupCount = selectedGroups.filter(
    (group) =>
      !group.labelsConflict &&
      group.rows
        .filter((row) => row.selected)
        .every((row) => row.selectedCorrect),
  ).length;
  const selectedSiteCount = rows.filter((row) => row.selected).length;
  const selectedCorrectSiteCount = rows.filter(
    (row) => row.selectedCorrect,
  ).length;
  const rawTop1CorrectCount = rows.filter((row) => row.rawCorrect).length;
  const abstentionCount = built.eligibleSiteCount - selectedSiteCount;
  const grouped = groupMetrics(rows);
  const familyMetrics = grouped.families;
  const familyMacroRawTop1 =
    familyMetrics.length === 0
      ? null
      : familyMetrics.reduce((sum, family) => sum + family.rawTop1, 0) /
        familyMetrics.length;
  const familyMacroEndToEndTop1 =
    familyMetrics.length === 0
      ? null
      : familyMetrics.reduce((sum, family) => sum + family.endToEndTop1, 0) /
        familyMetrics.length;
  return {
    split,
    eligibleSiteCount: built.eligibleSiteCount,
    scorableLabelSiteCount: rows.filter((row) => row.scorable).length,
    unscorableLabelSiteCount:
      built.eligibleSiteCount - rows.filter((row) => row.scorable).length,
    rawTop1CorrectCount,
    rawTop1:
      built.eligibleSiteCount === 0
        ? 0
        : rawTop1CorrectCount / built.eligibleSiteCount,
    selectedSiteCount,
    coverage:
      built.eligibleSiteCount === 0
        ? 0
        : selectedSiteCount / built.eligibleSiteCount,
    abstentionCount,
    abstentionRate:
      built.eligibleSiteCount === 0
        ? 0
        : abstentionCount / built.eligibleSiteCount,
    selectedCorrectSiteCount,
    acceptedSitePrecision:
      selectedSiteCount === 0
        ? null
        : selectedCorrectSiteCount / selectedSiteCount,
    endToEndTop1:
      built.eligibleSiteCount === 0
        ? 0
        : selectedCorrectSiteCount / built.eligibleSiteCount,
    acceptedDuplicateGroupCount: selectedGroups.length,
    correctAcceptedDuplicateGroupCount,
    duplicateGroupPrecision:
      selectedGroups.length === 0
        ? null
        : correctAcceptedDuplicateGroupCount / selectedGroups.length,
    selectedIncompleteInventorySiteCount: rows.filter(
      (row) => row.selected && !row.observation.candidateSetComplete,
    ).length,
    familyMacroRawTop1,
    worstFamilyRawTop1:
      familyMetrics.length === 0
        ? null
        : Math.min(...familyMetrics.map((family) => family.rawTop1)),
    familyMacroEndToEndTop1,
    worstFamilyEndToEndTop1:
      familyMetrics.length === 0
        ? null
        : Math.min(...familyMetrics.map((family) => family.endToEndTop1)),
    ...grouped,
  };
}

export function selectSystemOneThreshold(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  uniqueAliases: ReadonlySet<string>,
  targetAcceptedPrecision = 0.9,
): SystemOneThresholdSelection {
  if (
    !Number.isFinite(targetAcceptedPrecision) ||
    targetAcceptedPrecision <= 0 ||
    targetAcceptedPrecision > 1
  )
    throw new Error("Target accepted precision must be in (0, 1].");
  const labelsBySample = validateSplitInputs(
    observations,
    labels,
    "calibration",
  );
  const eligibleRows = eligibleSystemOneRows(
    observations,
    labelsBySample,
    uniqueAliases,
  ).rows;
  const scores = [
    ...new Set(
      eligibleRows.flatMap((row) =>
        selectSystemOne(
          row.observation,
          Number.NEGATIVE_INFINITY,
          uniqueAliases,
        ).status === "likely" && row.observation.topRankScore !== null
          ? [row.observation.topRankScore]
          : [],
      ),
    ),
  ].sort((left, right) => left - right);
  const thresholds = scores.map((thresholdScore) => ({
    thresholdScore,
    metrics: evaluateSystemOneSplit(
      observations,
      labels,
      uniqueAliases,
      thresholdScore,
      "calibration",
    ),
  }));
  const qualifying = thresholds
    .filter(
      ({ metrics }) =>
        metrics.selectedSiteCount > 0 &&
        metrics.acceptedSitePrecision !== null &&
        metrics.duplicateGroupPrecision !== null &&
        metrics.acceptedSitePrecision >= targetAcceptedPrecision &&
        metrics.duplicateGroupPrecision >= targetAcceptedPrecision,
    )
    .sort(
      (left, right) =>
        right.metrics.selectedSiteCount - left.metrics.selectedSiteCount ||
        (right.metrics.acceptedSitePrecision ?? 0) -
          (left.metrics.acceptedSitePrecision ?? 0) ||
        (right.metrics.duplicateGroupPrecision ?? 0) -
          (left.metrics.duplicateGroupPrecision ?? 0) ||
        right.thresholdScore - left.thresholdScore,
    );
  const selected = qualifying[0];
  return {
    thresholdScore: selected?.thresholdScore ?? null,
    targetAcceptedPrecision,
    candidateThresholdCount: thresholds.length,
    qualifyingThresholdCount: qualifying.length,
    metrics: selected?.metrics ?? null,
    reason: selected ? "selected-max-coverage" : "no-threshold-meets-precision",
  };
}
