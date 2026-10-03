import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  AstDeclaredTypeFacts,
  CallResolutionCalibrationRecord,
} from "../../lib/contracts/src/index.js";
import type {
  Phase2EvaluationLabel,
  Phase2EvaluationObservation,
} from "./phase2-tiered-call-resolution-evaluation.mjs";

export const PHASE2_ROOT = path.resolve(import.meta.dirname, "../..");
export const PHASE2_DEFAULT_REPOSITORIES = path.join(
  process.env.HOME ?? "/Users/daniel.chang",
  "Desktop/GitHub",
);
export const PHASE2_CORPUS = path.join(
  PHASE2_ROOT,
  "evaluate/results/semantic-corpus/v1/run-c",
);
export const PHASE2_PHASE1 = path.join(
  PHASE2_ROOT,
  "evaluate/results/semantic-corpus/v1/phase1-tiered-call-resolution-run-1",
);
export const PHASE2_PHASE1_PARITY = path.join(
  PHASE2_ROOT,
  "evaluate/results/semantic-corpus/v1/phase1-baseline-edge-parity-formatted-final",
);
export const PHASE2_DEFAULT_OUTPUT = path.join(
  PHASE2_ROOT,
  "evaluate/results/semantic-corpus/v1/phase2-tiered-call-resolution",
);
const CORRECTED_PHASE1_FACTS_SHA256 =
  "ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e";

export interface Phase2CorpusSource {
  readonly sampleId: string;
  readonly repoId: string;
  readonly repoFamily: string;
  readonly revision: string;
  readonly snapshotId: string;
  readonly subtree: string | null;
  readonly snapshotHash: string;
  readonly split: string;
  readonly duplicateGroup: string;
  readonly callSiteId: string;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly calleeName: string | null;
  readonly positionStatus: "unique" | "excluded";
}

export interface Phase2FactFile {
  readonly snapshotId: string;
  readonly repoId: string;
  readonly revision: string;
  readonly snapshotHash: string;
  readonly filePath: string;
  readonly fileContentSha256: string;
  readonly declaredTypeFacts: AstDeclaredTypeFacts;
}

export interface Phase2CalibrationArtifact {
  readonly schemaVersion: 1;
  readonly split: "calibration";
  readonly frozenAt: string;
  readonly configurationHash: string;
  readonly calibrationInputFingerprint: string;
  readonly records: readonly CallResolutionCalibrationRecord[];
}

export interface Phase2RawResultArtifact {
  readonly schemaVersion: 1;
  readonly observations: readonly Phase2EvaluationObservation[];
}

export interface Phase2LabelsRow extends Phase2EvaluationLabel {
  readonly repoId: string;
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

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

export function canonicalHash(value: unknown): string {
  return sha256(canonical(value));
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function readJsonl<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

export function writeJsonl(filePath: string, rows: readonly unknown[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  writeFileSync(
    temporary,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
  renameSync(temporary, filePath);
}

export function verifyPhase1Sidecars(): Record<string, string> {
  const checksums = readJson<{
    outputs: Record<string, string>;
  }>(path.join(PHASE2_PHASE1, "checksums.json"));
  const actual: Record<string, string> = {};
  for (const [name, expected] of Object.entries(checksums.outputs)) {
    if (name === "declared-type-facts.jsonl") continue;
    const digest = sha256(readFileSync(path.join(PHASE2_PHASE1, name)));
    if (digest !== expected)
      throw new Error(`Phase 1 input checksum mismatch for ${name}.`);
    actual[name] = digest;
  }
  const parity = readJson<{
    outputs: Record<string, string>;
  }>(path.join(PHASE2_PHASE1_PARITY, "checksums.json"));
  const firstPass = parity.outputs["declared-type-facts-pass-a.jsonl"];
  const secondPass = parity.outputs["declared-type-facts-pass-b.jsonl"];
  if (!firstPass || firstPass !== secondPass)
    throw new Error(
      "Corrected Phase 1 fact passes are missing or inconsistent.",
    );
  for (const name of [
    "declared-type-facts-pass-a.jsonl",
    "declared-type-facts-pass-b.jsonl",
  ]) {
    const digest = sha256(readFileSync(path.join(PHASE2_PHASE1_PARITY, name)));
    if (digest !== parity.outputs[name])
      throw new Error(`Corrected Phase 1 facts checksum mismatch for ${name}.`);
  }
  actual["declared-type-facts-pass-a.jsonl"] = firstPass;
  if (firstPass !== CORRECTED_PHASE1_FACTS_SHA256)
    throw new Error("Phase 2 requires the corrected Phase 1 facts artifact.");
  return actual;
}

export function labelsForSplit(
  split: string,
  expectedSampleIds: ReadonlySet<string>,
): Phase2LabelsRow[] {
  const rows = readJsonl<Phase2LabelsRow>(
    path.join(PHASE2_PHASE1, "labels.jsonl"),
  ).filter((row) => row.split === split);
  if (rows.length !== expectedSampleIds.size)
    throw new Error(
      `${split} label count ${rows.length} differs from source denominator ${expectedSampleIds.size}.`,
    );
  for (const row of rows)
    if (!expectedSampleIds.has(row.sampleId))
      throw new Error(`Unexpected ${split} label ${row.sampleId}.`);
  return rows;
}

export function allSourceRows(): Phase2CorpusSource[] {
  return readJsonl<Phase2CorpusSource>(
    path.join(PHASE2_PHASE1, "callsites.jsonl"),
  );
}

export function allFactRows(): Phase2FactFile[] {
  return readJsonl<Phase2FactFile>(
    path.join(PHASE2_PHASE1_PARITY, "declared-type-facts-pass-a.jsonl"),
  );
}

export function sortedRows<T extends { readonly sampleId: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((left, right) =>
    left.sampleId.localeCompare(right.sampleId),
  );
}
