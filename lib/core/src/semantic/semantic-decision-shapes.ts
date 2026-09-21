import {
  SemanticDecisionSchemaVersion,
  type SemanticDecisionRequestIdentity,
} from "@workspace/contracts";

/** Strict data-only shapes: no coercion, unknown-key stripping or class instances. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every(
      (key) => typeof key === "string" && allowed.has(key),
    )
  );
}

export function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export const IDENTITY_KEYS = [
  "schemaVersion",
  "requestId",
  "featureSchemaVersion",
  "evidence",
] as const;
export const EVIDENCE_KEYS = [
  "repoId",
  "worktreeId",
  "projectId",
  "snapshotHash",
  "candidateSetHash",
  "truncated",
] as const;

export function isIdentity(value: Record<string, unknown>): boolean {
  if (
    value.schemaVersion !== SemanticDecisionSchemaVersion ||
    !isNonBlank(value.requestId) ||
    !isNonBlank(value.featureSchemaVersion)
  )
    return false;
  const evidence = value.evidence;
  return (
    isRecord(evidence) &&
    hasKeys(evidence, EVIDENCE_KEYS) &&
    EVIDENCE_KEYS.filter((key) => key !== "truncated").every((key) =>
      isNonBlank(evidence[key]),
    ) &&
    evidence.truncated === false
  );
}

export function matchesIdentity(
  request: SemanticDecisionRequestIdentity,
  value: Record<string, unknown>,
): boolean {
  if (!isIdentity(value)) return false;
  const evidence = value.evidence as Record<string, unknown>;
  return (
    value.schemaVersion === request.schemaVersion &&
    value.requestId === request.requestId &&
    value.featureSchemaVersion === request.featureSchemaVersion &&
    EVIDENCE_KEYS.every((key) => evidence[key] === request.evidence[key])
  );
}
