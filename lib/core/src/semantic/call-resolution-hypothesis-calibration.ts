import type { CallResolutionCalibrationRecord } from "@workspace/contracts";
import {
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
} from "@workspace/contracts";
import { clopperPearsonLowerBound } from "./system1/eval/system1-eval-calibration.js";
import {
  HASH_PATTERN,
  NormalizedServiceOptions,
  closeEnough,
  hash,
  isFiniteRatio,
} from "./call-resolution-hypothesis-internal.js";

function hasMatchingProvenance(
  record: CallResolutionCalibrationRecord,
  ruleSignature: string,
  configurationHash: string,
): boolean {
  return (
    record.schemaVersion === CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION &&
    record.split === "calibration" &&
    record.ruleSignature === ruleSignature &&
    record.candidateGeneratorVersion ===
      CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION &&
    record.configurationHash === configurationHash &&
    HASH_PATTERN.test(record.calibrationInputFingerprint) &&
    HASH_PATTERN.test(record.calibrationRecordHash)
  );
}

function hasSufficientGroupSupport(
  record: CallResolutionCalibrationRecord,
  options: NormalizedServiceOptions,
): boolean {
  return (
    Number.isInteger(record.independentGroupCount) &&
    record.independentGroupCount >= options.minimumIndependentGroups &&
    Number.isInteger(record.correctGroupCount) &&
    record.correctGroupCount >= 0 &&
    record.correctGroupCount <= record.independentGroupCount
  );
}

function hasMatchingCalibrationPolicy(
  record: CallResolutionCalibrationRecord,
  options: NormalizedServiceOptions,
): boolean {
  return (
    Number.isFinite(record.thresholdScore) &&
    Number.isInteger(record.minimumIndependentGroups) &&
    record.minimumIndependentGroups === options.minimumIndependentGroups &&
    closeEnough(
      record.minimumConfidenceLowerBound,
      options.minimumConfidenceLowerBound,
    ) &&
    closeEnough(record.targetFamilyMacroTop1, options.targetFamilyMacroTop1)
  );
}

function hasValidFamilyMetrics(
  record: CallResolutionCalibrationRecord,
): boolean {
  if (!Array.isArray(record.familyMetrics) || record.familyMetrics.length === 0)
    return false;
  if (record.familyMetrics.some((metric) => !isValidFamilyMetric(metric)))
    return false;
  return (
    new Set(record.familyMetrics.map(({ family }) => family)).size ===
    record.familyMetrics.length
  );
}

function isValidFamilyMetric(
  metric: CallResolutionCalibrationRecord["familyMetrics"][number],
): boolean {
  return (
    metric !== null &&
    typeof metric === "object" &&
    typeof metric.family === "string" &&
    metric.family.trim().length > 0 &&
    Number.isInteger(metric.eligibleSiteCount) &&
    metric.eligibleSiteCount > 0 &&
    isFiniteRatio(metric.top1Accuracy)
  );
}

function recordHash(record: CallResolutionCalibrationRecord): string {
  const { calibrationRecordHash: _ignored, ...payload } = record;
  return hash(payload);
}

function familyMacroTop1(record: CallResolutionCalibrationRecord): number {
  return (
    record.familyMetrics.reduce((sum, metric) => sum + metric.top1Accuracy, 0) /
    record.familyMetrics.length
  );
}

export function isCalibrationRecordValid(
  record: CallResolutionCalibrationRecord,
  options: NormalizedServiceOptions,
  ruleSignature: string,
  configurationHash: string,
): boolean {
  if (!hasMatchingProvenance(record, ruleSignature, configurationHash))
    return false;
  if (!hasSufficientGroupSupport(record, options)) return false;
  if (!hasMatchingCalibrationPolicy(record, options)) return false;
  if (!hasValidFamilyMetrics(record)) return false;
  if (!isFiniteRatio(record.confidenceLowerBound)) return false;
  const lowerBound = clopperPearsonLowerBound(
    record.correctGroupCount,
    record.independentGroupCount,
  );
  return (
    closeEnough(record.confidenceLowerBound, lowerBound) &&
    lowerBound >= options.minimumConfidenceLowerBound &&
    familyMacroTop1(record) >= options.targetFamilyMacroTop1 &&
    recordHash(record) === record.calibrationRecordHash
  );
}

export function matchingCalibrationRecords(
  records: readonly CallResolutionCalibrationRecord[] | undefined,
  ruleSignature: string,
): readonly CallResolutionCalibrationRecord[] {
  return (
    records?.filter((record) => record.ruleSignature === ruleSignature) ?? []
  );
}

export function selectValidCalibrationRecord(
  records: readonly CallResolutionCalibrationRecord[],
  options: NormalizedServiceOptions,
  ruleSignature: string,
  configurationHash: string,
): CallResolutionCalibrationRecord | undefined {
  return records.find((record) =>
    isCalibrationRecordValid(record, options, ruleSignature, configurationHash),
  );
}
