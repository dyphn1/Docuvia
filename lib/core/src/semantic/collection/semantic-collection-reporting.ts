import { createHash } from "node:crypto";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";

const AUDIT_FRACTION = 0.1;
const CONFLICT_REASON = "label-conflict";
const DEFAULT_MISMATCH_LIMIT = 200;

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** C-08: every conflict plus a seeded ceil(10%) of each stratum, sorted by sample ID. */
export function selectAuditSample(
  entries: readonly {
    readonly sampleId: string;
    readonly stratum: string;
    readonly reason: string;
  }[],
  seed: string,
): string[] {
  const rank = (id: string): string =>
    createHash("sha256").update(`${seed}\0${id}`, "utf8").digest("hex");
  const strata = new Map<string, string[]>();
  const picked = new Set<string>();
  for (const { sampleId, stratum, reason } of entries) {
    if (reason === CONFLICT_REASON) picked.add(sampleId);
    strata.set(stratum, [...(strata.get(stratum) ?? []), sampleId]);
  }
  for (const ids of strata.values()) {
    const ranked = [...ids].sort((a, b) => byCodeUnit(rank(a), rank(b)));
    const quota = Math.ceil(ids.length * AUDIT_FRACTION);
    for (const id of ranked.slice(0, quota)) picked.add(id);
  }
  return [...picked].sort(byCodeUnit);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareArrays(
  a: readonly unknown[],
  b: readonly unknown[],
  path: string,
  visit: (x: unknown, y: unknown, p: string) => void,
  out: string[],
): void {
  if (a.length !== b.length) {
    out.push(`${path}.length`);
    return;
  }
  a.forEach((item, i) => visit(item, b[i], `${path}[${i}]`));
}

/** C-07: JSON paths whose values differ, ignoring timing keys anywhere in the tree. */
export function compareReplays(
  a: unknown,
  b: unknown,
  ignoredKeys: readonly string[],
  limit: number = DEFAULT_MISMATCH_LIMIT,
): string[] {
  const out: string[] = [];
  const ignored = new Set(ignoredKeys);
  const visit = (x: unknown, y: unknown, path: string): void => {
    if (out.length >= limit) return;
    if (Array.isArray(x) && Array.isArray(y))
      return compareArrays(x, y, path, visit, out);
    if (isObject(x) && isObject(y)) {
      const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
      for (const key of keys.filter((k) => !ignored.has(k)))
        visit(x[key], y[key], `${path}.${key}`);
      return;
    }
    if (!Object.is(x, y)) out.push(path);
  };
  visit(a, b, "$");
  return out.slice(0, limit);
}

export interface DurationSummary {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
  readonly samples: readonly number[];
}

/** C-09: nearest-rank percentiles over raw wall-clock samples (kept verbatim). */
export function summarizeDurations(
  samples: readonly number[],
): DurationSummary {
  if (
    samples.length === 0 ||
    !samples.every((s) => Number.isFinite(s) && s >= 0)
  )
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_CORPUS_INVALID,
      "Duration samples must be finite and nonnegative",
    );
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return {
    n: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    samples: [...samples],
  };
}
