import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import type { UniqueOracleEvaluationInputs } from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import type { CandidateStageEvidence } from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";

export interface CandidateStageEvaluationInput {
  readonly observations: readonly Phase2EvaluationObservation[];
  readonly evidence: readonly CandidateStageEvidence[];
  readonly labels: readonly Phase2EvaluationLabel[];
  readonly uniqueInputs: UniqueOracleEvaluationInputs;
  readonly split: "train";
}

export interface CandidateStageGroupMetrics {
  readonly name: string;
  readonly eligibleSiteCount: number;
  readonly candidateGoldTargetCount: number;
  readonly uniqueMappablePositiveSiteCount: number;
  readonly unscorableEligibleSiteCount: number;
  readonly coveredGoldTargetCount: number;
  readonly candidateRecall: number | null;
  readonly zeroCandidateSiteCount: number;
  readonly zeroCandidateRate: number;
  readonly zeroMappedTargetSiteCount: number;
  readonly zeroMappedTargetRate: number;
  readonly candidateSetSizeP50: number;
  readonly candidateSetSizeP95: number;
  readonly candidateSetSizeMax: number;
  readonly mappedTargetSetSizeP50: number;
  readonly mappedTargetSetSizeP95: number;
  readonly mappedTargetSetSizeMax: number;
  readonly mappedCandidateMembershipCount: number;
  readonly ambiguousCandidateMembershipCount: number;
  readonly unmappedCandidateMembershipCount: number;
  readonly candidateKeyMappingCount: number;
  readonly candidateKeyMappingCoverage: number | null;
}

export interface CandidateStageMetrics {
  readonly overall: CandidateStageGroupMetrics;
  readonly byFamily: readonly CandidateStageGroupMetrics[];
  readonly byCallShape: readonly CandidateStageGroupMetrics[];
  readonly byFamilyAndCallShape: readonly CandidateStageGroupMetrics[];
  readonly byEvidenceAvailability: readonly CandidateStageGroupMetrics[];
}

export interface CandidateStageSplitMetrics {
  readonly split: "train";
  readonly allConfirmedEligibleSiteCount: number;
  readonly uniqueMappablePositiveTargetOccurrenceCount: number;
  readonly uniqueMappablePositiveSiteCount: number;
  readonly ambiguousPositiveTargetOccurrenceCount: number;
  readonly unmappedPositiveTargetOccurrenceCount: number;
  readonly stages: {
    readonly rawGeneratedKeys: CandidateStageMetrics;
    readonly mappedGeneratedTargetIds: CandidateStageMetrics;
    readonly orderedEvidenceProposals: CandidateStageMetrics;
  };
  readonly missAudit: {
    readonly rawMissTargetOccurrenceCount: number;
    readonly proposalMissTargetOccurrenceCount: number;
    readonly proposalOnlyDroppedTargetOccurrenceCount: number;
    readonly unsupportedZeroCandidateSiteCount: number;
    readonly supportedZeroCandidateSiteCount: number;
    readonly missingCallShapeEvidenceZeroCandidateSiteCount: number;
    readonly rawMissReasons: Readonly<Record<string, number>>;
    readonly proposalMissReasons: Readonly<Record<string, number>>;
  };
}

interface EvaluationRow {
  readonly observation: Phase2EvaluationObservation;
  readonly label: Phase2EvaluationLabel;
  readonly evidence: CandidateStageEvidence;
  readonly goldTargets: ReadonlySet<string>;
}

interface StageRow extends EvaluationRow {
  readonly candidateCount: number;
  readonly mappedTargetIds: ReadonlySet<string>;
  readonly mappedMembershipCount: number;
  readonly ambiguousMembershipCount: number;
  readonly unmappedMembershipCount: number;
  readonly mappingCount: number;
}

interface MutableGroup {
  eligibleSiteCount: number;
  candidateGoldTargetCount: number;
  uniqueMappablePositiveSiteCount: number;
  unscorableEligibleSiteCount: number;
  coveredGoldTargetCount: number;
  zeroCandidateSiteCount: number;
  zeroMappedTargetSiteCount: number;
  candidateSetSizes: number[];
  mappedTargetSetSizes: number[];
  mappedCandidateMembershipCount: number;
  ambiguousCandidateMembershipCount: number;
  unmappedCandidateMembershipCount: number;
  candidateKeyMappingCount: number;
}

interface StageView {
  readonly rows: readonly StageRow[];
  readonly grouped: CandidateStageMetrics;
}

function canonicalTarget(targetId: string): string {
  return targetId.replace(/@L\d+(?:#\d+)?$/u, "");
}

function ids(rows: readonly { readonly sampleId: string }[]): string[] {
  return rows.map((row) => row.sampleId);
}

function assertUniqueIds(
  values: readonly { readonly sampleId: string }[],
  description: string,
): void {
  if (new Set(ids(values)).size !== values.length)
    throw new Error(`${description} contain duplicate sample IDs.`);
}

function assertSameIds(
  expected: readonly { readonly sampleId: string }[],
  actual: readonly { readonly sampleId: string }[],
  message: string,
): void {
  const expectedIds = new Set(ids(expected));
  const actualIds = new Set(ids(actual));
  if (
    expectedIds.size !== actualIds.size ||
    expected.length !== actual.length ||
    [...expectedIds].some((sampleId) => !actualIds.has(sampleId))
  )
    throw new Error(message);
}

function eligible(label: Phase2EvaluationLabel): boolean {
  return (
    label.reviewStatus === "confirmed" && label.positiveTargetIds.length > 0
  );
}

function knownCallShape(observation: Phase2EvaluationObservation): boolean {
  return (
    observation.calleeKind !== undefined &&
    observation.calleeKind !== "unmapped"
  );
}

function quantile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)] ?? 0;
}

function emptyGroup(): MutableGroup {
  return {
    eligibleSiteCount: 0,
    candidateGoldTargetCount: 0,
    uniqueMappablePositiveSiteCount: 0,
    unscorableEligibleSiteCount: 0,
    coveredGoldTargetCount: 0,
    zeroCandidateSiteCount: 0,
    zeroMappedTargetSiteCount: 0,
    candidateSetSizes: [],
    mappedTargetSetSizes: [],
    mappedCandidateMembershipCount: 0,
    ambiguousCandidateMappingCount: 0,
    unmappedCandidateMembershipCount: 0,
    candidateKeyMappingCount: 0,
  };
}

function evidenceAvailability(row: StageRow): string {
  if (row.evidence.generatedCandidateKeys.length === 0) {
    const scoreability = row.goldTargets.size > 0 ? "scorable" : "unscorable";
    if (!knownCallShape(row.observation))
      return `zero-candidates-missing-call-shape-evidence-${scoreability}`;
    if (row.observation.unsupportedCallShape)
      return `zero-candidates-unsupported-${scoreability}`;
    return `zero-candidates-known-shape-${scoreability}`;
  }
  if (row.evidence.mappedCandidateTargetIds.length === 0)
    return "raw-keys-without-mapped-targets";
  if (
    row.evidence.mappingSummary.generatedAmbiguous > 0 ||
    row.evidence.mappingSummary.generatedUnmapped > 0
  )
    return "raw-keys-with-ambiguous-or-unmapped-targets";
  return "raw-keys-fully-mapped";
}

function record(group: MutableGroup, row: StageRow): void {
  group.eligibleSiteCount++;
  group.candidateGoldTargetCount += row.goldTargets.size;
  if (row.goldTargets.size > 0) group.uniqueMappablePositiveSiteCount++;
  else group.unscorableEligibleSiteCount++;
  group.coveredGoldTargetCount += [...row.goldTargets].filter((targetId) =>
    row.mappedTargetIds.has(targetId),
  ).length;
  if (row.candidateCount === 0) group.zeroCandidateSiteCount++;
  if (row.mappedTargetIds.size === 0) group.zeroMappedTargetSiteCount++;
  group.candidateSetSizes.push(row.candidateCount);
  group.mappedTargetSetSizes.push(row.mappedTargetIds.size);
  group.mappedCandidateMembershipCount += row.mappedMembershipCount;
  group.ambiguousCandidateMappingCount += row.ambiguousMembershipCount;
  group.unmappedCandidateMembershipCount += row.unmappedMembershipCount;
  group.candidateKeyMappingCount += row.mappingCount;
}

function summarizeGroup(
  name: string,
  group: MutableGroup,
): CandidateStageGroupMetrics {
  return {
    name,
    eligibleSiteCount: group.eligibleSiteCount,
    candidateGoldTargetCount: group.candidateGoldTargetCount,
    uniqueMappablePositiveSiteCount: group.uniqueMappablePositiveSiteCount,
    unscorableEligibleSiteCount: group.unscorableEligibleSiteCount,
    coveredGoldTargetCount: group.coveredGoldTargetCount,
    candidateRecall:
      group.candidateGoldTargetCount === 0
        ? null
        : group.coveredGoldTargetCount / group.candidateGoldTargetCount,
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
    candidateSetSizeP50: quantile(group.candidateSetSizes, 0.5),
    candidateSetSizeP95: quantile(group.candidateSetSizes, 0.95),
    candidateSetSizeMax: Math.max(0, ...group.candidateSetSizes),
    mappedTargetSetSizeP50: quantile(group.mappedTargetSetSizes, 0.5),
    mappedTargetSetSizeP95: quantile(group.mappedTargetSetSizes, 0.95),
    mappedTargetSetSizeMax: Math.max(0, ...group.mappedTargetSetSizes),
    mappedCandidateMembershipCount: group.mappedCandidateMembershipCount,
    ambiguousCandidateMembershipCount: group.ambiguousCandidateMappingCount,
    unmappedCandidateMembershipCount: group.unmappedCandidateMembershipCount,
    candidateKeyMappingCount: group.candidateKeyMappingCount,
    candidateKeyMappingCoverage:
      group.candidateKeyMappingCount === 0
        ? null
        : group.mappedCandidateMembershipCount / group.candidateKeyMappingCount,
  };
}

function groupedMetrics(rows: readonly StageRow[]): CandidateStageMetrics {
  const overall = emptyGroup();
  const families = new Map<string, MutableGroup>();
  const callShapes = new Map<string, MutableGroup>();
  const familyCallShapes = new Map<string, MutableGroup>();
  const evidenceAvailabilityGroups = new Map<string, MutableGroup>();
  for (const row of rows) {
    record(overall, row);
    const family = row.label.repoFamily;
    const shape = row.observation.calleeKind ?? "unknown";
    const familyBucket = families.get(family) ?? emptyGroup();
    record(familyBucket, row);
    families.set(family, familyBucket);
    const shapeBucket = callShapes.get(shape) ?? emptyGroup();
    record(shapeBucket, row);
    callShapes.set(shape, shapeBucket);
    const familyShapeName = `${family} × ${shape}`;
    const familyShapeBucket =
      familyCallShapes.get(familyShapeName) ?? emptyGroup();
    record(familyShapeBucket, row);
    familyCallShapes.set(familyShapeName, familyShapeBucket);
    const evidenceName = evidenceAvailability(row);
    const evidenceBucket =
      evidenceAvailabilityGroups.get(evidenceName) ?? emptyGroup();
    record(evidenceBucket, row);
    evidenceAvailabilityGroups.set(evidenceName, evidenceBucket);
  }
  const summarize = (groups: ReadonlyMap<string, MutableGroup>) =>
    [...groups]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, group]) => summarizeGroup(name, group));
  return {
    overall: summarizeGroup("all confirmed eligible sites", overall),
    byFamily: summarize(families),
    byCallShape: summarize(callShapes),
    byFamilyAndCallShape: summarize(familyCallShapes),
    byEvidenceAvailability: summarize(evidenceAvailabilityGroups),
  };
}

function stageRows(
  rows: readonly EvaluationRow[],
  stage: "raw" | "mapped" | "proposals",
): StageRow[] {
  return rows.map((row) => {
    const { evidence } = row;
    if (stage === "raw")
      return {
        ...row,
        candidateCount: evidence.generatedCandidateKeys.length,
        mappedTargetIds: new Set(evidence.mappedCandidateTargetIds),
        mappedMembershipCount: evidence.mappingSummary.generatedMapped,
        ambiguousMembershipCount: evidence.mappingSummary.generatedAmbiguous,
        unmappedMembershipCount: evidence.mappingSummary.generatedUnmapped,
        mappingCount: evidence.generatedCandidateKeyMappings.length,
      };
    if (stage === "mapped")
      return {
        ...row,
        candidateCount: evidence.mappedCandidateTargetIds.length,
        mappedTargetIds: new Set(evidence.mappedCandidateTargetIds),
        mappedMembershipCount: evidence.mappedCandidateTargetIds.length,
        ambiguousMembershipCount: 0,
        unmappedMembershipCount: 0,
        mappingCount: 0,
      };
    const mappedTargetIds = new Set(
      evidence.orderedEvidenceProposals.flatMap((proposal) =>
        proposal.status === "mapped" && proposal.targetId !== null
          ? [proposal.targetId]
          : [],
      ),
    );
    return {
      ...row,
      candidateCount: evidence.orderedEvidenceProposals.length,
      mappedTargetIds,
      mappedMembershipCount: evidence.mappingSummary.proposalMapped,
      ambiguousMembershipCount: evidence.mappingSummary.proposalAmbiguous,
      unmappedMembershipCount: evidence.mappingSummary.proposalUnmapped,
      mappingCount: evidence.orderedEvidenceProposals.length,
    };
  });
}

function stageView(
  rows: readonly EvaluationRow[],
  stage: "raw" | "mapped" | "proposals",
): StageView {
  const allRows = stageRows(rows, stage);
  const eligibleRows = allRows.filter((row) => eligible(row.label));
  return { rows: eligibleRows, grouped: groupedMetrics(eligibleRows) };
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function rawMissReason(
  row: EvaluationRow,
  rawTargets: ReadonlySet<string>,
): string {
  const { evidence, observation } = row;
  if (evidence.generatedCandidateKeys.length === 0) {
    if (!knownCallShape(observation))
      return "missing-call-shape-evidence-expected-lsp-fallback";
    if (observation.unsupportedCallShape)
      return "unsupported-call-shape-expected-lsp-fallback";
    return "supported-shape-generator-zero";
  }
  if (
    rawTargets.size === 0 &&
    (evidence.mappingSummary.generatedAmbiguous > 0 ||
      evidence.mappingSummary.generatedUnmapped > 0)
  )
    return "generated-keys-without-unique-target-mapping";
  if (
    evidence.mappingSummary.generatedAmbiguous > 0 ||
    evidence.mappingSummary.generatedUnmapped > 0
  )
    return "gold-target-absent-with-partial-key-mapping";
  return "generator-did-not-propose-gold-target";
}

function validateInput(input: CandidateStageEvaluationInput): EvaluationRow[] {
  if (
    input.split !== "train" ||
    input.observations.some((row) => row.split !== "train") ||
    input.evidence.some((row) => row.split !== "train") ||
    input.labels.some((row) => row.split !== "train") ||
    input.uniqueInputs.observations.some((row) => row.split !== "train") ||
    input.uniqueInputs.labels.some((row) => row.split !== "train")
  )
    throw new Error("Candidate stage metrics are TRAIN-only.");
  assertUniqueIds(input.observations, "TRAIN predictions");
  assertUniqueIds(input.evidence, "TRAIN candidate-stage evidence");
  assertUniqueIds(input.labels, "TRAIN labels");
  assertUniqueIds(input.uniqueInputs.observations, "Unique TRAIN predictions");
  assertUniqueIds(input.uniqueInputs.labels, "Unique TRAIN labels");
  assertSameIds(
    input.observations,
    input.evidence,
    "Candidate stage evidence must exactly match TRAIN predictions.",
  );
  assertSameIds(
    input.observations,
    input.labels,
    "Candidate stage labels must exactly match TRAIN predictions.",
  );
  assertSameIds(
    input.observations,
    input.uniqueInputs.observations,
    "Unique-oracle inputs must exactly match TRAIN predictions.",
  );
  assertSameIds(
    input.labels,
    input.uniqueInputs.labels,
    "Unique-oracle inputs must exactly match TRAIN labels.",
  );
  const labelsById = new Map(
    input.labels.map((label) => [label.sampleId, label]),
  );
  const evidenceById = new Map(
    input.evidence.map((evidence) => [evidence.sampleId, evidence]),
  );
  const uniqueLabelsById = new Map(
    input.uniqueInputs.labels.map((label) => [label.sampleId, label]),
  );
  for (const observation of input.observations) {
    const label = labelsById.get(observation.sampleId)!;
    const uniqueLabel = uniqueLabelsById.get(observation.sampleId)!;
    const evidence = evidenceById.get(observation.sampleId)!;
    if (
      observation.duplicateGroup !== label.duplicateGroup ||
      observation.repoFamily !== label.repoFamily ||
      (label.repoId !== undefined && observation.repoId !== label.repoId) ||
      uniqueLabel.duplicateGroup !== label.duplicateGroup ||
      uniqueLabel.repoFamily !== label.repoFamily ||
      uniqueLabel.positiveTargetIds.some(
        (targetId) =>
          !label.positiveTargetIds.map(canonicalTarget).includes(targetId),
      )
    )
      throw new Error(
        `Candidate stage grouping mismatch for ${observation.sampleId}.`,
      );
    const mappedIds = new Set(evidence.mappedCandidateTargetIds);
    if (
      mappedIds.size !== observation.candidateTargetIds.length ||
      observation.candidateTargetIds.some(
        (targetId) => !mappedIds.has(targetId),
      ) ||
      evidence.generatedCandidateKeys.length !==
        observation.generatedCandidateCount ||
      evidence.orderedEvidenceProposals.length !==
        observation.proposedCandidateCount
    )
      throw new Error(
        `Candidate stage decision mismatch for ${observation.sampleId}.`,
      );
  }
  const evidenceMap = new Map(input.evidence.map((row) => [row.sampleId, row]));
  return input.observations.map((observation) => {
    const label = labelsById.get(observation.sampleId)!;
    const filteredLabel = uniqueLabelsById.get(observation.sampleId)!;
    return {
      observation,
      label,
      evidence: evidenceMap.get(observation.sampleId)!,
      goldTargets: new Set(
        filteredLabel.positiveTargetIds.map(canonicalTarget),
      ),
    };
  });
}

function summarizeMisses(
  rows: readonly EvaluationRow[],
): CandidateStageSplitMetrics["missAudit"] {
  let rawMissTargetOccurrenceCount = 0;
  let proposalMissTargetOccurrenceCount = 0;
  let proposalOnlyDroppedTargetOccurrenceCount = 0;
  let unsupportedZeroCandidateSiteCount = 0;
  let supportedZeroCandidateSiteCount = 0;
  let missingCallShapeEvidenceZeroCandidateSiteCount = 0;
  const rawMissReasons: Record<string, number> = {};
  const proposalMissReasons: Record<string, number> = {};
  for (const row of rows) {
    if (!eligible(row.label)) continue;
    const rawTargets = new Set(row.evidence.mappedCandidateTargetIds);
    const proposalTargets = new Set(
      row.evidence.orderedEvidenceProposals.flatMap((proposal) =>
        proposal.status === "mapped" && proposal.targetId !== null
          ? [proposal.targetId]
          : [],
      ),
    );
    if (row.evidence.generatedCandidateKeys.length === 0) {
      if (!knownCallShape(row.observation))
        missingCallShapeEvidenceZeroCandidateSiteCount++;
      else if (row.observation.unsupportedCallShape)
        unsupportedZeroCandidateSiteCount++;
      else supportedZeroCandidateSiteCount++;
    }
    for (const targetId of row.goldTargets) {
      if (!rawTargets.has(targetId)) {
        rawMissTargetOccurrenceCount++;
        increment(rawMissReasons, rawMissReason(row, rawTargets));
      }
      if (!proposalTargets.has(targetId)) {
        proposalMissTargetOccurrenceCount++;
        if (rawTargets.has(targetId)) {
          proposalOnlyDroppedTargetOccurrenceCount++;
          increment(
            proposalMissReasons,
            "ordered-evidence-filter-dropped-gold-target",
          );
        } else {
          increment(proposalMissReasons, rawMissReason(row, rawTargets));
        }
      }
    }
  }
  return {
    rawMissTargetOccurrenceCount,
    proposalMissTargetOccurrenceCount,
    proposalOnlyDroppedTargetOccurrenceCount,
    unsupportedZeroCandidateSiteCount,
    supportedZeroCandidateSiteCount,
    missingCallShapeEvidenceZeroCandidateSiteCount,
    rawMissReasons: Object.fromEntries(
      Object.entries(rawMissReasons).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    proposalMissReasons: Object.fromEntries(
      Object.entries(proposalMissReasons).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

/** TRAIN-only candidate-set audit. Ranking decisions are never recomputed or changed. */
export function evaluateCandidateStageSplit(
  input: CandidateStageEvaluationInput,
): CandidateStageSplitMetrics {
  const rows = validateInput(input);
  const eligibleLabels = input.labels.filter(eligible);
  const uniquePositiveLabels = input.uniqueInputs.labels.filter(eligible);
  const uniqueMappablePositiveTargetOccurrenceCount =
    uniquePositiveLabels.reduce(
      (count, label) => count + label.positiveTargetIds.length,
      0,
    );
  const rawMetrics = stageView(rows, "raw").grouped;
  const mappedMetrics = stageView(rows, "mapped").grouped;
  const proposalMetrics = stageView(rows, "proposals").grouped;
  if (
    rawMetrics.overall.candidateGoldTargetCount !==
    uniqueMappablePositiveTargetOccurrenceCount
  )
    throw new Error(
      "Candidate-stage recall denominator differs from mapped labels.",
    );
  return {
    split: "train",
    allConfirmedEligibleSiteCount: eligibleLabels.length,
    uniqueMappablePositiveTargetOccurrenceCount,
    uniqueMappablePositiveSiteCount: uniquePositiveLabels.filter(
      (label) => label.positiveTargetIds.length > 0,
    ).length,
    ambiguousPositiveTargetOccurrenceCount:
      input.uniqueInputs.ambiguousPositiveTargetOccurrenceCount,
    unmappedPositiveTargetOccurrenceCount:
      input.uniqueInputs.unmappedPositiveTargetOccurrenceCount,
    stages: {
      rawGeneratedKeys: rawMetrics,
      mappedGeneratedTargetIds: mappedMetrics,
      orderedEvidenceProposals: proposalMetrics,
    },
    missAudit: summarizeMisses(rows),
  };
}
