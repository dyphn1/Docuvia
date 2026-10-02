import { SemanticDecisionOptionKinds } from "@workspace/contracts";
import {
  SYSTEM1_DATASET_IMPACT_ERRORS,
  SYSTEM1_DATASET_IMPACT_FIELD_NAMES,
  SYSTEM1_EVIDENCE_STATUSES,
} from "../system1-constants.js";
import type { System1DatasetRecord } from "../system1-types.js";
import { system1RepoFamily } from "./system1-eval-folds.js";

export interface System1DatasetImpactCounts {
  readonly rowCount: number;
  readonly candidateCount: number;
  readonly changedRowCount: number;
  readonly changedCandidateCount: number;
  readonly changedDeclarationKindCandidateCount: number;
  readonly changedSignatureCandidateCount: number;
  readonly changedEvidenceStatusCandidateCount: number;
  readonly evidencePresentToMissingCandidateCount: number;
  readonly evidenceMissingToPresentCandidateCount: number;
  readonly textOnlyChangedCandidateCount: number;
}

export interface System1DatasetSplitImpact extends System1DatasetImpactCounts {
  readonly byFamily: Readonly<Record<string, System1DatasetImpactCounts>>;
}

interface MutableCounts {
  rowCount: number;
  candidateCount: number;
  changedRowCount: number;
  changedCandidateCount: number;
  changedDeclarationKindCandidateCount: number;
  changedSignatureCandidateCount: number;
  changedEvidenceStatusCandidateCount: number;
  evidencePresentToMissingCandidateCount: number;
  evidenceMissingToPresentCandidateCount: number;
  textOnlyChangedCandidateCount: number;
}

function emptyCounts(): MutableCounts {
  return {
    rowCount: 0,
    candidateCount: 0,
    changedRowCount: 0,
    changedCandidateCount: 0,
    changedDeclarationKindCandidateCount: 0,
    changedSignatureCandidateCount: 0,
    changedEvidenceStatusCandidateCount: 0,
    evidencePresentToMissingCandidateCount: 0,
    evidenceMissingToPresentCandidateCount: 0,
    textOnlyChangedCandidateCount: 0,
  };
}

function immutableCounts(counts: MutableCounts): System1DatasetImpactCounts {
  return { ...counts };
}

function uniqueByRequestId(
  rows: readonly System1DatasetRecord[],
): Map<string, System1DatasetRecord> {
  const result = new Map<string, System1DatasetRecord>();
  for (const row of rows) {
    const requestId = row.request.requestId;
    if (result.has(requestId))
      throw new Error(SYSTEM1_DATASET_IMPACT_ERRORS.DUPLICATE_REQUEST_ID);
    result.set(requestId, row);
  }
  return result;
}

function candidateOptions(row: System1DatasetRecord) {
  return row.request.options.filter(
    (option) => option.kind === SemanticDecisionOptionKinds.CANDIDATE,
  );
}

function attribute(
  option: ReturnType<typeof candidateOptions>[number],
  key: string,
): string | null {
  const value = option.attributes?.[key];
  return typeof value === "string" ? value : null;
}

function requireSameRequestIds(
  referenceById: ReadonlyMap<string, System1DatasetRecord>,
  updatedById: ReadonlyMap<string, System1DatasetRecord>,
): string[] {
  const requestIds = [...referenceById.keys()].sort();
  const rowSetDiffers =
    requestIds.length !== updatedById.size ||
    requestIds.some((requestId) => !updatedById.has(requestId));
  if (rowSetDiffers)
    throw new Error(SYSTEM1_DATASET_IMPACT_ERRORS.ROW_SET_MISMATCH);
  return requestIds;
}

function requireSameCandidateIds(
  referenceOptions: ReturnType<typeof candidateOptions>,
  updatedOptions: ReturnType<typeof candidateOptions>,
): void {
  const candidateSetDiffers =
    referenceOptions.length !== updatedOptions.length ||
    referenceOptions.some(
      (option, index) => option.id !== updatedOptions[index]?.id,
    );
  if (candidateSetDiffers)
    throw new Error(SYSTEM1_DATASET_IMPACT_ERRORS.CANDIDATE_SET_MISMATCH);
}

type CandidateChangeField =
  | "changedDeclarationKindCandidateCount"
  | "changedSignatureCandidateCount"
  | "changedEvidenceStatusCandidateCount"
  | "evidencePresentToMissingCandidateCount"
  | "evidenceMissingToPresentCandidateCount"
  | "textOnlyChangedCandidateCount";

function incrementFieldChange(
  changed: boolean,
  total: MutableCounts,
  family: MutableCounts,
  field: CandidateChangeField,
): void {
  if (!changed) return;
  total[field]++;
  family[field]++;
}

function compareCandidatePair(
  before: ReturnType<typeof candidateOptions>[number],
  after: ReturnType<typeof candidateOptions>[number],
  total: MutableCounts,
  family: MutableCounts,
): boolean {
  const targetIdKey = SYSTEM1_DATASET_IMPACT_FIELD_NAMES.TARGET_ID;
  if (attribute(before, targetIdKey) !== attribute(after, targetIdKey))
    throw new Error(SYSTEM1_DATASET_IMPACT_ERRORS.TARGET_ID_MISMATCH);

  total.candidateCount++;
  family.candidateCount++;
  const beforeKind = attribute(
    before,
    SYSTEM1_DATASET_IMPACT_FIELD_NAMES.DECLARATION_KIND,
  );
  const afterKind = attribute(
    after,
    SYSTEM1_DATASET_IMPACT_FIELD_NAMES.DECLARATION_KIND,
  );
  const beforeStatus = attribute(
    before,
    SYSTEM1_DATASET_IMPACT_FIELD_NAMES.EVIDENCE_STATUS,
  );
  const afterStatus = attribute(
    after,
    SYSTEM1_DATASET_IMPACT_FIELD_NAMES.EVIDENCE_STATUS,
  );
  const kindChanged = beforeKind !== afterKind;
  const statusChanged = beforeStatus !== afterStatus;
  const signatureChanged = before.text !== after.text;
  const fieldChanges: readonly [boolean, CandidateChangeField][] = [
    [kindChanged, "changedDeclarationKindCandidateCount"],
    [signatureChanged, "changedSignatureCandidateCount"],
    [statusChanged, "changedEvidenceStatusCandidateCount"],
  ];
  const candidateChanged = fieldChanges.some(([changed]) => changed);
  if (!candidateChanged) return false;

  total.changedCandidateCount++;
  family.changedCandidateCount++;
  for (const [changed, field] of fieldChanges)
    incrementFieldChange(changed, total, family, field);
  incrementFieldChange(
    beforeStatus === SYSTEM1_EVIDENCE_STATUSES.PRESENT &&
      afterStatus === SYSTEM1_EVIDENCE_STATUSES.MISSING,
    total,
    family,
    "evidencePresentToMissingCandidateCount",
  );
  incrementFieldChange(
    beforeStatus === SYSTEM1_EVIDENCE_STATUSES.MISSING &&
      afterStatus === SYSTEM1_EVIDENCE_STATUSES.PRESENT,
    total,
    family,
    "evidenceMissingToPresentCandidateCount",
  );
  incrementFieldChange(
    signatureChanged && !kindChanged && !statusChanged,
    total,
    family,
    "textOnlyChangedCandidateCount",
  );
  return true;
}

function compareCandidateSets(
  reference: System1DatasetRecord,
  updated: System1DatasetRecord,
  total: MutableCounts,
  family: MutableCounts,
): boolean {
  const beforeOptions = candidateOptions(reference);
  const afterOptions = candidateOptions(updated);
  requireSameCandidateIds(beforeOptions, afterOptions);
  let rowHasChanges = false;
  for (let index = 0; index < beforeOptions.length; index++) {
    const before = beforeOptions[index];
    const after = afterOptions[index];
    if (!before || !after)
      throw new Error(SYSTEM1_DATASET_IMPACT_ERRORS.CANDIDATE_SET_MISMATCH);
    if (compareCandidatePair(before, after, total, family))
      rowHasChanges = true;
  }
  return rowHasChanges;
}

function compareRequestRow(
  reference: System1DatasetRecord,
  updated: System1DatasetRecord,
  total: MutableCounts,
  familyCounts: Map<string, MutableCounts>,
): void {
  const familyName = system1RepoFamily(updated);
  const family = familyCounts.get(familyName) ?? emptyCounts();
  familyCounts.set(familyName, family);
  total.rowCount++;
  family.rowCount++;
  if (!compareCandidateSets(reference, updated, total, family)) return;
  total.changedRowCount++;
  family.changedRowCount++;
}

/** Compares label-free state records and requires candidate identities to remain stable. */
export function compareSystem1DatasetEvidence(
  referenceRows: readonly System1DatasetRecord[],
  updatedRows: readonly System1DatasetRecord[],
): System1DatasetSplitImpact {
  const referenceById = uniqueByRequestId(referenceRows);
  const updatedById = uniqueByRequestId(updatedRows);
  const requestIds = requireSameRequestIds(referenceById, updatedById);
  const total = emptyCounts();
  const familyCounts = new Map<string, MutableCounts>();
  for (const requestId of requestIds) {
    const reference = referenceById.get(requestId);
    const updated = updatedById.get(requestId);
    if (!reference || !updated)
      throw new Error(SYSTEM1_DATASET_IMPACT_ERRORS.ROW_SET_MISMATCH);
    compareRequestRow(reference, updated, total, familyCounts);
  }

  return {
    ...immutableCounts(total),
    byFamily: Object.fromEntries(
      [...familyCounts.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([family, counts]) => [family, immutableCounts(counts)]),
    ),
  };
}
