import {
  DocuviaError,
  ErrorCodes,
  SemanticDecisionLimits,
  type SemanticCorpusSample,
} from "@workspace/contracts";
import {
  hasKeys,
  isDataArray,
  isNonBlank,
  isRecord,
} from "./semantic-decision-shapes.js";

const MAX_RECORD_BYTES = 128 * 1024;
const MAX_REFERENCES = 256;
const SHA256 = /^[a-f0-9]{64}$/;

export function invalidCorpus(message: string): never {
  throw new DocuviaError(ErrorCodes.SEMANTIC_CORPUS_INVALID, message);
}

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value) || !hasKeys(value, keys))
    invalidCorpus("Invalid corpus record shape");
  return value;
}

function strings(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (!keys.every((key) => isNonBlank(value[key])))
    invalidCorpus("Corpus identity must be nonblank");
}

function oneOf(value: unknown, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value))
    invalidCorpus("Unsupported corpus enum value");
}

function hash(value: unknown): void {
  if (typeof value !== "string" || !SHA256.test(value))
    invalidCorpus("Corpus hash must be lowercase SHA-256");
}

function list(value: unknown, limit = MAX_REFERENCES): unknown[] {
  if (!Array.isArray(value) || value.length > limit || !isDataArray(value))
    invalidCorpus("Invalid or oversized corpus array");
  return value;
}

function ids(value: unknown): string[] {
  const items = list(value);
  if (!items.every(isNonBlank) || new Set(items).size !== items.length)
    invalidCorpus("Corpus references must be nonblank and unique");
  return items as string[];
}

function source(value: unknown): void {
  const identityKeys = [
    "repoId",
    "repoFamily",
    "revision",
    "projectId",
    "callSiteId",
    "snapshotHash",
    "duplicateGroup",
    "license",
    "language",
    "relation",
  ];
  const data = record(value, [...identityKeys, "usage", "origin", "split"]);
  strings(data, identityKeys);
  hash(data.snapshotHash);
  oneOf(data.usage, ["evaluation-only", "training-and-evaluation"]);
  oneOf(data.origin, ["real", "synthetic"]);
  oneOf(data.split, ["train", "calibration", "test", "temporal"]);
}

function oracle(value: unknown): void {
  const data = record(value, [
    "status",
    "server",
    "version",
    "configHash",
    "snapshotHash",
    "targetIds",
  ]);
  strings(data, ["server", "version"]);
  hash(data.configHash);
  hash(data.snapshotHash);
  oneOf(data.status, [
    "resolved",
    "timeout",
    "empty",
    "not-ready",
    "unsupported",
    "error",
  ]);
  ids(data.targetIds);
}

function review(value: unknown): void {
  const data = record(value, [
    "status",
    "snapshotHash",
    "positiveTargetIds",
    "negativeTargetIds",
    "evidenceRefs",
  ]);
  hash(data.snapshotHash);
  oneOf(data.status, ["confirmed", "unreviewed", "conflict", "out-of-scope"]);
  ids(data.positiveTargetIds);
  ids(data.negativeTargetIds);
  const refs = ids(data.evidenceRefs);
  if (data.status === "confirmed" && refs.length === 0)
    invalidCorpus("Confirmed gold requires independent evidence");
}

function candidates(value: unknown): void {
  const items = list(value, SemanticDecisionLimits.MAX_CANDIDATES);
  const candidateIds: string[] = [];
  const targets: string[] = [];
  for (const item of items) {
    const data = record(item, ["id", "targetId"]);
    strings(data, ["id", "targetId"]);
    candidateIds.push(data.id as string);
    targets.push(data.targetId as string);
  }
  ids(candidateIds);
  ids(targets);
}

/** Validates declared provenance only; collection must verify the source bytes separately. */
export function validateCorpusSample(value: unknown): SemanticCorpusSample {
  try {
    const data = record(value, [
      "schemaVersion",
      "sampleId",
      "source",
      "candidates",
      "truncated",
      "oracle",
      "review",
    ]);
    if (data.schemaVersion !== 1 || typeof data.truncated !== "boolean")
      invalidCorpus("Invalid corpus version or truncation flag");
    strings(data, ["sampleId"]);
    source(data.source);
    candidates(data.candidates);
    oracle(data.oracle);
    review(data.review);
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES)
      invalidCorpus("Corpus record exceeds 128 KiB");
    return JSON.parse(serialized) as SemanticCorpusSample;
  } catch (cause) {
    throw DocuviaError.wrap(
      ErrorCodes.SEMANTIC_CORPUS_INVALID,
      "Invalid corpus sample",
      cause,
    );
  }
}
