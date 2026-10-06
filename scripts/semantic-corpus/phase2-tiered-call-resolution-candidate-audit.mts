import {
  evaluateCandidateRecallSplit,
  type Phase2EvaluationLabel,
  type Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";
import { candidateTargetKeyForDeclaration } from "../../lib/core/src/semantic/call-resolution-hypothesis-index.js";
import type { AstDeclaredDeclaration } from "../../lib/contracts/src/index.js";
import { mapCandidateKeysToUnambiguousAliases } from "./phase2-tiered-call-resolution-source.mjs";
import type { Phase2FactFile } from "./phase2-tiered-call-resolution-support.mjs";

export interface CandidateOracleTargetMapping {
  readonly bySnapshotAndRepo: ReadonlyMap<
    string,
    CandidateOracleSnapshotMapping
  >;
}

export interface CandidateOracleSnapshotMapping {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly uniquelyMappedAliases: ReadonlySet<string>;
  readonly allAliases: ReadonlySet<string>;
}

export interface UniqueOracleEvaluationInputs {
  readonly observations: readonly Phase2EvaluationObservation[];
  readonly labels: readonly Phase2EvaluationLabel[];
  readonly siteCount: number;
  readonly rawCandidateSiteCount: number;
  readonly uniquelyMappedCandidateSiteCount: number;
  readonly sitesWithCandidatesButNoUniqueTargetCount: number;
  readonly candidateAliasMembershipCountBeforeFiltering: number;
  readonly uniqueCandidateMembershipCount: number;
  readonly uniqueMappedPositiveTargetOccurrenceCount: number;
  readonly ambiguousPositiveTargetOccurrenceCount: number;
  readonly unmappedPositiveTargetOccurrenceCount: number;
  readonly uniqueMappedPositiveSiteCount: number;
  readonly sitesWithoutUniquePositiveTargetCount: number;
  readonly droppedAmbiguousCandidateMembershipCount: number;
  readonly droppedUnmappedCandidateMembershipCount: number;
}

export interface CandidateSetDistributionGroup {
  readonly name: string;
  readonly eligibleSiteCount: number;
  readonly zeroCandidateSiteCount: number;
  readonly zeroCandidateRate: number;
  readonly candidateSetSizeP50: number;
  readonly candidateSetSizeP95: number;
  readonly candidateSetSizeMax: number;
  readonly candidateWithoutOracleIdSiteCount: number;
  readonly ambiguousCandidateMappingCount: number;
  readonly unmappedCandidateCount: number;
}

interface MutableCandidateSetGroup {
  eligibleSiteCount: number;
  zeroCandidateSiteCount: number;
  candidateSizes: number[];
  candidateWithoutOracleIdSiteCount: number;
  ambiguousCandidateMappingCount: number;
  unmappedCandidateCount: number;
}

export interface CandidateRecallComparison {
  readonly baselineCandidateRecall: number;
  readonly currentCandidateRecall: number;
  readonly candidateRecallDelta: number;
  readonly baselineCoveredGoldTargetCount: number;
  readonly currentCoveredGoldTargetCount: number;
  readonly addedCandidateMembershipCount: number;
  readonly removedCandidateMembershipCount: number;
  readonly sitesWithAddedCandidateCount: number;
  readonly sitesWithRemovedCandidateCount: number;
  readonly newlyCoveredGoldTargetCount: number;
  readonly noLongerCoveredGoldTargetCount: number;
}

export interface GeneratedCandidateCountComparison {
  readonly siteCount: number;
  readonly baselineGeneratedCandidateCount: number;
  readonly currentGeneratedCandidateCount: number;
  readonly generatedCandidateCountDelta: number;
  readonly sitesWithFewerGeneratedCandidates: number;
  readonly sitesWithEqualGeneratedCandidates: number;
  readonly sitesWithMoreGeneratedCandidates: number;
}

function candidateTargetAlias(
  filePath: string,
  declaration: AstDeclaredDeclaration,
): string | null {
  if (!declaration.name) return null;
  const container = ["class", "interface", "object"].includes(
    declaration.owner.kind,
  )
    ? declaration.owner.name
    : null;
  return `${filePath}#${container ? `${container}.` : ""}${declaration.name}`;
}

export function candidateOracleTargetMapping(
  factRows: readonly Phase2FactFile[],
): CandidateOracleTargetMapping {
  const rowsByScope = new Map<string, Phase2FactFile[]>();
  for (const row of factRows) {
    const key = candidateOracleScopeKey(row.snapshotId, row.repoId);
    const rows = rowsByScope.get(key) ?? [];
    rows.push(row);
    rowsByScope.set(key, rows);
  }

  const bySnapshotAndRepo = new Map<string, CandidateOracleSnapshotMapping>();
  for (const [scopeKey, scopeRows] of rowsByScope) {
    const candidateKeys: string[] = [];
    const allAliases = new Set<string>();
    for (const row of scopeRows) {
      for (const declaration of row.declaredTypeFacts.declarations) {
        const candidateKey = candidateTargetKeyForDeclaration(
          row.filePath,
          declaration,
        );
        const alias = candidateTargetAlias(row.filePath, declaration);
        if (!candidateKey || !alias) continue;
        candidateKeys.push(candidateKey);
        allAliases.add(alias);
      }
    }
    const unique = mapCandidateKeysToUnambiguousAliases(
      candidateKeys,
      scopeRows,
    );
    const first = scopeRows[0];
    if (!first) continue;
    bySnapshotAndRepo.set(scopeKey, {
      snapshotId: first.snapshotId,
      repoId: first.repoId,
      uniquelyMappedAliases: new Set(unique.aliases),
      allAliases,
    });
  }
  return {
    bySnapshotAndRepo,
  };
}

export function candidateOracleScopeKey(
  snapshotId: string,
  repoId: string,
): string {
  return JSON.stringify([snapshotId, repoId]);
}

export function candidateOracleMappingForSource(
  mapping: CandidateOracleTargetMapping,
  source: Pick<Phase2EvaluationObservation, "snapshotId" | "repoId">,
): CandidateOracleSnapshotMapping | undefined {
  if (!source.snapshotId || !source.repoId) return undefined;
  return mapping.bySnapshotAndRepo.get(
    candidateOracleScopeKey(source.snapshotId, source.repoId),
  );
}

export function candidateOracleMappingProvenance(
  mapping: CandidateOracleTargetMapping,
): {
  readonly scope: "snapshotId+repoId";
  readonly hashInput: readonly {
    readonly snapshotId: string;
    readonly repoId: string;
    readonly uniquelyMappedAliases: readonly string[];
    readonly allAliases: readonly string[];
  }[];
  readonly uniqueAliasCount: number;
  readonly allAliasCount: number;
} {
  const hashInput = [...mapping.bySnapshotAndRepo.values()]
    .map((scope) => ({
      snapshotId: scope.snapshotId,
      repoId: scope.repoId,
      uniquelyMappedAliases: [...scope.uniquelyMappedAliases].sort(),
      allAliases: [...scope.allAliases].sort(),
    }))
    .sort(
      (left, right) =>
        left.snapshotId.localeCompare(right.snapshotId) ||
        left.repoId.localeCompare(right.repoId),
    );
  return {
    scope: "snapshotId+repoId",
    hashInput,
    uniqueAliasCount: hashInput.reduce(
      (count, scope) => count + scope.uniquelyMappedAliases.length,
      0,
    ),
    allAliasCount: hashInput.reduce(
      (count, scope) => count + scope.allAliases.length,
      0,
    ),
  };
}

function canonicalTargetId(targetId: string): string {
  return targetId.replace(/@L\d+(?:#\d+)?$/, "");
}

export function filterInputsToUniqueOracleTargets(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  mapping: CandidateOracleTargetMapping,
): UniqueOracleEvaluationInputs {
  const labelsById = new Map(labels.map((label) => [label.sampleId, label]));
  const observationsById = new Map(
    observations.map((observation) => [observation.sampleId, observation]),
  );
  if (labelsById.size !== labels.length)
    throw new Error("Evaluation labels contain duplicate sample IDs.");
  if (
    observations.length !== labels.length ||
    new Set(observations.map((row) => row.sampleId)).size !==
      observations.length ||
    observations.some((observation) => {
      const label = labelsById.get(observation.sampleId);
      return (
        !label ||
        label.split !== observation.split ||
        label.repoFamily !== observation.repoFamily ||
        (label.repoId !== undefined && label.repoId !== observation.repoId)
      );
    })
  )
    throw new Error(
      "Unique-oracle filtering requires labels for the matching prediction rows.",
    );

  let uniqueMappedPositiveTargetOccurrenceCount = 0;
  let ambiguousPositiveTargetOccurrenceCount = 0;
  let unmappedPositiveTargetOccurrenceCount = 0;
  let uniqueMappedPositiveSiteCount = 0;
  let sitesWithoutUniquePositiveTargetCount = 0;
  let rawCandidateSiteCount = 0;
  let uniquelyMappedCandidateSiteCount = 0;
  let sitesWithCandidatesButNoUniqueTargetCount = 0;
  let candidateAliasMembershipCountBeforeFiltering = 0;
  let uniqueCandidateMembershipCount = 0;
  let droppedAmbiguousCandidateMembershipCount = 0;
  let droppedUnmappedCandidateMembershipCount = 0;

  const filteredLabels = labels.map((label) => {
    if (
      label.reviewStatus !== "confirmed" ||
      label.positiveTargetIds.length === 0
    )
      return label;
    const observation = observationsById.get(label.sampleId);
    const scope = observation
      ? candidateOracleMappingForSource(mapping, observation)
      : undefined;
    const uniqueAliases = scope?.uniquelyMappedAliases ?? new Set<string>();
    const allAliases = scope?.allAliases ?? new Set<string>();
    const uniqueTargets: string[] = [];
    for (const targetId of label.positiveTargetIds) {
      const canonical = canonicalTargetId(targetId);
      if (uniqueAliases.has(canonical)) {
        uniqueTargets.push(canonical);
        uniqueMappedPositiveTargetOccurrenceCount++;
      } else if (allAliases.has(canonical)) {
        ambiguousPositiveTargetOccurrenceCount++;
      } else {
        unmappedPositiveTargetOccurrenceCount++;
      }
    }
    if (uniqueTargets.length > 0) uniqueMappedPositiveSiteCount++;
    else sitesWithoutUniquePositiveTargetCount++;
    return { ...label, positiveTargetIds: uniqueTargets };
  });

  const filteredObservations = observations.map((observation) => {
    const uniqueCandidates: string[] = [];
    const scope = candidateOracleMappingForSource(mapping, observation);
    const uniqueAliases = scope?.uniquelyMappedAliases ?? new Set<string>();
    const allAliases = scope?.allAliases ?? new Set<string>();
    candidateAliasMembershipCountBeforeFiltering +=
      observation.candidateTargetIds.length;
    if (generatedCandidateCount(observation) > 0) rawCandidateSiteCount++;
    for (const targetId of observation.candidateTargetIds) {
      if (uniqueAliases.has(targetId)) uniqueCandidates.push(targetId);
      else if (allAliases.has(targetId))
        droppedAmbiguousCandidateMembershipCount++;
      else droppedUnmappedCandidateMembershipCount++;
    }
    uniqueCandidateMembershipCount += uniqueCandidates.length;
    if (uniqueCandidates.length > 0) uniquelyMappedCandidateSiteCount++;
    else if (generatedCandidateCount(observation) > 0)
      sitesWithCandidatesButNoUniqueTargetCount++;
    return { ...observation, candidateTargetIds: uniqueCandidates };
  });

  return {
    observations: filteredObservations,
    labels: filteredLabels,
    siteCount: observations.length,
    rawCandidateSiteCount,
    uniquelyMappedCandidateSiteCount,
    sitesWithCandidatesButNoUniqueTargetCount,
    candidateAliasMembershipCountBeforeFiltering,
    uniqueCandidateMembershipCount,
    uniqueMappedPositiveTargetOccurrenceCount,
    ambiguousPositiveTargetOccurrenceCount,
    unmappedPositiveTargetOccurrenceCount,
    uniqueMappedPositiveSiteCount,
    sitesWithoutUniquePositiveTargetCount,
    droppedAmbiguousCandidateMembershipCount,
    droppedUnmappedCandidateMembershipCount,
  };
}

function generatedCandidateCount(
  observation: Phase2EvaluationObservation,
): number {
  return (
    observation.generatedCandidateCount ?? observation.candidateTargetIds.length
  );
}

export function applyCallShapesFromCurrentPredictions(
  baseline: readonly Phase2EvaluationObservation[],
  current: readonly Phase2EvaluationObservation[],
): Phase2EvaluationObservation[] {
  const currentById = new Map(current.map((row) => [row.sampleId, row]));
  if (
    currentById.size !== current.length ||
    baseline.length !== current.length ||
    new Set(baseline.map((row) => row.sampleId)).size !== baseline.length ||
    baseline.some((row) => {
      const currentRow = currentById.get(row.sampleId);
      return (
        !currentRow ||
        currentRow.split !== row.split ||
        currentRow.snapshotId === undefined ||
        currentRow.repoId === undefined ||
        currentRow.calleeKind === undefined
      );
    })
  )
    throw new Error(
      "Baseline and current predictions must cover identical unique sites with source call shapes.",
    );

  return baseline.map((row) => ({
    ...row,
    calleeKind: currentById.get(row.sampleId)!.calleeKind,
    snapshotId: currentById.get(row.sampleId)!.snapshotId,
    repoId: currentById.get(row.sampleId)!.repoId,
  }));
}

function positiveLabels(label: Phase2EvaluationLabel): string[] {
  return label.positiveTargetIds.map((target) =>
    target.replace(/@L\d+(?:#\d+)?$/, ""),
  );
}

function candidateSetGroup(): MutableCandidateSetGroup {
  return {
    eligibleSiteCount: 0,
    zeroCandidateSiteCount: 0,
    candidateSizes: [],
    candidateWithoutOracleIdSiteCount: 0,
    ambiguousCandidateMappingCount: 0,
    unmappedCandidateCount: 0,
  };
}

function candidateSetQuantile(
  values: readonly number[],
  quantile: number,
): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? 0;
}

function summarizeCandidateSetGroup(
  name: string,
  group: MutableCandidateSetGroup,
): CandidateSetDistributionGroup {
  return {
    name,
    eligibleSiteCount: group.eligibleSiteCount,
    zeroCandidateSiteCount: group.zeroCandidateSiteCount,
    zeroCandidateRate:
      group.eligibleSiteCount === 0
        ? 0
        : group.zeroCandidateSiteCount / group.eligibleSiteCount,
    candidateSetSizeP50: candidateSetQuantile(group.candidateSizes, 0.5),
    candidateSetSizeP95: candidateSetQuantile(group.candidateSizes, 0.95),
    candidateSetSizeMax: Math.max(0, ...group.candidateSizes),
    candidateWithoutOracleIdSiteCount: group.candidateWithoutOracleIdSiteCount,
    ambiguousCandidateMappingCount: group.ambiguousCandidateMappingCount,
    unmappedCandidateCount: group.unmappedCandidateCount,
  };
}

function recordCandidateSet(
  group: MutableCandidateSetGroup,
  observation: Phase2EvaluationObservation,
): void {
  const generatedCount = generatedCandidateCount(observation);
  group.eligibleSiteCount++;
  group.candidateSizes.push(generatedCount);
  if (generatedCount === 0) group.zeroCandidateSiteCount++;
  if (generatedCount > observation.candidateTargetIds.length)
    group.candidateWithoutOracleIdSiteCount++;
  group.ambiguousCandidateMappingCount +=
    observation.ambiguousCandidateMappingCount ?? 0;
  group.unmappedCandidateCount +=
    observation.unmappedGeneratedCandidateCount ?? 0;
}

export function summarizeCandidateSetDistribution(
  observations: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  split: string,
): {
  readonly overall: CandidateSetDistributionGroup;
  readonly byFamily: readonly CandidateSetDistributionGroup[];
  readonly byCallShape: readonly CandidateSetDistributionGroup[];
} {
  const labelsBySample = new Map(
    labels.map((label) => [label.sampleId, label]),
  );
  if (labelsBySample.size !== labels.length)
    throw new Error("Evaluation labels contain duplicate sample IDs.");
  const overall = candidateSetGroup();
  const families = new Map<string, MutableCandidateSetGroup>();
  const callShapes = new Map<string, MutableCandidateSetGroup>();

  for (const observation of observations) {
    if (observation.split !== split)
      throw new Error("Candidate-set observations must match the split.");
    const label = labelsBySample.get(observation.sampleId);
    if (
      !label ||
      label.split !== split ||
      label.repoFamily !== observation.repoFamily
    )
      throw new Error(
        `Evaluation label grouping mismatch for ${observation.sampleId}.`,
      );
    if (
      label.reviewStatus !== "confirmed" ||
      label.positiveTargetIds.length === 0
    )
      continue;

    recordCandidateSet(overall, observation);
    const family = families.get(label.repoFamily) ?? candidateSetGroup();
    recordCandidateSet(family, observation);
    families.set(label.repoFamily, family);
    const shapeName = observation.calleeKind ?? "unknown";
    const shape = callShapes.get(shapeName) ?? candidateSetGroup();
    recordCandidateSet(shape, observation);
    callShapes.set(shapeName, shape);
  }

  return {
    overall: summarizeCandidateSetGroup("all eligible sites", overall),
    byFamily: [...families]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, group]) => summarizeCandidateSetGroup(name, group)),
    byCallShape: [...callShapes]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, group]) => summarizeCandidateSetGroup(name, group)),
  };
}

export function compareCandidateSets(
  baseline: readonly Phase2EvaluationObservation[],
  current: readonly Phase2EvaluationObservation[],
  labels: readonly Phase2EvaluationLabel[],
  split: string,
): CandidateRecallComparison {
  const baselineById = new Map(baseline.map((row) => [row.sampleId, row]));
  const currentById = new Map(current.map((row) => [row.sampleId, row]));
  if (
    baselineById.size !== baseline.length ||
    currentById.size !== current.length ||
    baselineById.size !== currentById.size ||
    [...baselineById.keys()].some((sampleId) => !currentById.has(sampleId))
  )
    throw new Error(
      "Candidate comparison inputs must cover identical unique sites.",
    );

  const labelById = new Map(labels.map((label) => [label.sampleId, label]));
  if (labelById.size !== labels.length)
    throw new Error("Evaluation labels contain duplicate sample IDs.");
  let addedCandidateMembershipCount = 0;
  let removedCandidateMembershipCount = 0;
  let sitesWithAddedCandidateCount = 0;
  let sitesWithRemovedCandidateCount = 0;
  let newlyCoveredGoldTargetCount = 0;
  let noLongerCoveredGoldTargetCount = 0;

  for (const [sampleId, before] of baselineById) {
    const after = currentById.get(sampleId)!;
    if (before.split !== split || after.split !== split)
      throw new Error(
        "Candidate comparison observations must match the split.",
      );
    const beforeCandidates = new Set(before.candidateTargetIds);
    const afterCandidates = new Set(after.candidateTargetIds);
    const added = [...afterCandidates].filter(
      (candidate) => !beforeCandidates.has(candidate),
    );
    const removed = [...beforeCandidates].filter(
      (candidate) => !afterCandidates.has(candidate),
    );
    addedCandidateMembershipCount += added.length;
    removedCandidateMembershipCount += removed.length;
    if (added.length > 0) sitesWithAddedCandidateCount++;
    if (removed.length > 0) sitesWithRemovedCandidateCount++;

    const label = labelById.get(sampleId);
    if (!label || label.split !== split)
      throw new Error(`Evaluation label missing for ${sampleId}.`);
    if (
      label.reviewStatus !== "confirmed" ||
      label.positiveTargetIds.length === 0
    )
      continue;
    const positives = new Set(positiveLabels(label));
    newlyCoveredGoldTargetCount += added.filter((candidate) =>
      positives.has(candidate),
    ).length;
    noLongerCoveredGoldTargetCount += removed.filter((candidate) =>
      positives.has(candidate),
    ).length;
  }

  const baselineMetrics = evaluateCandidateRecallSplit(baseline, labels, split);
  const currentMetrics = evaluateCandidateRecallSplit(current, labels, split);
  return {
    baselineCandidateRecall: baselineMetrics.candidateRecall,
    currentCandidateRecall: currentMetrics.candidateRecall,
    candidateRecallDelta:
      currentMetrics.candidateRecall - baselineMetrics.candidateRecall,
    baselineCoveredGoldTargetCount: baselineMetrics.coveredGoldTargetCount,
    currentCoveredGoldTargetCount: currentMetrics.coveredGoldTargetCount,
    addedCandidateMembershipCount,
    removedCandidateMembershipCount,
    sitesWithAddedCandidateCount,
    sitesWithRemovedCandidateCount,
    newlyCoveredGoldTargetCount,
    noLongerCoveredGoldTargetCount,
  };
}

export function compareGeneratedCandidateCounts(
  baseline: readonly Phase2EvaluationObservation[],
  current: readonly Phase2EvaluationObservation[],
  split: string,
): GeneratedCandidateCountComparison {
  const baselineById = new Map(baseline.map((row) => [row.sampleId, row]));
  const currentById = new Map(current.map((row) => [row.sampleId, row]));
  if (
    baselineById.size !== baseline.length ||
    currentById.size !== current.length ||
    baselineById.size !== currentById.size ||
    [...baselineById.keys()].some((sampleId) => !currentById.has(sampleId))
  )
    throw new Error(
      "Candidate comparison inputs must cover identical unique sites.",
    );

  let baselineGeneratedCandidateCount = 0;
  let currentGeneratedCandidateCount = 0;
  let sitesWithFewerGeneratedCandidates = 0;
  let sitesWithEqualGeneratedCandidates = 0;
  let sitesWithMoreGeneratedCandidates = 0;
  for (const [sampleId, before] of baselineById) {
    const after = currentById.get(sampleId)!;
    if (before.split !== split || after.split !== split)
      throw new Error(
        "Candidate comparison observations must match the split.",
      );
    const beforeCount = generatedCandidateCount(before);
    const afterCount = generatedCandidateCount(after);
    baselineGeneratedCandidateCount += beforeCount;
    currentGeneratedCandidateCount += afterCount;
    if (afterCount < beforeCount) sitesWithFewerGeneratedCandidates++;
    else if (afterCount === beforeCount) sitesWithEqualGeneratedCandidates++;
    else sitesWithMoreGeneratedCandidates++;
  }
  return {
    siteCount: baseline.length,
    baselineGeneratedCandidateCount,
    currentGeneratedCandidateCount,
    generatedCandidateCountDelta:
      currentGeneratedCandidateCount - baselineGeneratedCandidateCount,
    sitesWithFewerGeneratedCandidates,
    sitesWithEqualGeneratedCandidates,
    sitesWithMoreGeneratedCandidates,
  };
}
