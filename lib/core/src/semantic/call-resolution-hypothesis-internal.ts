import { createHash } from "node:crypto";
import type {
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisCandidate,
  CallResolutionHypothesisServiceOptions,
} from "@workspace/contracts";
import {
  AST_CALL_SITE_SHAPE_SCHEMA_VERSION,
  AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_RANKING_POLICY_VERSION,
  DocuviaError,
  ErrorCodes,
} from "@workspace/contracts";

export const HASH_PATTERN = /^[a-f0-9]{64}$/;
export const FLOAT_EPSILON = 1e-10;
export const DEFAULTS = {
  maxCandidates: 25,
  minimumIndependentGroups: 100,
  minimumConfidenceLowerBound: 0.9,
  targetFamilyMacroTop1: 0.9,
} as const;
export const RANKING_WEIGHTS = {
  explicitReceiverType: 100,
  peerMembers: 20,
  compatibleArity: 10,
  sameDirectory: 1,
} as const;

export type CandidateWithoutRank = Omit<
  CallResolutionHypothesisCandidate,
  "rankScore" | "rankingSignals"
>;

export type NormalizedServiceOptions = Required<
  Pick<
    CallResolutionHypothesisServiceOptions,
    | "maxCandidates"
    | "minimumIndependentGroups"
    | "minimumConfidenceLowerBound"
    | "targetFamilyMacroTop1"
  >
> &
  Pick<CallResolutionHypothesisServiceOptions, "calibrationRecords">;

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

export function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(objectValue)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function isFiniteRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= FLOAT_EPSILON;
}

export function createConfigurationHash(
  options: NormalizedServiceOptions,
): string {
  return hash({
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    rankingPolicyVersion: CALL_RESOLUTION_RANKING_POLICY_VERSION,
    declaredTypeFactsSchemaVersion: AST_DECLARED_TYPE_FACTS_SCHEMA_VERSION,
    callSiteShapeSchemaVersion: AST_CALL_SITE_SHAPE_SCHEMA_VERSION,
    filterOrder: ["visibility", "explicit-receiver", "peer-members", "arity"],
    rankingWeights: RANKING_WEIGHTS,
    arityPolicy: {
      javascript: "ranking-only",
      unknownOrSpread: "retain",
      typescript: "filter-only-on-complete-known-signature",
    },
    visibilityPolicy: "private-only-when-caller-owner-is-exact",
    options: {
      maxCandidates: options.maxCandidates,
      minimumIndependentGroups: options.minimumIndependentGroups,
      minimumConfidenceLowerBound: options.minimumConfidenceLowerBound,
      targetFamilyMacroTop1: options.targetFamilyMacroTop1,
    },
  });
}

function invalidRequest(message: string): never {
  throw new DocuviaError(ErrorCodes.SEMANTIC_INVALID_REQUEST, message);
}

export function validateWorkspaceInput(input: {
  sourceFingerprint: string;
  sourceFiles: readonly { filePath: string }[];
  sourceIndexComplete: boolean;
}): void {
  if (!HASH_PATTERN.test(input.sourceFingerprint))
    invalidRequest("sourceFingerprint must be a lowercase SHA-256 hash.");
  if (!Array.isArray(input.sourceFiles))
    invalidRequest("sourceFiles must be an array.");
  if (typeof input.sourceIndexComplete !== "boolean")
    invalidRequest("sourceIndexComplete must be a boolean.");
  if (input.sourceFiles.some(({ filePath }) => !filePath))
    invalidRequest("Every source file must have a filePath.");
}

export function validateHypothesisRequest(
  request: CallResolutionHypothesisRequest,
): void {
  if (!request.callerFilePath || !request.callSite?.calleeName)
    invalidRequest("callerFilePath and callSite.calleeName are required.");
  if (
    request.callSite.argumentCount !== null &&
    (!Number.isInteger(request.callSite.argumentCount) ||
      request.callSite.argumentCount < 0)
  ) {
    invalidRequest("argumentCount must be a non-negative integer or null.");
  }
}

export function normalizeServiceOptions(
  options: CallResolutionHypothesisServiceOptions,
): NormalizedServiceOptions {
  const normalized = {
    maxCandidates: options.maxCandidates ?? DEFAULTS.maxCandidates,
    minimumIndependentGroups:
      options.minimumIndependentGroups ?? DEFAULTS.minimumIndependentGroups,
    minimumConfidenceLowerBound:
      options.minimumConfidenceLowerBound ??
      DEFAULTS.minimumConfidenceLowerBound,
    targetFamilyMacroTop1:
      options.targetFamilyMacroTop1 ?? DEFAULTS.targetFamilyMacroTop1,
    calibrationRecords: options.calibrationRecords
      ? deepFreeze(structuredClone(options.calibrationRecords))
      : undefined,
  };
  validateServiceOptions(normalized);
  return normalized;
}

function validateServiceOptions(options: NormalizedServiceOptions): void {
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1)
    invalidRequest("maxCandidates must be a positive integer.");
  if (
    !Number.isInteger(options.minimumIndependentGroups) ||
    options.minimumIndependentGroups < 1
  ) {
    invalidRequest("minimumIndependentGroups must be a positive integer.");
  }
  if (!isFiniteRatio(options.minimumConfidenceLowerBound))
    invalidRequest("minimumConfidenceLowerBound must be finite in [0, 1].");
  if (!isFiniteRatio(options.targetFamilyMacroTop1))
    invalidRequest("targetFamilyMacroTop1 must be finite in [0, 1].");
}
