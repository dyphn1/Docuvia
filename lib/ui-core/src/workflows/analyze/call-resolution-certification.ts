import { createHash } from "node:crypto";
import { CALL_SITE_VERIFICATION_POLICY_VERSION } from "@workspace/contracts";

export const CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION =
  "docuvia-call-resolution-certification/v1" as const;
export const CALL_RESOLUTION_CERTIFICATION_MINIMUM_GROUPS = 299;
export const CALL_RESOLUTION_CERTIFICATION_TARGET_PRECISION = 0.99;
const ONE_SIDED_ALPHA = 0.05;
const REPORTED_BOUND_TOLERANCE = 1e-6;

interface ArtifactEnvelope extends Record<string, unknown> {
  schemaVersion: typeof CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION;
  policyVersion: string;
  frozenAt: string;
  labelsOpenedAt: string;
  resultsRecordedAt: string;
  inputs: Record<string, unknown>;
  signatures: unknown[];
}

interface CertificationInputsEnvelope extends Record<string, unknown> {
  implementationCommitSha: string;
  ruleConfigurationSha256: string;
  oracleIdentity: string;
  oracleVersion: string;
  oracleConfigurationSha256: string;
  corpusManifestSha256: string;
  newFamily: Record<string, unknown>;
  temporal: Record<string, unknown>;
}

export interface CertificationTrackResult {
  eligibleDuplicateGroups: number;
  uniquelyResolvedGroups: number;
  successfulGroups: number;
  contradictionGroups: number;
  lowerBound95: number;
}

export interface CertificationTrackIdentity {
  familyId: string;
  revision: string;
  splitSha256: string;
}

export interface TemporalCertificationTrackIdentity extends CertificationTrackIdentity {
  baseRevision: string;
}

export interface CallResolutionCertificationArtifact {
  schemaVersion: typeof CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION;
  policyVersion: string;
  frozenAt: string;
  labelsOpenedAt: string;
  resultsRecordedAt: string;
  inputs: {
    implementationCommitSha: string;
    ruleConfigurationSha256: string;
    oracleIdentity: string;
    oracleVersion: string;
    oracleConfigurationSha256: string;
    corpusManifestSha256: string;
    newFamily: CertificationTrackIdentity;
    temporal: TemporalCertificationTrackIdentity;
  };
  signatures: Array<{
    ruleSignature: string;
    newFamily: CertificationTrackResult;
    temporal: CertificationTrackResult;
  }>;
}

export interface ExpectedCertificationInputs {
  /** Trusted runtime pin, stored outside the artifact bytes being checked. */
  artifactSha256: string;
  implementationCommitSha: string;
  ruleConfigurationSha256: string;
  oracleIdentity: string;
  oracleVersion: string;
  oracleConfigurationSha256: string;
  corpusManifestSha256: string;
  newFamily: CertificationTrackIdentity;
  temporal: TemporalCertificationTrackIdentity;
}

export interface UnpromotedCertificationSignature {
  ruleSignature: string;
  newFamilyReasons: readonly string[];
  temporalReasons: readonly string[];
}

export interface CallResolutionCertificationDecision {
  artifactSha256: string | null;
  status: "loaded" | "missing" | "rejected";
  certifiedRuleSignatures: readonly string[];
  rejectionReasons: readonly string[];
  unpromotedSignatures: readonly UnpromotedCertificationSignature[];
}

const certificationMembership = new WeakMap<object, ReadonlySet<string>>();

export function loadCallResolutionCertificationArtifact(
  rawArtifact: string | undefined,
  expected: ExpectedCertificationInputs | undefined,
): CallResolutionCertificationDecision {
  if (rawArtifact === undefined || expected === undefined)
    return missingCertificationDecision();
  const artifactSha256 = createHash("sha256")
    .update(rawArtifact, "utf8")
    .digest("hex");
  const pinError = validateTrustedPin(artifactSha256, expected.artifactSha256);
  if (pinError)
    return createDecision(
      artifactSha256,
      pinError.status,
      [],
      [pinError.reason],
    );
  const artifact = parseArtifactJson(rawArtifact);
  if (!artifact)
    return createDecision(
      artifactSha256,
      "rejected",
      [],
      ["artifact schema or JSON is invalid"],
    );
  const provenanceErrors = validateArtifactProvenance(artifact, expected);
  if (provenanceErrors.length > 0)
    return createDecision(artifactSha256, "rejected", [], provenanceErrors);
  return decisionFromSignatures(artifactSha256, artifact.signatures);
}

export function isCertificationDecisionTrusted(
  decision: unknown,
): decision is CallResolutionCertificationDecision {
  return (
    typeof decision === "object" &&
    decision !== null &&
    certificationMembership.has(decision)
  );
}

export function isRuleSignatureCertified(
  decision: unknown,
  ruleSignature: string,
): boolean {
  if (!isCertificationDecisionTrusted(decision)) return false;
  return (
    certificationMembership.get(decision as object)?.has(ruleSignature) ?? false
  );
}

function createDecision(
  artifactSha256: string | null,
  status: CallResolutionCertificationDecision["status"],
  certifiedRuleSignatures: readonly string[],
  rejectionReasons: readonly string[],
  membership = new Set<string>(),
  unpromotedSignatures: readonly UnpromotedCertificationSignature[] = [],
): CallResolutionCertificationDecision {
  const decision = Object.freeze({
    artifactSha256,
    status,
    certifiedRuleSignatures: Object.freeze([...certifiedRuleSignatures]),
    rejectionReasons: Object.freeze([...rejectionReasons]),
    unpromotedSignatures: Object.freeze([...unpromotedSignatures]),
  });
  certificationMembership.set(decision, membership);
  return decision;
}

function missingCertificationDecision(): CallResolutionCertificationDecision {
  return createDecision(
    null,
    "missing",
    [],
    ["trusted certification input is missing"],
  );
}

function validateTrustedPin(
  artifactSha256: string,
  trustedPin: string,
): { status: "missing" | "rejected"; reason: string } | undefined {
  if (!isSha256(trustedPin)) {
    return {
      status: "missing",
      reason: "trusted artifact SHA-256 pin is missing or malformed",
    };
  }
  if (artifactSha256 !== trustedPin.toLowerCase()) {
    return {
      status: "rejected",
      reason: "artifact SHA-256 does not match trusted pin",
    };
  }
  return undefined;
}

function parseArtifactJson(
  rawArtifact: string,
): CallResolutionCertificationArtifact | null {
  try {
    return parseArtifact(JSON.parse(rawArtifact) as unknown);
  } catch {
    return null;
  }
}

function decisionFromSignatures(
  artifactSha256: string,
  signatures: CallResolutionCertificationArtifact["signatures"],
): CallResolutionCertificationDecision {
  const seen = new Set<string>();
  const certified = new Set<string>();
  const unpromoted: UnpromotedCertificationSignature[] = [];
  for (const record of signatures) {
    if (seen.has(record.ruleSignature)) {
      return createDecision(
        artifactSha256,
        "rejected",
        [],
        ["artifact contains duplicate rule signatures"],
      );
    }
    seen.add(record.ruleSignature);
    const failures = signatureGateFailures(record);
    if (
      failures.newFamilyReasons.length === 0 &&
      failures.temporalReasons.length === 0
    ) {
      certified.add(record.ruleSignature);
    } else {
      unpromoted.push(failures);
    }
  }
  return createDecision(
    artifactSha256,
    "loaded",
    [...certified].sort(),
    [],
    certified,
    unpromoted,
  );
}

function parseArtifact(
  value: unknown,
): CallResolutionCertificationArtifact | null {
  if (!isRecord(value)) return null;
  if (!hasArtifactEnvelope(value)) return null;
  const inputs = parseInputs(value.inputs);
  if (!inputs) return null;
  const signatures = parseSignatureRecords(value.signatures);
  if (signatures.length !== value.signatures.length) return null;
  return {
    schemaVersion: value.schemaVersion,
    policyVersion: value.policyVersion,
    frozenAt: value.frozenAt,
    labelsOpenedAt: value.labelsOpenedAt,
    resultsRecordedAt: value.resultsRecordedAt,
    inputs,
    signatures,
  };
}

function hasArtifactEnvelope(
  value: Record<string, unknown>,
): value is ArtifactEnvelope {
  return (
    value.schemaVersion ===
      CALL_RESOLUTION_CERTIFICATION_ARTIFACT_SCHEMA_VERSION &&
    value.policyVersion === CALL_SITE_VERIFICATION_POLICY_VERSION &&
    isCanonicalTimestamp(value.frozenAt) &&
    isCanonicalTimestamp(value.labelsOpenedAt) &&
    isCanonicalTimestamp(value.resultsRecordedAt) &&
    isRecord(value.inputs) &&
    Array.isArray(value.signatures)
  );
}

function parseSignatureRecords(
  rows: unknown[],
): CallResolutionCertificationArtifact["signatures"] {
  return rows.flatMap(
    (raw): CallResolutionCertificationArtifact["signatures"] => {
      if (!isRecord(raw) || !isNonEmptyString(raw.ruleSignature)) return [];
      const newFamily = parseTrackResult(raw.newFamily);
      const temporal = parseTrackResult(raw.temporal);
      return newFamily && temporal
        ? [{ ruleSignature: raw.ruleSignature, newFamily, temporal }]
        : [];
    },
  );
}

function parseInputs(
  value: Record<string, unknown>,
): CallResolutionCertificationArtifact["inputs"] | null {
  if (!hasInputHashesAndTracks(value)) return null;
  const newFamily = parseTrackIdentity(value.newFamily);
  const temporal = parseTemporalTrackIdentity(value.temporal);
  if (!newFamily || !temporal) return null;
  return {
    implementationCommitSha: value.implementationCommitSha,
    ruleConfigurationSha256: value.ruleConfigurationSha256,
    oracleIdentity: value.oracleIdentity,
    oracleVersion: value.oracleVersion,
    oracleConfigurationSha256: value.oracleConfigurationSha256,
    corpusManifestSha256: value.corpusManifestSha256,
    newFamily,
    temporal,
  };
}

function hasInputHashesAndTracks(
  value: Record<string, unknown>,
): value is CertificationInputsEnvelope {
  return (
    isShaLike(value.implementationCommitSha, 40, 64) &&
    isSha256(value.ruleConfigurationSha256) &&
    isNonEmptyString(value.oracleIdentity) &&
    isNonEmptyString(value.oracleVersion) &&
    isSha256(value.oracleConfigurationSha256) &&
    isSha256(value.corpusManifestSha256) &&
    isRecord(value.newFamily) &&
    isRecord(value.temporal)
  );
}

function parseTrackIdentity(
  value: Record<string, unknown>,
): CertificationTrackIdentity | null {
  const familyId = value.familyId;
  const revision = value.revision;
  const splitSha256 = value.splitSha256;
  if (
    !isNonEmptyString(familyId) ||
    !isNonEmptyString(revision) ||
    !isSha256(splitSha256)
  ) {
    return null;
  }
  return {
    familyId,
    revision,
    splitSha256,
  };
}

function parseTemporalTrackIdentity(
  value: Record<string, unknown>,
): TemporalCertificationTrackIdentity | null {
  const base = parseTrackIdentity(value);
  if (!base || !isNonEmptyString(value.baseRevision)) return null;
  return { ...base, baseRevision: value.baseRevision };
}

function parseTrackResult(value: unknown): CertificationTrackResult | null {
  if (!isRecord(value)) return null;
  const eligibleDuplicateGroups = value.eligibleDuplicateGroups;
  const uniquelyResolvedGroups = value.uniquelyResolvedGroups;
  const successfulGroups = value.successfulGroups;
  const contradictionGroups = value.contradictionGroups;
  const lowerBound95 = value.lowerBound95;
  if (
    !isNonNegativeInteger(eligibleDuplicateGroups) ||
    !isNonNegativeInteger(uniquelyResolvedGroups) ||
    !isNonNegativeInteger(successfulGroups) ||
    !isNonNegativeInteger(contradictionGroups) ||
    typeof lowerBound95 !== "number" ||
    !Number.isFinite(lowerBound95) ||
    lowerBound95 < 0 ||
    lowerBound95 > 1
  ) {
    return null;
  }
  return {
    eligibleDuplicateGroups,
    uniquelyResolvedGroups,
    successfulGroups,
    contradictionGroups,
    lowerBound95,
  };
}

function validateArtifactProvenance(
  artifact: CallResolutionCertificationArtifact,
  expected: ExpectedCertificationInputs,
): string[] {
  const reasons: string[] = [];
  if (!matchesExpectedInputs(artifact.inputs, expected))
    reasons.push(
      "artifact frozen input hashes or track identity do not match runtime pin",
    );
  if (artifact.inputs.newFamily.familyId === artifact.inputs.temporal.familyId)
    reasons.push(
      "new-family and temporal tracks must use different repository families",
    );
  if (
    artifact.inputs.temporal.revision === artifact.inputs.temporal.baseRevision
  )
    reasons.push(
      "temporal track must use a revision newer than its pinned base",
    );
  if (
    Date.parse(artifact.frozenAt) >= Date.parse(artifact.labelsOpenedAt) ||
    Date.parse(artifact.labelsOpenedAt) > Date.parse(artifact.resultsRecordedAt)
  ) {
    reasons.push(
      "implementation and split hashes must be frozen before labels are opened",
    );
  }
  return reasons;
}

function matchesExpectedInputs(
  actual: CallResolutionCertificationArtifact["inputs"],
  expected: ExpectedCertificationInputs,
): boolean {
  return (
    actual.implementationCommitSha === expected.implementationCommitSha &&
    actual.ruleConfigurationSha256 === expected.ruleConfigurationSha256 &&
    actual.oracleIdentity === expected.oracleIdentity &&
    actual.oracleVersion === expected.oracleVersion &&
    actual.oracleConfigurationSha256 === expected.oracleConfigurationSha256 &&
    actual.corpusManifestSha256 === expected.corpusManifestSha256 &&
    sameTrackIdentity(actual.newFamily, expected.newFamily) &&
    sameTemporalTrackIdentity(actual.temporal, expected.temporal)
  );
}

function sameTrackIdentity(
  actual: CertificationTrackIdentity,
  expected: CertificationTrackIdentity,
): boolean {
  return (
    actual.familyId === expected.familyId &&
    actual.revision === expected.revision &&
    actual.splitSha256 === expected.splitSha256
  );
}

function sameTemporalTrackIdentity(
  actual: TemporalCertificationTrackIdentity,
  expected: TemporalCertificationTrackIdentity,
): boolean {
  return (
    sameTrackIdentity(actual, expected) &&
    actual.baseRevision === expected.baseRevision
  );
}

function trackGateFailureReasons(track: CertificationTrackResult): string[] {
  const reasons: string[] = [];
  if (!hasConsistentTrackCounts(track))
    reasons.push("duplicate-group counts are inconsistent");
  if (track.contradictionGroups !== 0)
    reasons.push("track contains valid contradictions");
  if (track.successfulGroups < CALL_RESOLUTION_CERTIFICATION_MINIMUM_GROUPS)
    reasons.push("track has fewer than 299 successful independent groups");
  const exactLowerBound = calculateZeroErrorLowerBound(track.successfulGroups);
  if (exactLowerBound < CALL_RESOLUTION_CERTIFICATION_TARGET_PRECISION)
    reasons.push("one-sided 95% Clopper-Pearson lower bound is below .990");
  if (Math.abs(track.lowerBound95 - exactLowerBound) > REPORTED_BOUND_TOLERANCE)
    reasons.push(
      "reported lower bound does not match the exact count-derived bound",
    );
  return reasons;
}

function hasConsistentTrackCounts(track: CertificationTrackResult): boolean {
  return (
    track.successfulGroups + track.contradictionGroups ===
      track.uniquelyResolvedGroups &&
    track.uniquelyResolvedGroups <= track.eligibleDuplicateGroups
  );
}

function calculateZeroErrorLowerBound(successfulGroups: number): number {
  return successfulGroups > 0 ? ONE_SIDED_ALPHA ** (1 / successfulGroups) : 0;
}

function signatureGateFailures(
  record: CallResolutionCertificationArtifact["signatures"][number],
): UnpromotedCertificationSignature {
  return {
    ruleSignature: record.ruleSignature,
    newFamilyReasons: trackGateFailureReasons(record.newFamily),
    temporalReasons: trackGateFailureReasons(record.temporal),
  };
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSha256(value: unknown): value is string {
  return isShaLike(value, 64, 64);
}

function isShaLike(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength &&
    /^[\da-f]+$/i.test(value)
  );
}
