import { createHash } from "node:crypto";
import type {
  SemanticCorpusSplit,
  SemanticSplitDropReason,
} from "../../lib/contracts/src/index.js";
import { assignSplits } from "../../lib/core/src/semantic/collection/semantic-dedup-splits.js";

const SPLITS: readonly SemanticCorpusSplit[] = [
  "test",
  "temporal",
  "calibration",
  "train",
];

export interface PrelabelSampleInput {
  readonly sampleId: string;
  readonly family: string;
  readonly duplicateGroup: string;
  readonly temporal: boolean;
}

export interface PrelabelSample extends PrelabelSampleInput {
  readonly split: SemanticCorpusSplit;
}

export interface PrelabelManifestInput {
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly splitSeed: string;
  readonly families: Readonly<Record<string, SemanticCorpusSplit>>;
  readonly samples: readonly PrelabelSampleInput[];
  readonly priorGroups?: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface PrelabelManifest {
  readonly schemaVersion: 1;
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly splitSeed: string;
  readonly samples: readonly PrelabelSample[];
}

export interface PrelabelResult {
  readonly manifest: PrelabelManifest;
  readonly manifestSha256: string;
  readonly splitHashes: Readonly<Record<SemanticCorpusSplit, string>>;
  readonly dropped: readonly {
    readonly sampleId: string;
    readonly reason: SemanticSplitDropReason;
  }[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareSampleId(
  left: PrelabelSampleInput,
  right: PrelabelSampleInput,
) {
  return left.sampleId < right.sampleId
    ? -1
    : left.sampleId > right.sampleId
      ? 1
      : 0;
}

/** Assign splits and hash the source-only sample inventory before any oracle is run. */
export function buildPrelabelManifest(
  input: PrelabelManifestInput,
): PrelabelResult {
  const sorted = [...input.samples].sort(compareSampleId);
  const seen = new Set<string>();
  for (const sample of sorted) {
    if (seen.has(sample.sampleId))
      throw new Error(`Duplicate prelabel sample ID: ${sample.sampleId}`);
    seen.add(sample.sampleId);
  }

  const assignment = assignSplits(sorted, input.families, input.priorGroups);
  const samples = sorted.flatMap((sample) => {
    const split = assignment.assigned[sample.sampleId];
    return split ? [{ ...sample, split }] : [];
  });
  const manifest: PrelabelManifest = {
    schemaVersion: 1,
    corpusId: input.corpusId,
    corpusVersion: input.corpusVersion,
    splitSeed: input.splitSeed,
    samples,
  };
  const splitHashes = Object.fromEntries(
    SPLITS.map((split) => [
      split,
      sha256(
        JSON.stringify(
          samples
            .filter((sample) => sample.split === split)
            .map(({ sampleId, duplicateGroup }) => ({
              sampleId,
              duplicateGroup,
            })),
        ),
      ),
    ]),
  ) as Record<SemanticCorpusSplit, string>;

  return {
    manifest,
    manifestSha256: sha256(JSON.stringify(manifest)),
    splitHashes,
    dropped: assignment.dropped,
  };
}
