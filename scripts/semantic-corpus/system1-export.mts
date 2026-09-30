/** Deterministic, label-separated System-1 encoding export for semantic corpus v1. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ErrorCodes,
  SemanticDecisionOptionKinds,
  type SemanticCollectionCallSite,
  type SemanticCorpusManifest,
  type SemanticCorpusSample,
  type SemanticTierACandidateSet,
} from "../../lib/contracts/src/index.js";
import {
  SYSTEM1_AMBIGUITY_CLASS_ORDER,
  SYSTEM1_EXCLUSION_REASONS,
  SYSTEM1_EVIDENCE_STATUSES,
  SYSTEM1_EXPORT_SCHEMA_VERSION,
  SYSTEM1_FEATURE_SCHEMA_VERSION,
  SYSTEM1_FILE_NAMES,
  SYSTEM1_HELD_OUT_SPLITS,
  SYSTEM1_JSON_LINE_ENDING,
  SYSTEM1_MEMORY_FLOOR_PERCENT,
  SYSTEM1_PARTITIONS,
  SYSTEM1_SPLITS,
  SYSTEM1_SOURCE_CORPUS_VERSION,
  SYSTEM1_TIER_A_EVIDENCE,
  SYSTEM1_TIER_A_RANKS,
  SYSTEM1_TIER_A_REPLAY_MISMATCH_REASON,
  SYSTEM1_USAGE,
} from "../../lib/core/src/semantic/system1/system1-constants.js";
import { buildSystem1Labels } from "../../lib/core/src/semantic/system1/system1-labels.js";
import {
  createSystem1ExclusionRecord,
  serializeSystem1Exclusions,
  type System1ExcludedSample,
} from "../../lib/core/src/semantic/system1/system1-exclusions.js";
import { assertSystem1SplitLicense } from "../../lib/core/src/semantic/system1/system1-split-policy.js";
import {
  buildSystem1State,
  system1TextWasTruncated,
} from "../../lib/core/src/semantic/system1/system1-state-builder.js";
import { classifySystem1Ambiguities } from "../../lib/core/src/semantic/system1/system1-ambiguity-classifiers.js";
import type {
  System1CandidateInput,
  System1DatasetRecord,
  System1LabelRecord,
  System1Split,
  System1Usage,
} from "../../lib/core/src/semantic/system1/system1-types.js";
import {
  createTierAIndex,
  tierACandidates,
} from "../../lib/core/src/semantic/collection/semantic-tier-a-candidates.js";
import { validateCorpusManifest } from "../../lib/core/src/semantic/semantic-corpus-manifest.js";
import {
  assertClean,
  describeRevision,
  hashSnapshot,
  materializeSnapshot,
} from "./snapshot.mts";
import { assertMemoryHeadroom } from "./memory-guard.mts";
import { readTierAGraph, runTierA } from "./tier-a.mts";
import {
  System1SnapshotSyntax,
  type TierACandidateSyntaxInput,
} from "./system1-syntax.mts";

const SCRIPT_DIRECTORY = import.meta.dirname;
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const DEFAULT_CORPUS_MANIFEST = path.join(
  REPOSITORY_ROOT,
  "evaluate/results/semantic-corpus/v1/run-c/corpus-manifest.json",
);
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "evaluate/results/semantic-corpus/v1/system1-dataset",
);
const DEFAULT_REPOSITORIES_DIRECTORY = path.join(
  os.homedir(),
  "Desktop",
  "GitHub",
);
const TIER_A_HEAP_MB = 4096;
const EMPTY_FILE = "";
const RUN_DIRECTORY_PREFIX = "docuvia-system1-export-";
const UTF8 = "utf8";
const SHA256 = "sha256";
const ARGUMENT_SEPARATOR = "--";
const SAMPLE_CALL_SITE_PATTERN = /^(.*):(\d+):(\d+)$/;
const STATE_LABEL_KEY_SEPARATOR = "\0";

interface ExportArguments {
  readonly manifest: string;
  readonly collectionReport: string;
  readonly repositories: string;
  readonly output: string;
}

interface SnapshotDescriptor {
  readonly repoId: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly snapshotHash: string;
}

interface SnapshotGroup {
  readonly repoId: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly samples: readonly SemanticCorpusSample[];
}

interface ExportedSample {
  readonly sample: SemanticCorpusSample;
  readonly split: System1Split;
  readonly state: System1DatasetRecord;
}

interface GroupResult {
  readonly exported: readonly ExportedSample[];
  readonly excluded: readonly System1ExcludedSample[];
}

interface SplitFiles {
  readonly stateText: string;
  readonly labelsText: string;
  readonly count: number;
}

function parseArguments(argv: readonly string[]): ExportArguments {
  const values: Record<string, string> = {};
  const arguments_ = argv[0] === ARGUMENT_SEPARATOR ? argv.slice(1) : argv;
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !key.startsWith(ARGUMENT_SEPARATOR) ||
      !value ||
      value.startsWith(ARGUMENT_SEPARATOR)
    )
      throw new Error(
        "Usage: pnpm run eval:semantic:system1-export -- [--manifest <file>] [--collection-report <file>] [--repos <dir>] [--out <dir>]",
      );
    values[key] = value;
  }
  const allowed = new Set([
    "--manifest",
    "--collection-report",
    "--repos",
    "--out",
  ]);
  for (const key of Object.keys(values))
    if (!allowed.has(key))
      throw new Error(`Unknown System-1 export argument: ${key}`);
  return {
    manifest: path.resolve(values["--manifest"] ?? DEFAULT_CORPUS_MANIFEST),
    collectionReport: path.resolve(
      values["--collection-report"] ??
        path.join(
          path.dirname(values["--manifest"] ?? DEFAULT_CORPUS_MANIFEST),
          "collection-report.json",
        ),
    ),
    repositories: path.resolve(
      values["--repos"] ?? DEFAULT_REPOSITORIES_DIRECTORY,
    ),
    output: path.resolve(values["--out"] ?? DEFAULT_OUTPUT_DIRECTORY),
  };
}

function parseManifest(file: string): SemanticCorpusManifest {
  const raw = validateCorpusManifest(JSON.parse(readFileSync(file, UTF8)));
  if (raw.corpusVersion !== SYSTEM1_SOURCE_CORPUS_VERSION)
    throw new Error("System-1 export requires semantic corpus v1");
  const samples = [...raw.samples].sort((a, b) =>
    compareText(a.sampleId, b.sampleId),
  );
  for (const sample of samples)
    assertSystem1SplitLicense(
      sample.source.split,
      sample.source.usage as System1Usage,
    );
  return { ...raw, samples };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readSnapshotDescriptors(file: string): SnapshotDescriptor[] {
  const report = JSON.parse(readFileSync(file, UTF8)) as {
    readonly snapshots?: readonly SnapshotDescriptor[];
  };
  if (!Array.isArray(report.snapshots))
    throw new Error(`Collection report has no snapshot descriptors: ${file}`);
  return report.snapshots
    .map((snapshot) => ({
      repoId: snapshot.repoId,
      revision: snapshot.revision,
      subtree: snapshot.subtree,
      snapshotHash: snapshot.snapshotHash,
    }))
    .sort((a, b) =>
      compareText(
        `${a.repoId}${STATE_LABEL_KEY_SEPARATOR}${a.revision}`,
        `${b.repoId}${STATE_LABEL_KEY_SEPARATOR}${b.revision}`,
      ),
    );
}

function splitGroups(
  samples: readonly SemanticCorpusSample[],
  descriptors: readonly SnapshotDescriptor[],
): SnapshotGroup[] {
  const descriptorsByKey = new Map(
    descriptors.map((descriptor) => [
      `${descriptor.repoId}${STATE_LABEL_KEY_SEPARATOR}${descriptor.revision}`,
      descriptor,
    ]),
  );
  const groups = new Map<string, SemanticCorpusSample[]>();
  for (const sample of samples) {
    const key = `${sample.source.repoId}${STATE_LABEL_KEY_SEPARATOR}${sample.source.revision}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const descriptor = descriptorsByKey.get(key);
      if (!descriptor)
        throw new Error(
          `Collection report has no snapshot descriptor for ${group[0].source.repoId}@${group[0].source.revision}`,
        );
      if (
        group.some(
          (sample) => sample.source.snapshotHash !== descriptor.snapshotHash,
        )
      )
        throw new Error(
          `Corpus snapshot hash disagrees with collection report for ${descriptor.repoId}@${descriptor.revision}`,
        );
      return {
        repoId: descriptor.repoId,
        revision: descriptor.revision,
        subtree: descriptor.subtree,
        samples: group,
      };
    })
    .sort((a, b) =>
      compareText(`${a.repoId}${a.revision}`, `${b.repoId}${b.revision}`),
    );
}

function sourceRepositoryPath(
  repositoriesDirectory: string,
  repoId: string,
): string {
  const repositoryName = repoId.split("/").at(-1);
  if (!repositoryName)
    throw new Error(`Invalid source repository identity: ${repoId}`);
  const match = readdirSync(repositoriesDirectory, {
    withFileTypes: true,
  }).find(
    (entry) =>
      entry.isDirectory() &&
      entry.name.toLocaleLowerCase("en-US") ===
        repositoryName.toLocaleLowerCase("en-US"),
  );
  if (!match) throw new Error(`Local source clone not found for ${repoId}`);
  const repositoryPath = path.join(repositoriesDirectory, match.name);
  if (!existsSync(path.join(repositoryPath, ".git")))
    throw new Error(
      `Local source clone has no Git metadata: ${repositoryPath}`,
    );
  return repositoryPath;
}

function candidateSite(sample: SemanticCorpusSample): {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
} | null {
  const match = SAMPLE_CALL_SITE_PATTERN.exec(sample.source.callSiteId);
  if (!match) return null;
  return {
    filePath: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
  };
}

function sameCandidateOrder(
  expected: SemanticCorpusSample["candidates"],
  actual: SemanticTierACandidateSet["candidates"],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every(
      (candidate, index) =>
        candidate.id === actual[index].id &&
        candidate.targetId === actual[index].targetId,
    )
  );
}

function rankCandidate(
  callSite: Pick<SemanticCollectionCallSite, "filePath">,
  node: { readonly nodeKey: string; readonly filePath: string },
  index: ReturnType<typeof createTierAIndex>,
): {
  readonly rank: System1CandidateInput["tierARank"];
  readonly evidence: System1CandidateInput["tierAEvidence"];
} | null {
  if (node.filePath === callSite.filePath) return null;
  if (index.callTargetsByFile.get(callSite.filePath)?.has(node.nodeKey))
    return {
      rank: SYSTEM1_TIER_A_RANKS.CALL_EDGE,
      evidence: SYSTEM1_TIER_A_EVIDENCE.CALL_EDGE,
    };
  if (index.importsByFile.get(callSite.filePath)?.has(node.filePath))
    return {
      rank: SYSTEM1_TIER_A_RANKS.IMPORTED_FILE,
      evidence: SYSTEM1_TIER_A_EVIDENCE.IMPORTED_FILE,
    };
  return {
    rank: SYSTEM1_TIER_A_RANKS.NAME_MATCH,
    evidence: SYSTEM1_TIER_A_EVIDENCE.NAME_MATCH,
  };
}

async function processGroup(
  group: SnapshotGroup,
  repositoriesDirectory: string,
  temporaryDirectory: string,
): Promise<GroupResult> {
  assertMemoryHeadroom(SYSTEM1_MEMORY_FLOOR_PERCENT);
  const sourceDirectory = sourceRepositoryPath(
    repositoriesDirectory,
    group.repoId,
  );
  const snapshotId = createHash(SHA256)
    .update(
      `${group.repoId}${STATE_LABEL_KEY_SEPARATOR}${group.revision}`,
      UTF8,
    )
    .digest("hex")
    .slice(0, 20);
  const snapshotDirectory = path.join(temporaryDirectory, snapshotId);
  const revision = describeRevision(sourceDirectory, group.revision);
  materializeSnapshot(
    sourceDirectory,
    revision.revision,
    group.subtree,
    snapshotDirectory,
  );
  const snapshot = hashSnapshot(snapshotDirectory);
  assertClean(snapshotDirectory);
  const expectedHashes = new Set(
    group.samples.map((sample) => sample.source.snapshotHash),
  );
  if (expectedHashes.size !== 1 || !expectedHashes.has(snapshot.hash))
    throw new Error(
      `Snapshot hash mismatch for ${group.repoId}@${group.revision}: ${snapshot.hash}`,
    );

  runTierA(snapshotDirectory, TIER_A_HEAP_MB);
  assertMemoryHeadroom(SYSTEM1_MEMORY_FLOOR_PERCENT);
  const graph = readTierAGraph(snapshotDirectory);
  const tierAIndex = createTierAIndex(graph.nodes, graph.edges);
  const nodesByKey = new Map(graph.nodes.map((node) => [node.nodeKey, node]));
  const syntaxReader = new System1SnapshotSyntax(
    snapshotDirectory,
    new Set(snapshot.files.keys()),
  );
  const exported: ExportedSample[] = [];
  const excluded: System1ExcludedSample[] = [];
  const exclude = (sample: SemanticCorpusSample, reason: string): void => {
    excluded.push(
      createSystem1ExclusionRecord(
        sample.sampleId,
        sample.source.split,
        reason,
      ),
    );
  };

  for (const sample of group.samples) {
    const position = candidateSite(sample);
    if (!position) {
      exclude(sample, SYSTEM1_EXCLUSION_REASONS.INVALID_CALL_SITE_ID);
      continue;
    }
    const callSite = graph.callSites.find(
      (site) =>
        site.filePath === position.filePath &&
        site.line === position.line &&
        site.column === position.column,
    );
    if (!callSite) {
      exclude(sample, SYSTEM1_EXCLUSION_REASONS.CALL_SITE_NOT_FOUND);
      continue;
    }
    const replayed = tierACandidates(tierAIndex, callSite);
    if (
      sample.truncated !== replayed.truncated ||
      !sameCandidateOrder(sample.candidates, replayed.candidates)
    ) {
      exclude(sample, SYSTEM1_TIER_A_REPLAY_MISMATCH_REASON);
      continue;
    }

    const candidates: TierACandidateSyntaxInput[] = [];
    const candidateRanks = new Map<string, TierACandidateSyntaxInput>();
    let rankUnavailable = false;
    for (const candidate of sample.candidates) {
      const node = nodesByKey.get(candidate.targetId);
      if (!node || node.name !== callSite.calleeName) {
        rankUnavailable = true;
        break;
      }
      const rank = rankCandidate(position, node, tierAIndex);
      if (!rank) {
        rankUnavailable = true;
        break;
      }
      const fact = {
        id: candidate.id,
        targetId: candidate.targetId,
        rank: rank.rank,
        evidence: rank.evidence,
        node,
      };
      candidates.push(fact);
      candidateRanks.set(candidate.targetId, fact);
    }
    if (rankUnavailable) {
      exclude(sample, SYSTEM1_EXCLUSION_REASONS.CANDIDATE_EVIDENCE_UNAVAILABLE);
      continue;
    }

    const tierASet: SemanticTierACandidateSet = {
      candidates: candidates.map(({ id, targetId }) => ({ id, targetId })),
      truncated: sample.truncated,
      matchCount: replayed.matchCount,
    };
    const syntax = syntaxReader.build(
      { ...callSite, ...position },
      tierASet,
      nodesByKey,
      new Map(
        [...candidateRanks].map(([targetId, rank]) => [
          targetId,
          { rank: rank.rank, evidence: rank.evidence },
        ]),
      ),
      sample.source.projectId,
    );
    if (syntax.kind === "unavailable") {
      exclude(sample, syntax.reason);
      continue;
    }
    const stateInput = {
      sampleId: sample.sampleId,
      repoId: sample.source.repoId,
      worktreeId: sample.source.revision,
      projectId: sample.source.projectId,
      snapshotHash: snapshot.hash,
      candidateSetTruncated: sample.truncated,
      caller: {
        filePath: callSite.filePath,
        symbol: syntax.syntax.callerSymbol,
      },
      call: syntax.syntax.call,
      importBinding: syntax.syntax.importBinding,
      candidates: syntax.syntax.candidates,
    };
    try {
      const request = buildSystem1State(stateInput);
      const ambiguity = classifySystem1Ambiguities(
        syntax.syntax.ambiguityEvidence,
      );
      exported.push({
        sample,
        split: sample.source.split,
        state: {
          request,
          ambiguityClasses: ambiguity.tags,
          notDetectedClasses: ambiguity.notDetected,
          candidateCount: syntax.syntax.candidates.length,
          textTruncated: system1TextWasTruncated(stateInput),
        },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED
      ) {
        exclude(sample, SYSTEM1_EXCLUSION_REASONS.SYSTEM1_INPUT_BYTE_LIMIT);
        continue;
      }
      throw error;
    }
  }
  rmSync(snapshotDirectory, { recursive: true, force: true });
  return { exported, excluded };
}

function labelForSample(item: ExportedSample): System1LabelRecord {
  return buildSystem1Labels({
    requestId: item.state.request.requestId,
    candidateTargetIds: item.sample.candidates.map(
      (candidate) => candidate.targetId,
    ),
    positiveTargetIds: item.sample.review.positiveTargetIds,
    negativeTargetIds: item.sample.review.negativeTargetIds,
    reviewStatus: item.sample.review.status,
    oracleStatus: item.sample.oracle.status,
  });
}

function stableJsonLines(values: readonly unknown[]): string {
  return values.length === 0
    ? EMPTY_FILE
    : `${values.map((value) => JSON.stringify(value)).join(SYSTEM1_JSON_LINE_ENDING)}${SYSTEM1_JSON_LINE_ENDING}`;
}

function splitOutput(samples: readonly ExportedSample[]): {
  readonly files: Record<System1Split, SplitFiles>;
  readonly labels: ReadonlyMap<string, System1LabelRecord>;
} {
  const labels = new Map<string, System1LabelRecord>();
  const bySplit = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => [split, [] as ExportedSample[]]),
  ) as Record<System1Split, ExportedSample[]>;
  for (const item of samples) {
    const requestId = item.state.request.requestId;
    if (labels.has(requestId))
      throw new Error(`Duplicate System-1 request ID: ${requestId}`);
    labels.set(requestId, labelForSample(item));
    bySplit[item.split].push(item);
  }
  const files = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => {
      const ordered = bySplit[split].sort((a, b) =>
        compareText(a.state.request.requestId, b.state.request.requestId),
      );
      return [
        split,
        {
          stateText: stableJsonLines(ordered.map((item) => item.state)),
          labelsText: stableJsonLines(
            ordered.map((item) => labels.get(item.state.request.requestId)),
          ),
          count: ordered.length,
        },
      ];
    }),
  ) as Record<System1Split, SplitFiles>;
  return { files, labels };
}

function sha256(text: string): string {
  return createHash(SHA256).update(text, UTF8).digest("hex");
}

function buildSeals(
  files: Record<System1Split, SplitFiles>,
): Record<string, string> {
  const seals: Record<string, string> = {};
  for (const split of SYSTEM1_HELD_OUT_SPLITS) {
    const partition = files[split];
    seals[split] = `${JSON.stringify(
      {
        schemaVersion: SYSTEM1_EXPORT_SCHEMA_VERSION,
        partition: split,
        stateFile: SYSTEM1_FILE_NAMES.STATE(split),
        labelsFile: SYSTEM1_FILE_NAMES.LABELS(split),
        stateSha256: sha256(partition.stateText),
        labelsSha256: sha256(partition.labelsText),
        count: partition.count,
      },
      null,
      2,
    )}${SYSTEM1_JSON_LINE_ENDING}`;
  }
  return seals;
}

function payloadHash(
  files: Record<System1Split, SplitFiles>,
  seals: Readonly<Record<string, string>>,
  excludedText: string,
  labelsReportText: string,
): string {
  const entries = [
    ...SYSTEM1_PARTITIONS.flatMap(
      (split) =>
        [
          [SYSTEM1_FILE_NAMES.STATE(split), files[split].stateText],
          [SYSTEM1_FILE_NAMES.LABELS(split), files[split].labelsText],
        ] as const,
    ),
    ...Object.entries(seals).map(
      ([split, text]) => [SYSTEM1_FILE_NAMES.SEAL(split), text] as const,
    ),
    [SYSTEM1_FILE_NAMES.EXCLUDED, excludedText] as const,
    [SYSTEM1_FILE_NAMES.LABELS_REPORT, labelsReportText] as const,
  ].sort(([left], [right]) => compareText(left, right));
  const hash = createHash(SHA256);
  for (const [file, contents] of entries)
    hash.update(`${file}\0${sha256(contents)}\n`, UTF8);
  return hash.digest("hex");
}

function reportFor(
  manifest: SemanticCorpusManifest,
  exported: readonly ExportedSample[],
  files: Record<System1Split, SplitFiles>,
  excluded: readonly System1ExcludedSample[],
  excludedText: string,
  seals: Readonly<Record<string, string>>,
  labelsReportText: string,
): Record<string, unknown> {
  const perSplitClassCounts = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => [
      split,
      Object.fromEntries(
        SYSTEM1_AMBIGUITY_CLASS_ORDER.map((ambiguityClass) => [
          ambiguityClass,
          exported.filter(
            (item) =>
              item.split === split &&
              item.state.ambiguityClasses.includes(ambiguityClass),
          ).length,
        ]),
      ),
    ]),
  );
  const candidateSetSizes: Record<string, number> = {};
  let textTruncations = 0;
  let candidateTruncations = 0;
  let anyTruncations = 0;
  const notDetectedCounts: Record<string, number> = {};
  const missingEvidenceBySplit = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => [
      split,
      {
        candidateCount: 0,
        missingCandidateCount: 0,
        sampleCount: 0,
        samplesWithMissingCandidatesCount: 0,
      },
    ]),
  ) as Record<
    System1Split,
    {
      candidateCount: number;
      missingCandidateCount: number;
      sampleCount: number;
      samplesWithMissingCandidatesCount: number;
    }
  >;
  for (const item of exported) {
    const count = String(item.state.candidateCount);
    candidateSetSizes[count] = (candidateSetSizes[count] ?? 0) + 1;
    if (item.state.textTruncated) textTruncations++;
    if (item.sample.truncated) candidateTruncations++;
    if (item.state.request.evidence.truncated) anyTruncations++;
    const candidateOptions = item.state.request.options.filter(
      (option) => option.kind === SemanticDecisionOptionKinds.CANDIDATE,
    );
    const missingCandidates = candidateOptions.filter(
      (option) =>
        option.attributes?.evidenceStatus === SYSTEM1_EVIDENCE_STATUSES.MISSING,
    ).length;
    const splitEvidence = missingEvidenceBySplit[item.split];
    splitEvidence.candidateCount += candidateOptions.length;
    splitEvidence.missingCandidateCount += missingCandidates;
    splitEvidence.sampleCount++;
    if (missingCandidates > 0)
      splitEvidence.samplesWithMissingCandidatesCount++;
    for (const ambiguityClass of item.state.notDetectedClasses)
      notDetectedCounts[ambiguityClass] =
        (notDetectedCounts[ambiguityClass] ?? 0) + 1;
  }
  const splitCounts = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => [split, files[split].count]),
  );
  const ambiguityCounts = Object.fromEntries(
    SYSTEM1_AMBIGUITY_CLASS_ORDER.map((ambiguityClass) => [
      ambiguityClass,
      exported.filter((item) =>
        item.state.ambiguityClasses.includes(ambiguityClass),
      ).length,
    ]),
  );
  const labelsBySplit = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => [
      split,
      exported.filter(
        (item) =>
          item.split === split &&
          item.sample.source.usage === SYSTEM1_USAGE.EVALUATION_ONLY &&
          (split === SYSTEM1_SPLITS.TRAIN ||
            split === SYSTEM1_SPLITS.CALIBRATION),
      ).length,
    ]),
  );
  if (Object.values(labelsBySplit).some((count) => count !== 0))
    throw new Error("Evaluation-only source reached a fitting partition");
  const excludedWithReason: Record<string, number> = {};
  for (const record of excluded)
    excludedWithReason[record.reason] =
      (excludedWithReason[record.reason] ?? 0) + 1;
  const missingEvidenceRates = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => {
      const stats = missingEvidenceBySplit[split];
      return [
        split,
        {
          ...stats,
          missingCandidateRate:
            stats.candidateCount === 0
              ? 0
              : stats.missingCandidateCount / stats.candidateCount,
          samplesWithMissingCandidatesRate:
            stats.sampleCount === 0
              ? 0
              : stats.samplesWithMissingCandidatesCount / stats.sampleCount,
        },
      ];
    }),
  );
  return {
    schemaVersion: SYSTEM1_EXPORT_SCHEMA_VERSION,
    sourceCorpus: {
      corpusId: manifest.corpusId,
      corpusVersion: manifest.corpusVersion,
      sampleCount: manifest.samples.length,
    },
    featureSchemaVersion: SYSTEM1_FEATURE_SCHEMA_VERSION,
    perSplitCounts: splitCounts,
    perAmbiguityClassCounts: ambiguityCounts,
    perSplitAmbiguityClassCounts: perSplitClassCounts,
    notDetectedAmbiguityClassCounts: notDetectedCounts,
    perSplitMissingEvidenceRates: missingEvidenceRates,
    candidateSetSizeDistribution: Object.fromEntries(
      Object.entries(candidateSetSizes).sort(
        ([left], [right]) => Number(left) - Number(right),
      ),
    ),
    truncationCounts: {
      anyEvidence: anyTruncations,
      stateText: textTruncations,
      tierACandidateSet: candidateTruncations,
    },
    excludedWithReason: Object.fromEntries(
      Object.entries(excludedWithReason).sort(([left], [right]) =>
        compareText(left, right),
      ),
    ),
    excludedFile: {
      name: SYSTEM1_FILE_NAMES.EXCLUDED,
      count: excluded.length,
      sha256: sha256(excludedText),
    },
    heldOutSeals: Object.fromEntries(
      Object.entries(seals).map(([split, text]) => [split, JSON.parse(text)]),
    ),
    evaluationOnlyFitLeakage: labelsBySplit,
    labelsReport: {
      name: SYSTEM1_FILE_NAMES.LABELS_REPORT,
      sha256: sha256(labelsReportText),
    },
    payloadSha256: payloadHash(files, seals, excludedText, labelsReportText),
  };
}

function labelsReportFor(
  exported: readonly ExportedSample[],
  labels: ReadonlyMap<string, System1LabelRecord>,
): Record<string, unknown> {
  const candidateMissesBySplit = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => [split, 0]),
  ) as Record<System1Split, number>;
  const missingnessBySplit = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => [
      split,
      {
        goldCandidateCount: 0,
        goldMissingEvidenceCount: 0,
        nonGoldCandidateCount: 0,
        nonGoldMissingEvidenceCount: 0,
      },
    ]),
  ) as Record<
    System1Split,
    {
      goldCandidateCount: number;
      goldMissingEvidenceCount: number;
      nonGoldCandidateCount: number;
      nonGoldMissingEvidenceCount: number;
    }
  >;
  for (const item of exported) {
    const requestId = item.state.request.requestId;
    const label = labels.get(requestId);
    if (!label) throw new Error(`Labels are missing for request ${requestId}`);
    if (label.candidateMiss) candidateMissesBySplit[item.split]++;
    const positiveTargets = new Set(label.positiveTargetIds);
    const stats = missingnessBySplit[item.split];
    for (const option of item.state.request.options) {
      if (option.kind !== SemanticDecisionOptionKinds.CANDIDATE) continue;
      const targetId = option.attributes?.targetId;
      if (typeof targetId !== "string") continue;
      const isGold = positiveTargets.has(targetId);
      const isMissing =
        option.attributes?.evidenceStatus === SYSTEM1_EVIDENCE_STATUSES.MISSING;
      if (isGold) {
        stats.goldCandidateCount++;
        if (isMissing) stats.goldMissingEvidenceCount++;
      } else {
        stats.nonGoldCandidateCount++;
        if (isMissing) stats.nonGoldMissingEvidenceCount++;
      }
    }
  }
  const missingnessRatesBySplit = Object.fromEntries(
    SYSTEM1_PARTITIONS.map((split) => {
      const stats = missingnessBySplit[split];
      return [
        split,
        {
          ...stats,
          goldMissingEvidenceRate:
            stats.goldCandidateCount === 0
              ? 0
              : stats.goldMissingEvidenceCount / stats.goldCandidateCount,
          nonGoldMissingEvidenceRate:
            stats.nonGoldCandidateCount === 0
              ? 0
              : stats.nonGoldMissingEvidenceCount / stats.nonGoldCandidateCount,
        },
      ];
    }),
  );
  return {
    schemaVersion: SYSTEM1_EXPORT_SCHEMA_VERSION,
    candidateMissCount: Object.values(candidateMissesBySplit).reduce(
      (total, count) => total + count,
      0,
    ),
    candidateMissCountBySplit: candidateMissesBySplit,
    missingEvidenceByGoldStatusAndSplit: missingnessRatesBySplit,
  };
}

function writeAtomic(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, contents, UTF8);
  renameSync(temporary, file);
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const manifest = parseManifest(args.manifest);
  const groups = splitGroups(
    manifest.samples,
    readSnapshotDescriptors(args.collectionReport),
  );
  const temporaryDirectory = mkdtempSync(
    path.join(os.tmpdir(), RUN_DIRECTORY_PREFIX),
  );
  const exported: ExportedSample[] = [];
  const excluded: System1ExcludedSample[] = [];
  try {
    for (const group of groups) {
      process.stderr.write(
        `[system1-export] ${group.repoId}@${group.revision}\n`,
      );
      const result = await processGroup(
        group,
        args.repositories,
        temporaryDirectory,
      );
      exported.push(...result.exported);
      excluded.push(...result.excluded);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  exported.sort((a, b) =>
    compareText(a.state.request.requestId, b.state.request.requestId),
  );
  const { files, labels } = splitOutput(exported);
  const seals = buildSeals(files);
  const excludedText = serializeSystem1Exclusions(excluded);
  const labelsReportText = `${JSON.stringify(
    labelsReportFor(exported, labels),
    null,
    2,
  )}${SYSTEM1_JSON_LINE_ENDING}`;
  const report = reportFor(
    manifest,
    exported,
    files,
    excluded,
    excludedText,
    seals,
    labelsReportText,
  );
  mkdirSync(args.output, { recursive: true });
  for (const split of SYSTEM1_PARTITIONS) {
    writeAtomic(
      path.join(args.output, SYSTEM1_FILE_NAMES.STATE(split)),
      files[split].stateText,
    );
    writeAtomic(
      path.join(args.output, SYSTEM1_FILE_NAMES.LABELS(split)),
      files[split].labelsText,
    );
  }
  for (const [split, contents] of Object.entries(seals))
    writeAtomic(
      path.join(args.output, SYSTEM1_FILE_NAMES.SEAL(split)),
      contents,
    );
  writeAtomic(
    path.join(args.output, SYSTEM1_FILE_NAMES.EXCLUDED),
    excludedText,
  );
  writeAtomic(
    path.join(args.output, SYSTEM1_FILE_NAMES.REPORT),
    `${JSON.stringify(report, null, 2)}${SYSTEM1_JSON_LINE_ENDING}`,
  );
  writeAtomic(
    path.join(args.output, SYSTEM1_FILE_NAMES.LABELS_REPORT),
    labelsReportText,
  );
  process.stdout.write(
    `${JSON.stringify({
      output: args.output,
      exported: exported.length,
      payloadSha256: report.payloadSha256,
    })}\n`,
  );
}

await main();
