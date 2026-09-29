import { createHash } from "node:crypto";
import {
  DocuviaError,
  ErrorCodes,
  type SemanticCorpusSplit,
  type SemanticSplitDropReason,
} from "@workspace/contracts";

const WINDOW_RADIUS = 2;
const FAMILY_OVERLAP_THRESHOLD = 0.2;
/** C-06: a duplicate group spanning splits keeps the first split present in this order. */
const SPLIT_PRIORITY: readonly SemanticCorpusSplit[] = [
  "test",
  "temporal",
  "calibration",
  "train",
];

/** C-06: SHA-256 of the whitespace-normalized ±2-line window plus the callee name. */
export function fragmentKey(
  lines: readonly string[],
  line: number,
  calleeName: string,
): string {
  const window = lines
    .slice(Math.max(0, line - WINDOW_RADIUS), line + WINDOW_RADIUS + 1)
    .map((text) => text.replace(/\s+/g, ""));
  return createHash("sha256")
    .update(JSON.stringify([calleeName, window]), "utf8")
    .digest("hex");
}

export function overlapCoefficient(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const value of smaller) if (larger.has(value)) shared++;
  return shared / smaller.size;
}

export interface FamilySnapshot {
  readonly snapshotId: string;
  readonly family: string;
  readonly fileHashes: ReadonlySet<string>;
  readonly rootCommits: readonly string[];
}

export interface FamilyRelation {
  readonly a: string;
  readonly b: string;
  readonly overlap: number;
  readonly sharedRoot: boolean;
  readonly crossFamily: boolean;
}

function relationOf(
  a: FamilySnapshot,
  b: FamilySnapshot,
): FamilyRelation | undefined {
  const overlap = overlapCoefficient(a.fileHashes, b.fileHashes);
  const sharedRoot = a.rootCommits.some((root) => b.rootCommits.includes(root));
  if (overlap < FAMILY_OVERLAP_THRESHOLD && !sharedRoot) return undefined;
  return {
    a: a.snapshotId,
    b: b.snapshotId,
    overlap,
    sharedRoot,
    crossFamily: a.family !== b.family,
  };
}

/** C-06: pairwise source-overlap / shared-root relations, ordered by snapshot ID. */
export function findFamilyRelations(
  snapshots: readonly FamilySnapshot[],
): FamilyRelation[] {
  const sorted = [...snapshots].sort((x, y) =>
    x.snapshotId < y.snapshotId ? -1 : 1,
  );
  const relations: FamilyRelation[] = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const relation = relationOf(sorted[i], sorted[j]);
      if (relation) relations.push(relation);
    }
  return relations;
}

export interface SplitItem {
  readonly sampleId: string;
  readonly family: string;
  readonly duplicateGroup: string;
  readonly temporal: boolean;
}

export interface SplitAssignment {
  readonly assigned: Readonly<Record<string, SemanticCorpusSplit>>;
  readonly dropped: readonly {
    readonly sampleId: string;
    readonly reason: SemanticSplitDropReason;
  }[];
}

function splitOf(
  item: SplitItem,
  families: Readonly<Record<string, SemanticCorpusSplit>>,
): SemanticCorpusSplit {
  const declared = Object.hasOwn(families, item.family)
    ? families[item.family]
    : undefined;
  if (declared === undefined || declared === "temporal")
    invalid(`Family ${item.family} has no declared split`);
  if (item.temporal && declared !== "test")
    invalid(`Temporal snapshot of ${item.family} must belong to a test family`);
  return item.temporal ? "temporal" : declared;
}

function earlierGroups(
  items: readonly SplitItem[],
  priorGroups: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const keys = items
    .filter((item) => !item.temporal)
    .map((item) => `${item.family}\0${item.duplicateGroup}`);
  for (const [family, groups] of priorGroups)
    for (const group of groups) keys.push(`${family}\0${group}`);
  return new Set(keys);
}

function groupWinners(
  kept: readonly { item: SplitItem; split: SemanticCorpusSplit }[],
): Map<string, SemanticCorpusSplit> {
  const present = new Map<string, Set<SemanticCorpusSplit>>();
  for (const { item, split } of kept) {
    const splits = present.get(item.duplicateGroup) ?? new Set();
    splits.add(split);
    present.set(item.duplicateGroup, splits);
  }
  const winners = new Map<string, SemanticCorpusSplit>();
  for (const [group, splits] of present)
    winners.set(
      group,
      SPLIT_PRIORITY.find((split) => splits.has(split))!,
    );
  return winners;
}

/** C-06: spec-declared family splits, temporal novelty, then cross-split duplicate removal.
 *  `priorGroups` holds every fragment of each family's earlier snapshot (sampled or not), so a
 *  temporal call site is novel only if it did not exist anywhere in the earlier revision. */
export function assignSplits(
  items: readonly SplitItem[],
  families: Readonly<Record<string, SemanticCorpusSplit>>,
  priorGroups: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): SplitAssignment {
  const earlier = earlierGroups(items, priorGroups);
  const dropped: { sampleId: string; reason: SemanticSplitDropReason }[] = [];
  const kept: { item: SplitItem; split: SemanticCorpusSplit }[] = [];
  for (const item of items) {
    const split = splitOf(item, families);
    if (item.temporal && earlier.has(`${item.family}\0${item.duplicateGroup}`))
      dropped.push({ sampleId: item.sampleId, reason: "temporal-unchanged" });
    else kept.push({ item, split });
  }
  const winners = groupWinners(kept);
  const assigned: Record<string, SemanticCorpusSplit> = {};
  for (const { item, split } of kept) {
    if (winners.get(item.duplicateGroup) === split)
      assigned[item.sampleId] = split;
    else dropped.push({ sampleId: item.sampleId, reason: "dedup-cross-split" });
  }
  dropped.sort((a, b) => (a.sampleId < b.sampleId ? -1 : 1));
  return { assigned, dropped };
}

function invalid(message: string): never {
  throw new DocuviaError(ErrorCodes.SEMANTIC_CORPUS_INVALID, message);
}
