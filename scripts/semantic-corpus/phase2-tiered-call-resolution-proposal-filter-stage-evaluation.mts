import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import type {
  CandidateStageEvidence,
  CandidateTargetKeyMapping,
} from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import type { UniqueOracleEvaluationInputs } from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import {
  PROPOSAL_FILTER_STAGES,
  type ProposalFilterStageEvidence,
  type ProposalFilterStageEvidenceRow,
  type ProposalFilterStageName,
} from "./phase2-tiered-call-resolution-proposal-filter-stage-evidence.mjs";

export interface ProposalFilterStageEvaluationInput {
  readonly observations: readonly Phase2EvaluationObservation[];
  readonly candidateStages: readonly CandidateStageEvidence[];
  readonly evidence: readonly ProposalFilterStageEvidence[];
  readonly labels: readonly Phase2EvaluationLabel[];
  readonly uniqueInputs: UniqueOracleEvaluationInputs;
  readonly split: "train";
}

export interface ProposalFilterSizeSummary {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface ProposalFilterStageGroupMetrics {
  readonly name: string;
  readonly eligibleSiteCount: number;
  readonly uniqueMappablePositiveSiteCount: number;
  readonly unscorableEligibleSiteCount: number;
  readonly candidateGoldTargetOccurrenceCount: number;
  readonly coveredGoldTargetOccurrenceCount: number;
  readonly candidateRecall: number | null;
  readonly zeroCandidateSiteCount: number;
  readonly zeroCandidateRate: number;
  readonly zeroMappedTargetSiteCount: number;
  readonly zeroMappedTargetRate: number;
  readonly candidateKeySize: ProposalFilterSizeSummary;
  readonly uniqueMappedTargetSize: ProposalFilterSizeSummary;
  readonly mappedCandidateKeyCount: number;
  readonly ambiguousCandidateKeyCount: number;
  readonly unmappedCandidateKeyCount: number;
}

export interface ProposalFilterStageMetrics {
  readonly overall: ProposalFilterStageGroupMetrics;
  readonly byFamily: readonly ProposalFilterStageGroupMetrics[];
  readonly byCallShape: readonly ProposalFilterStageGroupMetrics[];
  readonly byFamilyAndCallShape: readonly ProposalFilterStageGroupMetrics[];
  readonly byRawEvidenceAvailability: readonly ProposalFilterStageGroupMetrics[];
}

export type ProposalFilterMetricStageName =
  "rawGeneratedKeys" | ProposalFilterStageName;

export interface ProposalFilterStageSplitMetrics {
  readonly split: "train";
  readonly allConfirmedEligibleSiteCount: number;
  readonly uniqueMappablePositiveSiteCount: number;
  readonly uniqueMappablePositiveTargetOccurrenceCount: number;
  readonly ambiguousPositiveTargetOccurrenceCount: number;
  readonly unmappedPositiveTargetOccurrenceCount: number;
  readonly stageOrder: readonly ProposalFilterMetricStageName[];
  readonly stages: Readonly<
    Record<ProposalFilterMetricStageName, ProposalFilterStageMetrics>
  >;
  readonly dropAudit: {
    readonly rawPresentGoldTargetOccurrenceCount: number;
    readonly rawAbsentGoldTargetOccurrenceCount: number;
    readonly finalProposalCoveredGoldTargetOccurrenceCount: number;
    readonly rawPresentThenDroppedGoldTargetOccurrenceCount: number;
    readonly afterCapDroppedGoldTargetOccurrenceCount: number;
    readonly rawPresentThenDroppedByFirstStage: Readonly<
      Record<string, number>
    >;
    readonly rawPresentThenDroppedByFamilyShapeAndFirstStage: readonly {
      readonly family: string;
      readonly callShape: string;
      readonly firstMissingStage: string;
      readonly targetOccurrenceCount: number;
    }[];
    readonly rawAbsentByFamilyAndCallShape: readonly {
      readonly family: string;
      readonly callShape: string;
      readonly targetOccurrenceCount: number;
    }[];
    readonly goldTargetOccurrencesMissingAtStage: Readonly<
      Record<string, number>
    >;
    readonly sitesTruncatedByMaxCandidates: number;
    readonly rawMappingStatusCounts: Readonly<Record<string, number>>;
  };
}

interface StagePoint {
  readonly name: ProposalFilterMetricStageName;
  readonly candidateKeys: readonly string[];
  readonly mappings: readonly CandidateTargetKeyMapping[];
  readonly uniqueMappedTargetIds: ReadonlySet<string>;
  readonly mappedCandidateKeyCount: number;
  readonly ambiguousCandidateKeyCount: number;
  readonly unmappedCandidateKeyCount: number;
}

interface EvaluationRow {
  readonly observation: Phase2EvaluationObservation;
  readonly label: Phase2EvaluationLabel;
  readonly goldTargets: readonly string[];
  readonly rawCandidateStage: CandidateStageEvidence;
  readonly filterEvidence: ProposalFilterStageEvidence;
  readonly points: readonly StagePoint[];
  readonly rawEvidenceAvailability: string;
}

interface MutableGroup {
  eligibleSiteCount: number;
  uniqueMappablePositiveSiteCount: number;
  unscorableEligibleSiteCount: number;
  candidateGoldTargetOccurrenceCount: number;
  coveredGoldTargetOccurrenceCount: number;
  zeroCandidateSiteCount: number;
  zeroMappedTargetSiteCount: number;
  candidateKeySizes: number[];
  uniqueMappedTargetSizes: number[];
  mappedCandidateKeyCount: number;
  ambiguousCandidateKeyCount: number;
  unmappedCandidateKeyCount: number;
}

const RAW_STAGE_NAME = "rawGeneratedKeys" as const;
const MAX_CANDIDATES = 25;
const METRIC_STAGE_ORDER: readonly ProposalFilterMetricStageName[] = [
  RAW_STAGE_NAME,
  ...PROPOSAL_FILTER_STAGES,
];

function canonicalTarget(targetId: string): string {
  return targetId.replace(/@L\d+(?:#\d+)?$/u, "");
}

function eligible(label: Phase2EvaluationLabel): boolean {
  return (
    label.reviewStatus === "confirmed" && label.positiveTargetIds.length > 0
  );
}

function ids(rows: readonly { readonly sampleId: string }[]): string[] {
  return rows.map((row) => row.sampleId);
}

function assertUniqueIds(
  rows: readonly { readonly sampleId: string }[],
  description: string,
): void {
  if (new Set(ids(rows)).size !== rows.length)
    throw new Error(`${description} contain duplicate sample IDs.`);
}

function assertSameIds(
  expected: readonly { readonly sampleId: string }[],
  actual: readonly { readonly sampleId: string }[],
  description: string,
): void {
  const expectedSet = new Set(ids(expected));
  const actualSet = new Set(ids(actual));
  if (
    expectedSet.size !== actualSet.size ||
    expected.length !== actual.length ||
    [...expectedSet].some((sampleId) => !actualSet.has(sampleId))
  )
    throw new Error(description);
}

function stageByName(
  evidence: ProposalFilterStageEvidence,
  stage: ProposalFilterStageName,
): ProposalFilterStageEvidenceRow {
  const row = evidence.stages.find((candidate) => candidate.stage === stage);
  if (!row) throw new Error(`Proposal stage '${stage}' is missing.`);
  return row;
}

function assertMappings(
  candidateKeys: readonly string[],
  mappings: readonly CandidateTargetKeyMapping[],
  idsInOrder: readonly (string | null)[],
  uniqueMappedIds: readonly string[],
  stageName: string,
): void {
  if (
    candidateKeys.length !== mappings.length ||
    mappings.length !== idsInOrder.length
  )
    throw new Error(`Candidate mapping lengths differ at ${stageName}.`);
  for (let index = 0; index < candidateKeys.length; index++) {
    const mapping = mappings[index]!;
    if (
      mapping.targetKey !== candidateKeys[index] ||
      mapping.targetId !== idsInOrder[index]
    )
      throw new Error(`Candidate mapping order differs at ${stageName}.`);
    if (mapping.status === "mapped" && mapping.targetId === null)
      throw new Error(`Mapped candidate lacks a target ID at ${stageName}.`);
    if (mapping.status !== "mapped" && mapping.targetId !== null)
      throw new Error(`Unmapped candidate has a target ID at ${stageName}.`);
  }
  const computedUnique = [
    ...new Set(
      mappings.flatMap((mapping) =>
        mapping.status === "mapped" && mapping.targetId !== null
          ? [mapping.targetId]
          : [],
      ),
    ),
  ].sort();
  if (JSON.stringify(computedUnique) !== JSON.stringify(uniqueMappedIds))
    throw new Error(`Unique mapped target IDs differ at ${stageName}.`);
}

function assertSubsequence(
  previous: readonly string[],
  next: readonly string[],
  stageName: string,
): void {
  let nextIndex = 0;
  for (const candidate of previous) {
    if (candidate === next[nextIndex]) nextIndex++;
  }
  if (nextIndex !== next.length)
    throw new Error(`Proposal filters must be monotonic at ${stageName}.`);
}

function makeStagePoint(
  name: ProposalFilterMetricStageName,
  candidateKeys: readonly string[],
  mappings: readonly CandidateTargetKeyMapping[],
): StagePoint {
  const uniqueMappedTargetIds = new Set(
    mappings.flatMap((mapping) =>
      mapping.status === "mapped" && mapping.targetId !== null
        ? [mapping.targetId]
        : [],
    ),
  );
  return {
    name,
    candidateKeys,
    mappings,
    uniqueMappedTargetIds,
    mappedCandidateKeyCount: mappings.filter(
      (mapping) => mapping.status === "mapped",
    ).length,
    ambiguousCandidateKeyCount: mappings.filter(
      (mapping) => mapping.status === "ambiguous",
    ).length,
    unmappedCandidateKeyCount: mappings.filter(
      (mapping) => mapping.status === "unmapped",
    ).length,
  };
}

function rawEvidenceAvailability(
  observation: Phase2EvaluationObservation,
  candidateStage: CandidateStageEvidence,
): string {
  if (
    observation.calleeKind === undefined ||
    observation.calleeKind === "unmapped"
  )
    return "missing-call-shape-evidence";
  if (observation.unsupportedCallShape) return "unsupported-call-shape";
  if (candidateStage.generatedCandidateKeys.length === 0)
    return "known-shape-generator-zero";
  if (candidateStage.mappedCandidateTargetIds.length === 0)
    return "raw-keys-without-unique-target-mapping";
  if (candidateStage.mappingSummary.generatedAmbiguous > 0)
    return "raw-keys-with-ambiguous-mapping";
  if (candidateStage.mappingSummary.generatedUnmapped > 0)
    return "raw-keys-with-unmapped-candidates";
  return "raw-keys-fully-mapped";
}

function rawPoint(evidence: CandidateStageEvidence): StagePoint {
  if (
    new Set(evidence.generatedCandidateKeys).size !==
    evidence.generatedCandidateKeys.length
  )
    throw new Error("Raw generated candidate keys must be unique.");
  assertMappings(
    evidence.generatedCandidateKeys,
    evidence.generatedCandidateKeyMappings,
    evidence.generatedCandidateKeyMappings.map(({ targetId }) => targetId),
    evidence.mappedCandidateTargetIds,
    RAW_STAGE_NAME,
  );
  assertStatusCounts(
    evidence.generatedCandidateKeyMappings,
    evidence.mappingSummary.generatedMapped,
    evidence.mappingSummary.generatedAmbiguous,
    evidence.mappingSummary.generatedUnmapped,
    RAW_STAGE_NAME,
  );
  return makeStagePoint(
    RAW_STAGE_NAME,
    evidence.generatedCandidateKeys,
    evidence.generatedCandidateKeyMappings,
  );
}

function filterPoints(evidence: ProposalFilterStageEvidence): StagePoint[] {
  if (
    evidence.schemaVersion !== 1 ||
    evidence.measurement !== "phase2-p2a-proposal-filter-stage-evidence/1" ||
    evidence.split !== "train" ||
    evidence.stages.length !== PROPOSAL_FILTER_STAGES.length
  )
    throw new Error("Unsupported proposal filter stage evidence.");
  const points = evidence.stages.map((stage, index) => {
    if (stage.stage !== PROPOSAL_FILTER_STAGES[index])
      throw new Error("Proposal filter stages are out of order.");
    assertMappings(
      stage.candidateKeys,
      stage.targetMappings,
      stage.targetIdsInOrder,
      stage.uniqueMappedTargetIds,
      stage.stage,
    );
    assertStatusCounts(
      stage.targetMappings,
      stage.mappingCounts.mappedKeyCount,
      stage.mappingCounts.ambiguousKeyCount,
      stage.mappingCounts.unmappedKeyCount,
      stage.stage,
    );
    if (
      stage.mappingCounts.candidateKeyCount !== stage.candidateKeys.length ||
      stage.mappingCounts.uniqueMappedTargetCount !==
        stage.uniqueMappedTargetIds.length
    )
      throw new Error(`Proposal mapping totals differ at ${stage.stage}.`);
    return makeStagePoint(
      stage.stage,
      stage.candidateKeys,
      stage.targetMappings,
    );
  });
  const beforeVisibility = points[0]!;
  if (
    new Set(beforeVisibility.candidateKeys).size !==
    beforeVisibility.candidateKeys.length
  )
    throw new Error(
      "Proposal candidate key stages must not contain duplicates.",
    );
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (new Set(current.candidateKeys).size !== current.candidateKeys.length)
      throw new Error(
        `Proposal stage '${current.name}' contains duplicate keys.`,
      );
    assertSubsequence(
      previous.candidateKeys,
      current.candidateKeys,
      current.name,
    );
  }
  if (
    JSON.stringify(points[4]?.candidateKeys) !==
    JSON.stringify(points[5]?.candidateKeys)
  )
    throw new Error(
      "Proposal output before maxCandidates must match afterArgumentShape.",
    );
  const beforeCap = points[5]!;
  const afterCap = points[6]!;
  const expectedAfterCapLength = Math.min(
    beforeCap.candidateKeys.length,
    MAX_CANDIDATES,
  );
  const expectedAfterCap = beforeCap.candidateKeys.slice(
    0,
    expectedAfterCapLength,
  );
  if (
    afterCap.candidateKeys.length !== expectedAfterCapLength ||
    JSON.stringify(afterCap.candidateKeys) !== JSON.stringify(expectedAfterCap)
  )
    throw new Error(
      "maxCandidates must retain exactly the first 25 proposals.",
    );
  return points;
}

function assertStatusCounts(
  mappings: readonly CandidateTargetKeyMapping[],
  mapped: number,
  ambiguous: number,
  unmapped: number,
  stageName: string,
): void {
  const actual = {
    mapped: mappings.filter(({ status }) => status === "mapped").length,
    ambiguous: mappings.filter(({ status }) => status === "ambiguous").length,
    unmapped: mappings.filter(({ status }) => status === "unmapped").length,
  };
  if (
    actual.mapped !== mapped ||
    actual.ambiguous !== ambiguous ||
    actual.unmapped !== unmapped
  )
    throw new Error(`Proposal mapping status counts differ at ${stageName}.`);
}

function validateRows(
  input: ProposalFilterStageEvaluationInput,
): EvaluationRow[] {
  const sets = [
    input.observations,
    input.candidateStages,
    input.evidence,
    input.labels,
    input.uniqueInputs.observations,
    input.uniqueInputs.labels,
  ];
  if (
    input.split !== "train" ||
    sets.some((rows) => rows.some((row) => row.split !== "train"))
  )
    throw new Error("Proposal-filter-stage metrics accept TRAIN rows only.");
  for (const [index, rows] of sets.entries())
    assertUniqueIds(rows, `TRAIN input set ${index}`);
  assertSameIds(
    input.observations,
    input.candidateStages,
    "Raw candidate stages must exactly match TRAIN predictions.",
  );
  assertSameIds(
    input.observations,
    input.evidence,
    "Proposal filter evidence must exactly match TRAIN predictions.",
  );
  assertSameIds(
    input.observations,
    input.labels,
    "TRAIN labels must exactly match predictions.",
  );
  assertSameIds(
    input.observations,
    input.uniqueInputs.observations,
    "Unique-oracle predictions must exactly match TRAIN predictions.",
  );
  assertSameIds(
    input.labels,
    input.uniqueInputs.labels,
    "Unique-oracle labels must exactly match TRAIN labels.",
  );

  const candidateById = new Map(
    input.candidateStages.map((row) => [row.sampleId, row]),
  );
  const evidenceById = new Map(
    input.evidence.map((row) => [row.sampleId, row]),
  );
  const labelsById = new Map(input.labels.map((row) => [row.sampleId, row]));
  const uniqueLabelsById = new Map(
    input.uniqueInputs.labels.map((row) => [row.sampleId, row]),
  );
  const rows: EvaluationRow[] = [];
  for (const observation of input.observations) {
    const label = labelsById.get(observation.sampleId)!;
    const uniqueLabel = uniqueLabelsById.get(observation.sampleId)!;
    const candidateStage = candidateById.get(observation.sampleId)!;
    const filterEvidence = evidenceById.get(observation.sampleId)!;
    if (
      label.duplicateGroup !== observation.duplicateGroup ||
      label.repoFamily !== observation.repoFamily ||
      (label.repoId !== undefined && label.repoId !== observation.repoId) ||
      uniqueLabel.duplicateGroup !== label.duplicateGroup ||
      uniqueLabel.repoFamily !== label.repoFamily
    )
      throw new Error(
        `TRAIN source/label grouping mismatch at ${observation.sampleId}.`,
      );
    if (
      candidateStage.sourceContentHash !== filterEvidence.sourceContentHash ||
      candidateStage.callSiteInputHash !== filterEvidence.callSiteInputHash ||
      candidateStage.generatedCandidateKeys.length !==
        observation.generatedCandidateCount ||
      candidateStage.orderedEvidenceProposals.length !==
        observation.proposedCandidateCount ||
      JSON.stringify(candidateStage.mappedCandidateTargetIds) !==
        JSON.stringify(observation.candidateTargetIds)
    )
      throw new Error(
        `Raw candidate-stage evidence differs from v4 decision at ${observation.sampleId}.`,
      );
    const raw = rawPoint(candidateStage);
    const filtered = filterPoints(filterEvidence);
    if (!sameKeySet(raw.candidateKeys, filtered[0]!.candidateKeys))
      throw new Error(
        `Pre-visibility candidates differ from raw generated keys at ${observation.sampleId}.`,
      );
    if (!sameMappingsByKey(raw.mappings, filtered[0]!.mappings))
      throw new Error(
        `Pre-visibility target mapping differs from raw evidence at ${observation.sampleId}.`,
      );
    const finalStage = candidateStage.orderedEvidenceProposals.map(
      ({ targetKey }) => targetKey,
    );
    if (
      JSON.stringify(finalStage) !== JSON.stringify(filtered[6]!.candidateKeys)
    )
      throw new Error(
        `Final proposal keys differ from v4 ordered proposals at ${observation.sampleId}.`,
      );
    const goldTargets = uniqueLabel.positiveTargetIds.map(canonicalTarget);
    if (goldTargets.length !== uniqueLabel.positiveTargetIds.length)
      throw new Error(
        `Unique-oracle target mapping contains a non-canonical target at ${observation.sampleId}.`,
      );
    rows.push({
      observation,
      label,
      goldTargets,
      rawCandidateStage: candidateStage,
      filterEvidence,
      points: [raw, ...filtered],
      rawEvidenceAvailability: rawEvidenceAvailability(
        observation,
        candidateStage,
      ),
    });
  }
  return rows;
}

function sameKeySet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((key) => right.includes(key))
  );
}

function sameMappingsByKey(
  left: readonly CandidateTargetKeyMapping[],
  right: readonly CandidateTargetKeyMapping[],
): boolean {
  const leftByKey = new Map(left.map((row) => [row.targetKey, row]));
  return (
    leftByKey.size === left.length &&
    left.length === right.length &&
    right.every((row) => {
      const original = leftByKey.get(row.targetKey);
      return (
        original?.status === row.status &&
        original.targetId === row.targetId &&
        original.reason === row.reason
      );
    })
  );
}

function emptyGroup(): MutableGroup {
  return {
    eligibleSiteCount: 0,
    uniqueMappablePositiveSiteCount: 0,
    unscorableEligibleSiteCount: 0,
    candidateGoldTargetOccurrenceCount: 0,
    coveredGoldTargetOccurrenceCount: 0,
    zeroCandidateSiteCount: 0,
    zeroMappedTargetSiteCount: 0,
    candidateKeySizes: [],
    uniqueMappedTargetSizes: [],
    mappedCandidateKeyCount: 0,
    ambiguousCandidateKeyCount: 0,
    unmappedCandidateKeyCount: 0,
  };
}

function record(
  group: MutableGroup,
  row: EvaluationRow,
  point: StagePoint,
): void {
  group.eligibleSiteCount++;
  if (row.goldTargets.length === 0) group.unscorableEligibleSiteCount++;
  else {
    group.uniqueMappablePositiveSiteCount++;
    group.candidateGoldTargetOccurrenceCount += row.goldTargets.length;
    group.coveredGoldTargetOccurrenceCount += row.goldTargets.filter(
      (targetId) => point.uniqueMappedTargetIds.has(targetId),
    ).length;
  }
  if (point.candidateKeys.length === 0) group.zeroCandidateSiteCount++;
  if (point.uniqueMappedTargetIds.size === 0) group.zeroMappedTargetSiteCount++;
  group.candidateKeySizes.push(point.candidateKeys.length);
  group.uniqueMappedTargetSizes.push(point.uniqueMappedTargetIds.size);
  group.mappedCandidateKeyCount += point.mappedCandidateKeyCount;
  group.ambiguousCandidateKeyCount += point.ambiguousCandidateKeyCount;
  group.unmappedCandidateKeyCount += point.unmappedCandidateKeyCount;
}

function quantile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

function sizeSummary(values: readonly number[]): ProposalFilterSizeSummary {
  return {
    p50: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    max: Math.max(0, ...values),
  };
}

function summarizeGroup(
  name: string,
  group: MutableGroup,
): ProposalFilterStageGroupMetrics {
  return {
    name,
    eligibleSiteCount: group.eligibleSiteCount,
    uniqueMappablePositiveSiteCount: group.uniqueMappablePositiveSiteCount,
    unscorableEligibleSiteCount: group.unscorableEligibleSiteCount,
    candidateGoldTargetOccurrenceCount:
      group.candidateGoldTargetOccurrenceCount,
    coveredGoldTargetOccurrenceCount: group.coveredGoldTargetOccurrenceCount,
    candidateRecall:
      group.candidateGoldTargetOccurrenceCount === 0
        ? null
        : group.coveredGoldTargetOccurrenceCount /
          group.candidateGoldTargetOccurrenceCount,
    zeroCandidateSiteCount: group.zeroCandidateSiteCount,
    zeroCandidateRate:
      group.eligibleSiteCount === 0
        ? 0
        : group.zeroCandidateSiteCount / group.eligibleSiteCount,
    zeroMappedTargetSiteCount: group.zeroMappedTargetSiteCount,
    zeroMappedTargetRate:
      group.eligibleSiteCount === 0
        ? 0
        : group.zeroMappedTargetSiteCount / group.eligibleSiteCount,
    candidateKeySize: sizeSummary(group.candidateKeySizes),
    uniqueMappedTargetSize: sizeSummary(group.uniqueMappedTargetSizes),
    mappedCandidateKeyCount: group.mappedCandidateKeyCount,
    ambiguousCandidateKeyCount: group.ambiguousCandidateKeyCount,
    unmappedCandidateKeyCount: group.unmappedCandidateKeyCount,
  };
}

function stageMetrics(
  rows: readonly EvaluationRow[],
  index: number,
): ProposalFilterStageMetrics {
  const overall = emptyGroup();
  const families = new Map<string, MutableGroup>();
  const callShapes = new Map<string, MutableGroup>();
  const familyShapes = new Map<string, MutableGroup>();
  const availability = new Map<string, MutableGroup>();
  for (const row of rows) {
    if (!eligible(row.label)) continue;
    const point = row.points[index]!;
    record(overall, row, point);
    const family = groupFor(families, row.label.repoFamily);
    record(family, row, point);
    const callShape = row.observation.calleeKind ?? "unknown";
    record(groupFor(callShapes, callShape), row, point);
    record(
      groupFor(familyShapes, `${row.label.repoFamily} × ${callShape}`),
      row,
      point,
    );
    record(groupFor(availability, row.rawEvidenceAvailability), row, point);
  }
  return {
    overall: summarizeGroup("all confirmed eligible sites", overall),
    byFamily: summarizeMap(families),
    byCallShape: summarizeMap(callShapes),
    byFamilyAndCallShape: summarizeMap(familyShapes),
    byRawEvidenceAvailability: summarizeMap(availability),
  };
}

function groupFor(
  groups: Map<string, MutableGroup>,
  key: string,
): MutableGroup {
  const group = groups.get(key) ?? emptyGroup();
  groups.set(key, group);
  return group;
}

function summarizeMap(
  groups: ReadonlyMap<string, MutableGroup>,
): ProposalFilterStageGroupMetrics[] {
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, group]) => summarizeGroup(name, group));
}

function dropAudit(
  rows: readonly EvaluationRow[],
): ProposalFilterStageSplitMetrics["dropAudit"] {
  const rawPresentThenDroppedByFirstStage: Record<string, number> = {};
  const goldTargetOccurrencesMissingAtStage: Record<string, number> = {};
  const rawPresentThenDroppedByFamilyShapeAndFirstStage = new Map<
    string,
    number
  >();
  const rawAbsentByFamilyAndCallShape = new Map<string, number>();
  const rawMappingStatusCounts: Record<string, number> = {
    mapped: 0,
    ambiguous: 0,
    unmapped: 0,
  };
  let rawPresentGoldTargetOccurrenceCount = 0;
  let rawAbsentGoldTargetOccurrenceCount = 0;
  let finalProposalCoveredGoldTargetOccurrenceCount = 0;
  let rawPresentThenDroppedGoldTargetOccurrenceCount = 0;
  let afterCapDroppedGoldTargetOccurrenceCount = 0;
  let sitesTruncatedByMaxCandidates = 0;

  for (const row of rows) {
    if (!eligible(row.label)) continue;
    for (const mapping of row.rawCandidateStage.generatedCandidateKeyMappings)
      rawMappingStatusCounts[mapping.status]++;
    const beforeCap = row.points[6]!;
    const afterCap = row.points[7]!;
    if (beforeCap.candidateKeys.length > afterCap.candidateKeys.length)
      sitesTruncatedByMaxCandidates++;
    for (const targetId of row.goldTargets) {
      const callShape = row.observation.calleeKind ?? "unknown";
      const isPresent = row.points.map((point) =>
        point.uniqueMappedTargetIds.has(targetId),
      );
      if (isPresent[0]) rawPresentGoldTargetOccurrenceCount++;
      else {
        rawAbsentGoldTargetOccurrenceCount++;
        incrementGroupCount(
          rawAbsentByFamilyAndCallShape,
          `${row.label.repoFamily}\u0000${callShape}`,
        );
      }
      for (let index = 0; index < row.points.length; index++)
        if (!isPresent[index]) {
          const name = row.points[index]!.name;
          goldTargetOccurrencesMissingAtStage[name] =
            (goldTargetOccurrencesMissingAtStage[name] ?? 0) + 1;
        }
      if (isPresent[7]) finalProposalCoveredGoldTargetOccurrenceCount++;
      if (isPresent[0] && !isPresent[7]) {
        rawPresentThenDroppedGoldTargetOccurrenceCount++;
        const firstMissingIndex = isPresent.findIndex((value) => !value);
        const firstMissingStage =
          row.points[firstMissingIndex]?.name ?? "unknown";
        rawPresentThenDroppedByFirstStage[firstMissingStage] =
          (rawPresentThenDroppedByFirstStage[firstMissingStage] ?? 0) + 1;
        incrementGroupCount(
          rawPresentThenDroppedByFamilyShapeAndFirstStage,
          `${row.label.repoFamily}\u0000${callShape}\u0000${firstMissingStage}`,
        );
      }
      if (isPresent[6] && !isPresent[7])
        afterCapDroppedGoldTargetOccurrenceCount++;
    }
  }
  return {
    rawPresentGoldTargetOccurrenceCount,
    rawAbsentGoldTargetOccurrenceCount,
    finalProposalCoveredGoldTargetOccurrenceCount,
    rawPresentThenDroppedGoldTargetOccurrenceCount,
    afterCapDroppedGoldTargetOccurrenceCount,
    rawPresentThenDroppedByFirstStage: sortRecord(
      rawPresentThenDroppedByFirstStage,
    ),
    rawPresentThenDroppedByFamilyShapeAndFirstStage: [
      ...rawPresentThenDroppedByFamilyShapeAndFirstStage,
    ]
      .map(([key, targetOccurrenceCount]) => {
        const [family, callShape, firstMissingStage] = key.split("\u0000");
        return {
          family: family!,
          callShape: callShape!,
          firstMissingStage: firstMissingStage!,
          targetOccurrenceCount,
        };
      })
      .sort(
        (left, right) =>
          left.family.localeCompare(right.family) ||
          left.callShape.localeCompare(right.callShape) ||
          left.firstMissingStage.localeCompare(right.firstMissingStage),
      ),
    rawAbsentByFamilyAndCallShape: [...rawAbsentByFamilyAndCallShape]
      .map(([key, targetOccurrenceCount]) => {
        const [family, callShape] = key.split("\u0000");
        return {
          family: family!,
          callShape: callShape!,
          targetOccurrenceCount,
        };
      })
      .sort(
        (left, right) =>
          left.family.localeCompare(right.family) ||
          left.callShape.localeCompare(right.callShape),
      ),
    goldTargetOccurrencesMissingAtStage: sortRecord(
      goldTargetOccurrencesMissingAtStage,
    ),
    sitesTruncatedByMaxCandidates,
    rawMappingStatusCounts,
  };
}

function incrementGroupCount(groups: Map<string, number>, key: string): void {
  groups.set(key, (groups.get(key) ?? 0) + 1);
}

function sortRecord(
  input: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** TRAIN-only audit of exact target memberships at every proposal-filter stage. */
export function evaluateProposalFilterStageSplit(
  input: ProposalFilterStageEvaluationInput,
): ProposalFilterStageSplitMetrics {
  const rows = validateRows(input);
  const eligibleLabels = input.labels.filter(eligible);
  const uniquePositiveLabels = input.uniqueInputs.labels.filter(eligible);
  const uniqueMappablePositiveTargetOccurrenceCount =
    uniquePositiveLabels.reduce(
      (total, row) => total + row.positiveTargetIds.length,
      0,
    );
  const stages = Object.fromEntries(
    METRIC_STAGE_ORDER.map((stage, index) => [
      stage,
      stageMetrics(rows, index),
    ]),
  ) as Readonly<
    Record<ProposalFilterMetricStageName, ProposalFilterStageMetrics>
  >;
  if (
    stages.rawGeneratedKeys.overall.candidateGoldTargetOccurrenceCount !==
      uniqueMappablePositiveTargetOccurrenceCount ||
    stages.afterMaxCandidates.overall.candidateGoldTargetOccurrenceCount !==
      uniqueMappablePositiveTargetOccurrenceCount
  )
    throw new Error(
      "Proposal-stage denominator differs from unique mapped labels.",
    );
  return {
    split: "train",
    allConfirmedEligibleSiteCount: eligibleLabels.length,
    uniqueMappablePositiveSiteCount: uniquePositiveLabels.length,
    uniqueMappablePositiveTargetOccurrenceCount,
    ambiguousPositiveTargetOccurrenceCount:
      input.uniqueInputs.ambiguousPositiveTargetOccurrenceCount,
    unmappedPositiveTargetOccurrenceCount:
      input.uniqueInputs.unmappedPositiveTargetOccurrenceCount,
    stageOrder: METRIC_STAGE_ORDER,
    stages,
    dropAudit: dropAudit(rows),
  };
}
