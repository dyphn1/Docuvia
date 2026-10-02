/** Pool-first offline measurement of deterministic System-1 query routing. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  aggregateCommittedDuplicateGroups,
  type CommittedDuplicateGroup,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-independent-units.js";
import {
  calibrateSystem1Score as calibrateScore,
  clopperPearsonLowerBound,
  fitSystem1IsotonicCalibrator,
} from "../../lib/core/src/semantic/system1/eval/system1-eval-calibration.js";
import {
  materializeSnapshot,
  describeRevision,
  hashSnapshot,
  assertClean,
} from "./snapshot.mts";
import {
  assertMemoryHeadroom,
  freeMemoryPercent,
  startMemoryGuard,
} from "./memory-guard.mts";
import {
  resolveSystem1DeterministicQueries,
  System1QuerySourceIndex,
  type System1QueryId,
  type System1QueryState,
  type System1QueryResults,
} from "./system1-query-routing-rules.mts";
import { system1RequestId } from "../../lib/core/src/semantic/system1/system1-state-builder.js";

const ROOT_DIRECTORY = process.cwd();
const DATASET_DIRECTORY = path.join(
  ROOT_DIRECTORY,
  "evaluate/results/semantic-corpus/v1/system1-dataset-v2",
);
const CORPUS_MANIFEST = path.join(
  ROOT_DIRECTORY,
  "evaluate/results/semantic-corpus/v1/run-c/corpus-manifest.json",
);
const COLLECTION_REPORT = path.join(
  ROOT_DIRECTORY,
  "evaluate/results/semantic-corpus/v1/run-c/collection-report.json",
);
const P2_BASELINE_DIRECTORY = path.join(
  ROOT_DIRECTORY,
  "evaluate/results/semantic-corpus/v1/system1-eval/tierA-rank-prior/leave-one-family-out",
);
const OUTPUT_DIRECTORY = path.join(
  ROOT_DIRECTORY,
  "evaluate/results/semantic-corpus/v1/system1-query-routing-v1",
);
const REPOSITORIES_DIRECTORY = path.join(os.homedir(), "Desktop", "GitHub");
const MEMORY_FLOOR_PERCENT = 25;
const TARGET_PRECISION = 0.99;
const ONE_SIDED_ALPHA = 0.05;
const JSON_LINE_ENDING = "\n";
const KEY_SEPARATOR = "\0";
const UTF8 = "utf8";
const SHA256 = "sha256";
const POOL_SPLITS = ["train", "calibration"] as const;
const HELD_OUT_SPLITS = ["temporal", "test"] as const;
const QUERY_IDS: readonly System1QueryId[] = ["q1", "q2", "q3"];

type Split = (typeof POOL_SPLITS)[number] | (typeof HELD_OUT_SPLITS)[number];

interface LabelRecord {
  readonly requestId: string;
  readonly positiveTargetIds: readonly string[];
  readonly negativeTargetIds: readonly string[];
  readonly reviewStatus: string;
  readonly oracleStatus: string;
  readonly candidateMiss: boolean;
}

interface SnapshotDescriptor {
  readonly repoId: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly snapshotHash: string;
}

interface StateLabelPair {
  readonly split: Split;
  readonly state: System1QueryState & {
    readonly request: System1QueryState["request"] & {
      readonly evidence: System1QueryState["request"]["evidence"] & {
        readonly repoId: string;
        readonly worktreeId: string;
        readonly snapshotHash: string;
      };
    };
  };
  readonly label: LabelRecord;
  readonly duplicateGroup: string;
  readonly trusted: boolean;
  readonly candidateCount: number;
  readonly candidateTargetIds: readonly string[];
  readonly family: string;
}

interface RequestOutcome {
  readonly requestId: string;
  readonly split: Split;
  readonly family: string;
  readonly duplicateGroup: string;
  readonly trusted: boolean;
  readonly candidateMiss: boolean;
  readonly candidateCount: number;
  readonly candidateTargetIds: readonly string[];
  readonly positiveTargetIds: readonly string[];
  readonly ambiguityClasses: readonly string[];
  readonly queries: System1QueryResults;
  readonly baselineTargetIds: readonly string[];
  readonly effectiveTargetIds: readonly string[];
  readonly queryLatencyMs: number;
}

interface SnapshotGroup {
  readonly repoId: string;
  readonly revision: string;
  readonly snapshotHash: string;
  readonly descriptor: SnapshotDescriptor;
  readonly pairs: readonly StateLabelPair[];
}

interface P2Calibrators {
  readonly foldCalibrators: ReadonlyMap<
    string,
    Parameters<typeof calibrateScore>[0]
  >;
  readonly finalCalibrator: Parameters<typeof calibrateScore>[0];
}

interface MetricRow {
  readonly rows: number;
  readonly duplicateGroups: number;
  readonly committedRows: number;
  readonly exactRows: number;
  readonly rowCoverage: number | null;
  readonly rowExactSetPrecision: number | null;
  readonly rowPrecisionLowerBound: number | null;
  readonly committedDuplicateGroups: number;
  readonly exactDuplicateGroups: number;
  readonly duplicateGroupCoverage: number | null;
  readonly duplicateGroupExactSetPrecision: number | null;
  readonly duplicateGroupPrecisionLowerBound: number | null;
}

interface SplitSummary {
  readonly trustedRows: number;
  readonly trustedDuplicateGroups: number;
  readonly multiCandidateTrustedRows: number;
  readonly multiCandidateTrustedDuplicateGroups: number;
  readonly queries: Readonly<Record<System1QueryId | "cascade", MetricRow>>;
  readonly tierABaseline: MetricRow;
  readonly tierAPlusQueries: MetricRow;
  readonly conflictRows: number;
  readonly latency: {
    readonly allRequests: LatencySummary;
    readonly multiCandidateTrustedRequests: LatencySummary;
  };
  readonly byFamily: Readonly<Record<string, FamilyOrClassSummary>>;
  readonly byAmbiguityClass: Readonly<Record<string, FamilyOrClassSummary>>;
}

interface FamilyOrClassSummary {
  readonly eligibleRows: number;
  readonly eligibleDuplicateGroups: number;
  readonly queries: Readonly<Record<System1QueryId | "cascade", MetricRow>>;
}

interface LatencySummary {
  readonly requests: number;
  readonly totalMs: number;
  readonly meanMs: number | null;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
}

interface WrongCommit {
  readonly requestId: string;
  readonly split: Split;
  readonly family: string;
  readonly query:
    System1QueryId | "cascade" | "tierA-baseline" | "tierA-plus-queries";
  readonly predictedTargetIds: readonly string[];
  readonly positiveTargetIds: readonly string[];
  readonly reasonCategory: string;
  readonly proof?: string;
  readonly candidateMiss: boolean;
  readonly ambiguityClasses: readonly string[];
}

function sha256(value: string | Buffer): string {
  return createHash(SHA256).update(value).digest("hex");
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}${JSON_LINE_ENDING}`;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, UTF8)) as unknown;
}

function readJsonLines(filePath: string): unknown[] {
  return readFileSync(filePath, UTF8)
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function readSplitPairs(
  split: Split,
  duplicateGroups: ReadonlyMap<string, string>,
): StateLabelPair[] {
  const statePath = path.join(DATASET_DIRECTORY, `${split}-state.jsonl`);
  const labelPath = path.join(DATASET_DIRECTORY, `${split}-labels.jsonl`);
  const states = readJsonLines(statePath) as System1QueryState[];
  const labels = readJsonLines(labelPath) as LabelRecord[];
  const labelsByRequestId = new Map(
    labels.map((label) => [label.requestId, label] as const),
  );
  if (labelsByRequestId.size !== labels.length)
    throw new Error(`Duplicate labels in ${split} split.`);
  if (labelsByRequestId.size !== states.length)
    throw new Error(`State/label count mismatch in ${split} split.`);
  return states.map((state) => {
    const requestId = state.request.requestId;
    const label = labelsByRequestId.get(requestId);
    if (!label) throw new Error(`Missing ${split} label for ${requestId}.`);
    const duplicateGroup = duplicateGroups.get(requestId);
    if (!duplicateGroup)
      throw new Error(`Missing ${split} duplicate group for ${requestId}.`);
    const evidence = state.request.evidence as typeof state.request.evidence & {
      readonly repoId: string;
      readonly worktreeId: string;
      readonly snapshotHash: string;
    };
    const candidates = state.request.options.filter(
      (option) => option.kind === "candidate",
    );
    const candidateTargetIds = candidates.flatMap((option) => {
      const targetId = option.attributes?.targetId;
      return typeof targetId === "string" ? [targetId] : [];
    });
    return {
      split,
      state: state as StateLabelPair["state"],
      label,
      duplicateGroup,
      trusted: isTrustedLabel(label),
      candidateCount: candidates.length,
      candidateTargetIds,
      family: repositoryFamily(evidence.repoId),
    };
  });
}

function isTrustedLabel(label: LabelRecord): boolean {
  return (
    label.reviewStatus === "confirmed" &&
    label.oracleStatus === "resolved" &&
    Array.isArray(label.positiveTargetIds) &&
    Array.isArray(label.negativeTargetIds) &&
    !label.positiveTargetIds.some((target) =>
      label.negativeTargetIds.includes(target),
    )
  );
}

function repositoryFamily(repoId: string): string {
  let normalized = repoId.trim();
  if (normalized.startsWith("https://")) normalized = normalized.slice(8);
  else if (normalized.startsWith("http://")) normalized = normalized.slice(7);
  if (normalized.startsWith("git@")) normalized = normalized.slice(4);
  normalized = normalized.replace(":", "/").replace(/\.git$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2)
    throw new Error(`Invalid repository identity: ${repoId}`);
  return parts.slice(-2).join("/");
}

function skipWhitespace(text: string, offset: number): number {
  let cursor = offset;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function jsonValueEnd(text: string, start: number): number {
  if (text[start] === '"') {
    let cursor = start + 1;
    while (cursor < text.length) {
      if (text[cursor] === "\\") cursor += 2;
      else if (text[cursor] === '"') return cursor + 1;
      else cursor += 1;
    }
    throw new Error("Unterminated JSON string in corpus manifest.");
  }
  if (text[start] === "{" || text[start] === "[") {
    const stack = [text[start] === "{" ? "}" : "]"];
    let cursor = start + 1;
    while (cursor < text.length && stack.length > 0) {
      const character = text[cursor];
      if (character === '"') {
        cursor = jsonValueEnd(text, cursor);
        continue;
      }
      if (character === "{") stack.push("}");
      else if (character === "[") stack.push("]");
      else if (character === stack[stack.length - 1]) stack.pop();
      cursor += 1;
    }
    if (stack.length > 0) throw new Error("Unbalanced corpus manifest JSON.");
    return cursor;
  }
  let cursor = start;
  while (cursor < text.length && !/[\s,}\]]/.test(text[cursor])) cursor += 1;
  return cursor;
}

function objectFieldRanges(
  text: string,
  start: number,
): ReadonlyMap<string, { readonly start: number; readonly end: number }> {
  if (text[start] !== "{") throw new Error("Expected JSON object.");
  const fields = new Map<
    string,
    { readonly start: number; readonly end: number }
  >();
  let cursor = skipWhitespace(text, start + 1);
  while (cursor < text.length && text[cursor] !== "}") {
    const keyEnd = jsonValueEnd(text, cursor);
    const key = JSON.parse(text.slice(cursor, keyEnd)) as unknown;
    if (typeof key !== "string") throw new Error("Invalid JSON object key.");
    cursor = skipWhitespace(text, keyEnd);
    if (text[cursor] !== ":")
      throw new Error("Malformed corpus manifest object.");
    const valueStart = skipWhitespace(text, cursor + 1);
    const valueEnd = jsonValueEnd(text, valueStart);
    fields.set(key, { start: valueStart, end: valueEnd });
    cursor = skipWhitespace(text, valueEnd);
    if (text[cursor] === ",") cursor = skipWhitespace(text, cursor + 1);
    else if (text[cursor] !== "}")
      throw new Error("Malformed corpus manifest object separator.");
  }
  return fields;
}

/** Reads identity/split/group metadata only; held-out gold fields are never parsed. */
function readDuplicateGroups(
  manifestPath: string,
  includedSplits: ReadonlySet<Split>,
): ReadonlyMap<string, string> {
  const contents = readFileSync(manifestPath, UTF8);
  const rootFields = objectFieldRanges(contents, skipWhitespace(contents, 0));
  const samplesRange = rootFields.get("samples");
  if (!samplesRange || contents[samplesRange.start] !== "[")
    throw new Error("Corpus manifest has no samples array.");
  const duplicateGroups = new Map<string, string>();
  let cursor = skipWhitespace(contents, samplesRange.start + 1);
  while (cursor < samplesRange.end && contents[cursor] !== "]") {
    const sampleEnd = jsonValueEnd(contents, cursor);
    const sampleFields = objectFieldRanges(contents, cursor);
    const sampleIdRange = sampleFields.get("sampleId");
    const sourceRange = sampleFields.get("source");
    if (!sampleIdRange || !sourceRange)
      throw new Error("Corpus sample is missing identity or source metadata.");
    const sampleId = JSON.parse(
      contents.slice(sampleIdRange.start, sampleIdRange.end),
    ) as unknown;
    const sourceFields = objectFieldRanges(contents, sourceRange.start);
    const splitRange = sourceFields.get("split");
    if (!splitRange) throw new Error("Corpus source has no split.");
    const split = JSON.parse(
      contents.slice(splitRange.start, splitRange.end),
    ) as unknown;
    if (typeof sampleId !== "string" || typeof split !== "string")
      throw new Error("Corpus sample identity or split is invalid.");
    if (includedSplits.has(split as Split)) {
      const duplicateRange = sourceFields.get("duplicateGroup");
      if (!duplicateRange)
        throw new Error(`No duplicate group for ${sampleId}.`);
      const duplicateGroup = JSON.parse(
        contents.slice(duplicateRange.start, duplicateRange.end),
      ) as unknown;
      if (typeof duplicateGroup !== "string" || duplicateGroup.length === 0)
        throw new Error(`Invalid duplicate group for ${sampleId}.`);
      const requestId = system1RequestId(sampleId);
      if (duplicateGroups.has(requestId))
        throw new Error(`Duplicate manifest request id ${requestId}.`);
      duplicateGroups.set(requestId, duplicateGroup);
    }
    cursor = skipWhitespace(contents, sampleEnd);
    if (contents[cursor] === ",") cursor = skipWhitespace(contents, cursor + 1);
    else if (contents[cursor] !== "]")
      throw new Error("Malformed corpus manifest samples array.");
  }
  return duplicateGroups;
}

function readSnapshotDescriptors(): readonly SnapshotDescriptor[] {
  const value = readJson(COLLECTION_REPORT) as {
    readonly snapshots?: readonly SnapshotDescriptor[];
  };
  if (!Array.isArray(value.snapshots))
    throw new Error("Collection report has no snapshot descriptors.");
  return value.snapshots;
}

function groupBySnapshot(pairs: readonly StateLabelPair[]): SnapshotGroup[] {
  const descriptors = new Map(
    readSnapshotDescriptors().map(
      (descriptor) =>
        [
          `${descriptor.repoId}${KEY_SEPARATOR}${descriptor.revision}${KEY_SEPARATOR}${descriptor.snapshotHash}`,
          descriptor,
        ] as const,
    ),
  );
  const groups = new Map<string, StateLabelPair[]>();
  for (const pair of pairs) {
    const evidence = pair.state.request.evidence;
    const key = `${evidence.repoId}${KEY_SEPARATOR}${evidence.worktreeId}${KEY_SEPARATOR}${evidence.snapshotHash}`;
    const members = groups.get(key) ?? [];
    members.push(pair);
    groups.set(key, members);
  }
  return [...groups.entries()]
    .map(([key, members]) => {
      const evidence = members[0].state.request.evidence;
      const descriptor = descriptors.get(key);
      if (!descriptor)
        throw new Error(
          `No source snapshot descriptor for ${evidence.repoId}@${evidence.worktreeId}.`,
        );
      if (
        members.some(
          ({ state }) =>
            state.request.evidence.repoId !== descriptor.repoId ||
            state.request.evidence.worktreeId !== descriptor.revision ||
            state.request.evidence.snapshotHash !== descriptor.snapshotHash,
        )
      )
        throw new Error(`Inconsistent snapshot group ${key}.`);
      return {
        repoId: descriptor.repoId,
        revision: descriptor.revision,
        snapshotHash: descriptor.snapshotHash,
        descriptor,
        pairs: members,
      };
    })
    .sort((left, right) => {
      const leftKey = `${left.repoId}${KEY_SEPARATOR}${left.revision}`;
      const rightKey = `${right.repoId}${KEY_SEPARATOR}${right.revision}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

function sourceRepositoryPath(repoId: string): string {
  const repositoryName = repoId.split("/").at(-1);
  if (!repositoryName)
    throw new Error(`Invalid repository identity: ${repoId}`);
  const match = readdirSync(REPOSITORIES_DIRECTORY, {
    withFileTypes: true,
  }).find(
    (entry) =>
      entry.isDirectory() &&
      entry.name.toLocaleLowerCase("en-US") ===
        repositoryName.toLocaleLowerCase("en-US"),
  );
  if (!match) throw new Error(`Local source clone not found for ${repoId}.`);
  const repositoryPath = path.join(REPOSITORIES_DIRECTORY, match.name);
  if (!existsSync(path.join(repositoryPath, ".git")))
    throw new Error(`Local clone has no Git metadata: ${repositoryPath}`);
  return repositoryPath;
}

function readP2Baseline(split: Split): {
  readonly policy: Record<string, unknown>;
  readonly responses: ReadonlyMap<string, Record<string, unknown>>;
  readonly policySha256: string;
  readonly responseSha256: string;
} {
  const policyPath = path.join(P2_BASELINE_DIRECTORY, "policy.json");
  const policyBytes = readFileSync(policyPath);
  const policySha256 = sha256(policyBytes);
  const expectedHash = readFileSync(
    path.join(P2_BASELINE_DIRECTORY, "policy.sha256"),
    UTF8,
  ).trim();
  if (policySha256 !== expectedHash)
    throw new Error(
      "Saved Tier A LOFO policy hash does not match policy.json.",
    );
  const policy = JSON.parse(policyBytes.toString(UTF8)) as Record<
    string,
    unknown
  >;
  const responsePath = path.join(
    P2_BASELINE_DIRECTORY,
    `${split}-responses.jsonl`,
  );
  const responseBytes = readFileSync(responsePath);
  const responses = new Map<string, Record<string, unknown>>();
  for (const response of responseBytes
    .toString(UTF8)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)) {
    if (typeof response.requestId !== "string")
      throw new Error(`Response has no request id in ${split}.`);
    if (responses.has(response.requestId))
      throw new Error(`Duplicate Tier A response for ${response.requestId}.`);
    responses.set(response.requestId, response);
  }
  return {
    policy,
    responses,
    policySha256,
    responseSha256: sha256(responseBytes),
  };
}

function buildP2Calibrators(
  poolPairs: readonly StateLabelPair[],
  poolBaselines: ReadonlyMap<Split, ReturnType<typeof readP2Baseline>>,
): P2Calibrators {
  const examples = poolPairs.map((pair) => {
    const baseline = poolBaselines.get(pair.split);
    if (!baseline)
      throw new Error(`Missing saved Tier A baseline for ${pair.split}.`);
    const response = baseline.responses.get(pair.state.request.requestId);
    if (!response)
      throw new Error(
        `Missing saved Tier A response for ${pair.state.request.requestId}.`,
      );
    if (response.requestId !== pair.state.request.requestId)
      throw new Error(
        `Tier A response id mismatch for ${pair.state.request.requestId}.`,
      );
    if (response.foldFamily !== pair.family)
      throw new Error(
        `Tier A OOF fold mismatch for ${pair.state.request.requestId}: ${String(response.foldFamily)}.`,
      );
    const scores = response.scores as Record<string, unknown> | undefined;
    const observations =
      pair.trusted &&
      !pair.label.candidateMiss &&
      response.status === "ok" &&
      pair.label.positiveTargetIds.length > 0
        ? pair.state.request.options.flatMap((option) => {
            if (option.kind !== "candidate") return [];
            const targetId = option.attributes?.targetId;
            const score = scores?.[option.id];
            return typeof targetId === "string" &&
              typeof score === "number" &&
              Number.isFinite(score) &&
              score >= 0 &&
              score <= 1
              ? [
                  {
                    score,
                    positive: pair.label.positiveTargetIds.includes(targetId),
                  },
                ]
              : [];
          })
        : [];
    return { family: pair.family, observations };
  });

  const policy = poolBaselines.get("train")?.policy;
  if (!policy) throw new Error("Missing train Tier A policy.");
  const foldSummaries = policy.foldCalibrationSummaries as
    readonly Record<string, unknown>[] | undefined;
  if (!foldSummaries?.length)
    throw new Error("Saved Tier A policy has no LOFO calibration summaries.");
  const foldCalibrators = new Map<
    string,
    Parameters<typeof calibrateScore>[0]
  >();
  for (const summary of foldSummaries) {
    if (
      typeof summary.foldFamily !== "string" ||
      typeof summary.calibrationSha256 !== "string"
    )
      throw new Error("Malformed Tier A fold calibration summary.");
    const observations = examples
      .filter((example) => example.family !== summary.foldFamily)
      .flatMap((example) => example.observations);
    const calibrator = fitSystem1IsotonicCalibrator(observations);
    if (
      calibrator.observationCount !== summary.observationCount ||
      sha256(JSON.stringify(calibrator)) !== summary.calibrationSha256
    )
      throw new Error(
        `Recomputed Tier A fold calibrator does not match ${summary.foldFamily}.`,
      );
    foldCalibrators.set(summary.foldFamily, calibrator);
  }
  const allObservations = examples.flatMap((example) => example.observations);
  const finalCalibrator = fitSystem1IsotonicCalibrator(allObservations);
  const expectedFinalCalibrator = policy.calibrator as Parameters<
    typeof calibrateScore
  >[0];
  if (
    sha256(JSON.stringify(finalCalibrator)) !==
    sha256(JSON.stringify(expectedFinalCalibrator))
  )
    throw new Error(
      "Recomputed final Tier A calibrator does not match policy.",
    );
  return { foldCalibrators, finalCalibrator };
}

function baselineTargets(
  pair: StateLabelPair,
  policy: Readonly<Record<string, unknown>>,
  responses: ReadonlyMap<string, Record<string, unknown>>,
  calibrators: P2Calibrators,
): readonly string[] {
  const precisionTargets = policy.precisionTargets as
    readonly Record<string, unknown>[] | undefined;
  const certified = precisionTargets?.find(
    (target) => target.targetPrecision === TARGET_PRECISION,
  );
  if (
    !certified ||
    certified.status !== "certified" ||
    typeof certified.threshold !== "number"
  )
    return [];
  const response = responses.get(pair.state.request.requestId);
  if (!response)
    throw new Error(
      `Missing saved Tier A response for ${pair.state.request.requestId}.`,
    );
  if (response.status !== "ok") return [];
  const evidence = pair.state.request
    .evidence as typeof pair.state.request.evidence & {
    readonly repoId: string;
  };
  if (response.requestId !== pair.state.request.requestId)
    throw new Error(
      `Tier A response id mismatch for ${pair.state.request.requestId}.`,
    );
  const isPoolSplit = pair.split === "train" || pair.split === "calibration";
  if (isPoolSplit && response.foldFamily !== repositoryFamily(evidence.repoId))
    throw new Error(
      `Tier A OOF fold mismatch for ${pair.state.request.requestId}.`,
    );
  const calibrator = isPoolSplit
    ? calibrators.foldCalibrators.get(pair.family)
    : calibrators.finalCalibrator;
  if (!calibrator)
    throw new Error(
      `Missing Tier A calibrator for ${pair.split}/${pair.family}.`,
    );
  const scores = response.scores as Record<string, unknown> | undefined;
  if (!scores) return [];
  return pair.state.request.options.flatMap((option) => {
    if (option.kind !== "candidate") return [];
    const targetId = option.attributes?.targetId;
    const score = scores[option.id];
    if (
      typeof targetId !== "string" ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1
    )
      return [];
    return calibrateScore(calibrator, score) >= certified.threshold
      ? [targetId]
      : [];
  });
}

function equalTargetSets(
  predicted: readonly string[],
  gold: readonly string[],
): boolean {
  const predictedSet = new Set(predicted);
  const goldSet = new Set(gold);
  return (
    predictedSet.size === goldSet.size &&
    [...predictedSet].every((target) => goldSet.has(target))
  );
}

function targetIdsForQuery(
  outcome: RequestOutcome,
  query: System1QueryId | "cascade",
): readonly string[] | null {
  const result =
    query === "cascade" ? outcome.queries.cascade : outcome.queries[query];
  return result.status === "commit" ? [result.targetId] : null;
}

function aggregateMetric(
  rows: readonly RequestOutcome[],
  targetsFor: (row: RequestOutcome) => readonly string[] | null,
): MetricRow {
  const committed = rows.filter((row) => (targetsFor(row)?.length ?? 0) > 0);
  const exactRows = committed.filter((row) =>
    equalTargetSets(targetsFor(row) ?? [], row.positiveTargetIds),
  );
  const groups: readonly CommittedDuplicateGroup<RequestOutcome>[] =
    aggregateCommittedDuplicateGroups(rows, {
      duplicateGroup: (row) => row.duplicateGroup,
      committed: (row) => (targetsFor(row)?.length ?? 0) > 0,
      exact: (row) =>
        equalTargetSets(targetsFor(row) ?? [], row.positiveTargetIds),
    });
  const exactGroups = groups.filter((group) => group.exact);
  const duplicateGroups = new Set(rows.map((row) => row.duplicateGroup)).size;
  return {
    rows: rows.length,
    duplicateGroups,
    committedRows: committed.length,
    exactRows: exactRows.length,
    rowCoverage: rows.length ? committed.length / rows.length : null,
    rowExactSetPrecision: committed.length
      ? exactRows.length / committed.length
      : null,
    rowPrecisionLowerBound: committed.length
      ? clopperPearsonLowerBound(
          exactRows.length,
          committed.length,
          ONE_SIDED_ALPHA,
        )
      : null,
    committedDuplicateGroups: groups.length,
    exactDuplicateGroups: exactGroups.length,
    duplicateGroupCoverage: duplicateGroups
      ? groups.length / duplicateGroups
      : null,
    duplicateGroupExactSetPrecision: groups.length
      ? exactGroups.length / groups.length
      : null,
    duplicateGroupPrecisionLowerBound: groups.length
      ? clopperPearsonLowerBound(
          exactGroups.length,
          groups.length,
          ONE_SIDED_ALPHA,
        )
      : null,
  };
}

function latencySummary(rows: readonly RequestOutcome[]): LatencySummary {
  const values = rows
    .map(({ queryLatencyMs }) => queryLatencyMs)
    .sort((a, b) => a - b);
  const percentile = (fraction: number): number | null =>
    values.length
      ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)]
      : null;
  const totalMs = values.reduce((sum, value) => sum + value, 0);
  return {
    requests: values.length,
    totalMs,
    meanMs: values.length ? totalMs / values.length : null,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: values.length ? values[values.length - 1] : null,
  };
}

function queryMetrics(
  rows: readonly RequestOutcome[],
): Readonly<Record<System1QueryId | "cascade", MetricRow>> {
  return {
    q1: aggregateMetric(rows, (row) => targetIdsForQuery(row, "q1")),
    q2: aggregateMetric(rows, (row) => targetIdsForQuery(row, "q2")),
    q3: aggregateMetric(rows, (row) => targetIdsForQuery(row, "q3")),
    cascade: aggregateMetric(rows, (row) => targetIdsForQuery(row, "cascade")),
  };
}

function summarizeSubgroups(
  rows: readonly RequestOutcome[],
  keyFor: (row: RequestOutcome) => readonly string[],
): Readonly<Record<string, FamilyOrClassSummary>> {
  const groups = new Map<string, RequestOutcome[]>();
  for (const row of rows) {
    for (const key of keyFor(row)) {
      const members = groups.get(key) ?? [];
      members.push(row);
      groups.set(key, members);
    }
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, members]) => [
        key,
        {
          eligibleRows: members.length,
          eligibleDuplicateGroups: new Set(
            members.map((row) => row.duplicateGroup),
          ).size,
          queries: queryMetrics(members),
        },
      ]),
  );
}

function summarizeSplit(rows: readonly RequestOutcome[]): SplitSummary {
  const trusted = rows.filter((row) => row.trusted);
  const eligible = trusted.filter((row) => row.candidateCount >= 2);
  const baselineTargets = (row: RequestOutcome): readonly string[] | null =>
    row.baselineTargetIds.length ? row.baselineTargetIds : null;
  const totalTargets = (row: RequestOutcome): readonly string[] | null =>
    row.baselineTargetIds.length
      ? row.baselineTargetIds
      : targetIdsForQuery(row, "cascade");
  const baselineMetrics = aggregateMetric(trusted, baselineTargets);
  const totalMetrics = aggregateMetric(trusted, totalTargets);
  const conflicts = eligible.filter(
    (row) => row.queries.cascade.reason === "query-conflict",
  ).length;
  return {
    trustedRows: trusted.length,
    trustedDuplicateGroups: new Set(trusted.map((row) => row.duplicateGroup))
      .size,
    multiCandidateTrustedRows: eligible.length,
    multiCandidateTrustedDuplicateGroups: new Set(
      eligible.map((row) => row.duplicateGroup),
    ).size,
    queries: queryMetrics(eligible),
    tierABaseline: baselineMetrics,
    tierAPlusQueries: totalMetrics,
    conflictRows: conflicts,
    latency: {
      allRequests: latencySummary(rows),
      multiCandidateTrustedRequests: latencySummary(eligible),
    },
    byFamily: summarizeSubgroups(eligible, (row) => [row.family]),
    byAmbiguityClass: summarizeSubgroups(eligible, (row) =>
      row.ambiguityClasses.length > 0 ? row.ambiguityClasses : ["(none)"],
    ),
  };
}

function wrongReason(
  query: System1QueryId | "cascade" | "tierA-baseline" | "tierA-plus-queries",
  candidateMiss: boolean,
  proof?: string,
): string {
  if (candidateMiss) return "tier-a-candidate-miss";
  if (query === "q1") return "import-source-symbol-not-gold";
  if (query === "q2") return "reexport-chain-symbol-not-gold";
  if (query === "q3") return "receiver-type-does-not-match-gold-dispatch";
  if (query === "tierA-baseline") return "tier-a-accepted-set-not-gold";
  if (query === "tierA-plus-queries") return "combined-accepted-set-not-gold";
  return proof ? `cascade-${proof}-not-gold` : "cascade-target-not-gold";
}

function sameTargetsIgnoringSourceLine(
  predicted: readonly string[],
  gold: readonly string[],
): boolean {
  const withoutLine = (target: string): string => target.replace(/@L\d+$/, "");
  return equalTargetSets(predicted.map(withoutLine), gold.map(withoutLine));
}

function collectWrongCommits(rows: readonly RequestOutcome[]): WrongCommit[] {
  const wrong: WrongCommit[] = [];
  for (const row of rows) {
    if (!row.trusted) continue;
    const candidates: readonly {
      readonly query: WrongCommit["query"];
      readonly targets: readonly string[];
      readonly proof?: string;
    }[] = [
      ...QUERY_IDS.flatMap((query) => {
        const result = row.queries[query];
        return result.status === "commit"
          ? [{ query, targets: [result.targetId], proof: result.proof }]
          : [];
      }),
      ...(row.queries.cascade.status === "commit"
        ? [
            {
              query: "cascade" as const,
              targets: [row.queries.cascade.targetId],
              proof: row.queries.cascade.winningQueries.join("+"),
            },
          ]
        : []),
      ...(row.baselineTargetIds.length
        ? [
            {
              query: "tierA-baseline" as const,
              targets: row.baselineTargetIds,
            },
          ]
        : []),
      ...(row.effectiveTargetIds.length
        ? [
            {
              query: "tierA-plus-queries" as const,
              targets: row.effectiveTargetIds,
            },
          ]
        : []),
    ];
    for (const candidate of candidates) {
      if (equalTargetSets(candidate.targets, row.positiveTargetIds)) continue;
      wrong.push({
        requestId: row.requestId,
        split: row.split,
        family: row.family,
        query: candidate.query,
        predictedTargetIds: candidate.targets,
        positiveTargetIds: row.positiveTargetIds,
        reasonCategory: row.candidateMiss
          ? "tier-a-candidate-miss"
          : sameTargetsIgnoringSourceLine(
                candidate.targets,
                row.positiveTargetIds,
              )
            ? "target-id-source-line-annotation-mismatch"
            : wrongReason(candidate.query, row.candidateMiss, candidate.proof),
        ...(candidate.proof ? { proof: candidate.proof } : {}),
        candidateMiss: row.candidateMiss,
        ambiguityClasses: row.ambiguityClasses,
      });
    }
  }
  return wrong;
}

function makeOutcome(
  pair: StateLabelPair,
  queries: System1QueryResults,
  baselineTargetIds: readonly string[],
  queryLatencyMs: number,
): RequestOutcome {
  const stateWithClasses = pair.state as typeof pair.state & {
    readonly ambiguityClasses?: readonly string[];
  };
  const cascadeTargets =
    queries.cascade.status === "commit" ? [queries.cascade.targetId] : [];
  const effectiveTargetIds = baselineTargetIds.length
    ? baselineTargetIds
    : cascadeTargets;
  return {
    requestId: pair.state.request.requestId,
    split: pair.split,
    family: pair.family,
    duplicateGroup: pair.duplicateGroup,
    trusted: pair.trusted,
    candidateMiss: pair.label.candidateMiss,
    candidateCount: pair.candidateCount,
    candidateTargetIds: pair.candidateTargetIds,
    positiveTargetIds: pair.label.positiveTargetIds,
    ambiguityClasses: stateWithClasses.ambiguityClasses ?? [],
    queries,
    baselineTargetIds,
    effectiveTargetIds,
    queryLatencyMs,
  };
}

function readHeldOutSeal(split: "temporal" | "test"): {
  readonly stateSha256: string;
  readonly labelsSha256: string;
  readonly count: number;
} {
  const seal = readJson(path.join(DATASET_DIRECTORY, `${split}-seal.json`)) as {
    readonly stateSha256?: string;
    readonly labelsSha256?: string;
    readonly count?: number;
  };
  if (
    typeof seal.stateSha256 !== "string" ||
    typeof seal.labelsSha256 !== "string" ||
    typeof seal.count !== "number"
  )
    throw new Error(`Invalid ${split} regression seal.`);
  return {
    stateSha256: seal.stateSha256,
    labelsSha256: seal.labelsSha256,
    count: seal.count,
  };
}

function verifyHeldOutSeals(): Readonly<Record<string, unknown>> {
  const verified: Record<string, unknown> = {};
  for (const split of HELD_OUT_SPLITS) {
    const statePath = path.join(DATASET_DIRECTORY, `${split}-state.jsonl`);
    const labelPath = path.join(DATASET_DIRECTORY, `${split}-labels.jsonl`);
    const seal = readHeldOutSeal(split);
    const actualStateHash = sha256(readFileSync(statePath));
    const actualLabelHash = sha256(readFileSync(labelPath));
    const count = readFileSync(statePath, UTF8)
      .split(/\r?\n/)
      .filter(Boolean).length;
    if (
      seal.stateSha256 !== actualStateHash ||
      seal.labelsSha256 !== actualLabelHash ||
      seal.count !== count
    )
      throw new Error(`${split} held-out regression input seal mismatch.`);
    verified[split] = {
      stateSha256: actualStateHash,
      labelsSha256: actualLabelHash,
      count,
      sealVerified: true,
    };
  }
  return verified;
}

function processSnapshotGroups(
  groups: readonly SnapshotGroup[],
  policyAndResponses: ReadonlyMap<Split, ReturnType<typeof readP2Baseline>>,
  calibrators: P2Calibrators,
  frozenRuleSourceSha256: string,
): {
  readonly outcomes: readonly RequestOutcome[];
  readonly verifiedSnapshots: readonly Record<string, unknown>[];
  readonly minimumObservedFreeMemoryPercent: number;
} {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), "docuvia-system1-query-routing-"),
  );
  const output: RequestOutcome[] = [];
  const verifiedSnapshots: Record<string, unknown>[] = [];
  let minimumObservedFreeMemoryPercent = 100;
  let breached: Error | undefined;
  const guard = startMemoryGuard(MEMORY_FLOOR_PERCENT, (error) => {
    breached = error;
  });
  const sampleMemory = (): void => {
    const free = freeMemoryPercent();
    minimumObservedFreeMemoryPercent = Math.min(
      minimumObservedFreeMemoryPercent,
      free,
    );
    if (free < MEMORY_FLOOR_PERCENT)
      throw new Error(`System memory floor breached at ${free}%.`);
    if (breached) throw breached;
    assertMemoryHeadroom(MEMORY_FLOOR_PERCENT);
  };
  try {
    sampleMemory();
    let processed = 0;
    for (const group of groups) {
      sampleMemory();
      const snapshotDirectory = path.join(
        temporaryRoot,
        sha256(
          `${group.repoId}${KEY_SEPARATOR}${group.revision}${KEY_SEPARATOR}${group.snapshotHash}`,
        ).slice(0, 20),
      );
      try {
        const sourceDirectory = sourceRepositoryPath(group.repoId);
        const revision = describeRevision(sourceDirectory, group.revision);
        materializeSnapshot(
          sourceDirectory,
          revision.revision,
          group.descriptor.subtree,
          snapshotDirectory,
        );
        const snapshot = hashSnapshot(snapshotDirectory);
        assertClean(snapshotDirectory);
        if (snapshot.hash !== group.snapshotHash)
          throw new Error(
            `Snapshot hash mismatch for ${group.repoId}@${group.revision}: ${snapshot.hash}`,
          );
        const sourceIndex = new System1QuerySourceIndex(
          snapshotDirectory,
          new Set(snapshot.files.keys()),
        );
        for (const pair of group.pairs) {
          const start = performance.now();
          const queryResults = resolveSystem1DeterministicQueries(
            pair.state,
            sourceIndex,
          );
          const queryLatencyMs = performance.now() - start;
          const baseline = policyAndResponses.get(pair.split);
          if (!baseline)
            throw new Error(`Missing saved Tier A baseline for ${pair.split}.`);
          const baselineTargetIds = baselineTargets(
            pair,
            baseline.policy,
            baseline.responses,
            calibrators,
          );
          output.push(
            makeOutcome(pair, queryResults, baselineTargetIds, queryLatencyMs),
          );
          processed += 1;
          if (processed % 128 === 0) sampleMemory();
        }
        sampleMemory();
        verifiedSnapshots.push({
          repoId: group.repoId,
          revision: group.revision,
          sourceSnapshotHash: group.snapshotHash,
          materializedSnapshotHash: snapshot.hash,
          subtree: group.descriptor.subtree,
          requests: group.pairs.length,
          temporarySnapshotDeletedAfterProcessing: true,
          frozenRuleSourceSha256,
        });
      } finally {
        rmSync(snapshotDirectory, { recursive: true, force: true });
      }
    }
    return {
      outcomes: output,
      verifiedSnapshots,
      minimumObservedFreeMemoryPercent,
    };
  } finally {
    guard.stop();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function splitRows(
  outcomes: readonly RequestOutcome[],
  split: Split,
): readonly RequestOutcome[] {
  return outcomes.filter((row) => row.split === split);
}

function makeStageSummary(
  outcomes: readonly RequestOutcome[],
): Readonly<Record<string, unknown>> {
  const bySplit: Record<string, SplitSummary> = {};
  for (const split of [...POOL_SPLITS, ...HELD_OUT_SPLITS]) {
    const rows = splitRows(outcomes, split);
    if (rows.length > 0) bySplit[split] = summarizeSplit(rows);
  }
  const poolRows = outcomes.filter((row) =>
    (POOL_SPLITS as readonly string[]).includes(row.split),
  );
  const heldOutRows = outcomes.filter((row) =>
    (HELD_OUT_SPLITS as readonly string[]).includes(row.split),
  );
  return {
    pool: poolRows.length ? summarizeSplit(poolRows) : null,
    heldOutCombined: heldOutRows.length ? summarizeSplit(heldOutRows) : null,
    bySplit,
    wrongCommits: collectWrongCommits(outcomes),
  };
}

function parseStageArguments(): {
  readonly stage: "pool" | "held-out" | "finalize";
  readonly expectedRuleHash: string | null;
} {
  const args = process.argv.slice(2);
  const stageIndex = args.indexOf("--stage");
  const hashIndex = args.indexOf("--expected-rules-sha256");
  const stage = stageIndex >= 0 ? args[stageIndex + 1] : null;
  const expectedRuleHash = hashIndex >= 0 ? args[hashIndex + 1] : null;
  if (
    (stage !== "pool" && stage !== "held-out" && stage !== "finalize") ||
    args.some(
      (arg, index) =>
        !["--stage", "--expected-rules-sha256"].includes(arg) &&
        index !== stageIndex + 1 &&
        index !== hashIndex + 1,
    )
  )
    throw new Error(
      "Usage: node --max-old-space-size=4096 --import tsx scripts/semantic-corpus/system1-query-routing.mts --stage <pool|held-out|finalize> [--expected-rules-sha256 <sha256>]",
    );
  if (stage !== "pool" && !expectedRuleHash)
    throw new Error(
      "held-out and finalize stages require --expected-rules-sha256.",
    );
  return { stage, expectedRuleHash };
}

function currentRuleSourceHash(): string {
  return sha256(
    readFileSync(
      path.join(
        ROOT_DIRECTORY,
        "scripts/semantic-corpus/system1-query-routing-rules.mts",
      ),
    ),
  );
}

function writeStageOutput(
  outputFile: string,
  stage: "pool" | "held-out",
  results: ReturnType<typeof processSnapshotGroups>,
  baseline: ReturnType<typeof readP2Baseline>,
  ruleHash: string,
  sealMetadata: Readonly<Record<string, unknown>> | null,
  inputHashes: Readonly<Record<string, string>>,
): void {
  const summary = makeStageSummary(results.outcomes);
  const payload = {
    schemaVersion: 1,
    stage,
    datasetDirectory: path.relative(ROOT_DIRECTORY, DATASET_DIRECTORY),
    frozenRuleSourceSha256: ruleHash,
    tierABaseline: {
      scorerId: "tierA-rank-prior",
      sourceDirectory: path.relative(ROOT_DIRECTORY, P2_BASELINE_DIRECTORY),
      policySha256: baseline.policySha256,
      precisionTarget: TARGET_PRECISION,
      policyThreshold: (
        baseline.policy.precisionTargets as readonly Record<string, unknown>[]
      ).find((entry) => entry.targetPrecision === TARGET_PRECISION)?.threshold,
    },
    resourceLimits: {
      maxNodeHeapMiB: 4096,
      maxConcurrentSnapshots: 1,
      memoryFloorPercent: MEMORY_FLOOR_PERCENT,
      minimumObservedFreeMemoryPercent:
        results.minimumObservedFreeMemoryPercent,
    },
    inputs: inputHashes,
    heldOutSeals: sealMetadata,
    snapshotsVerifiedSequentially: results.verifiedSnapshots,
    summary,
    requests: results.outcomes,
  };
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  writeFileSync(outputFile, stableJson(payload));
}

function finalize(expectedRuleHash: string): void {
  const poolPath = path.join(OUTPUT_DIRECTORY, "pool-outcomes.json");
  const heldOutPath = path.join(OUTPUT_DIRECTORY, "held-out-outcomes.json");
  const classifierPath = path.join(OUTPUT_DIRECTORY, "classifier-results.json");
  for (const file of [poolPath, heldOutPath, classifierPath])
    if (!existsSync(file))
      throw new Error(`Required result is missing: ${file}`);
  const pool = readJson(poolPath) as Record<string, unknown>;
  const heldOut = readJson(heldOutPath) as Record<string, unknown>;
  const classifier = readJson(classifierPath) as Record<string, unknown>;
  const classifierScope = classifier.trainingScope as
    Record<string, unknown> | undefined;
  if (
    pool.frozenRuleSourceSha256 !== expectedRuleHash ||
    heldOut.frozenRuleSourceSha256 !== expectedRuleHash ||
    classifier.frozenRuleSourceSha256 !== expectedRuleHash ||
    classifierScope?.heldOutSplitsRead !== false ||
    expectedRuleHash !== currentRuleSourceHash()
  )
    throw new Error("Frozen rule source hash changed before finalization.");
  const existing = path.join(OUTPUT_DIRECTORY, "results.json");
  if (existsSync(existing)) throw new Error("Final results already exist.");
  const poolSummary = pool.summary as Record<string, unknown>;
  const heldOutSummary = heldOut.summary as Record<string, unknown>;
  const payload = {
    schemaVersion: 1,
    dataset: {
      directory: path.relative(ROOT_DIRECTORY, DATASET_DIRECTORY),
      poolSplits: POOL_SPLITS,
      heldOutSplits: HELD_OUT_SPLITS,
      heldOutClassification: "regression-check-only; previously seen",
    },
    frozenRuleSourceSha256: expectedRuleHash,
    heldOutRegressionRunCount: 1,
    tierABaseline: pool.tierABaseline,
    resourceLimits: {
      pool: pool.resourceLimits,
      heldOut: heldOut.resourceLimits,
    },
    inputHashes: {
      pool: pool.inputs,
      heldOut: heldOut.inputs,
    },
    pool: poolSummary,
    heldOut: heldOutSummary,
    classifier,
    perSplit: {
      ...(poolSummary.bySplit as Record<string, unknown>),
      ...(heldOutSummary.bySplit as Record<string, unknown>),
    },
    wrongCommits: [
      ...((poolSummary.wrongCommits as readonly WrongCommit[]) ?? []),
      ...((heldOutSummary.wrongCommits as readonly WrongCommit[]) ?? []),
    ],
    snapshotsVerifiedSequentially: [
      ...((pool.snapshotsVerifiedSequentially as readonly unknown[]) ?? []),
      ...((heldOut.snapshotsVerifiedSequentially as readonly unknown[]) ?? []),
    ],
  };
  writeFileSync(existing, stableJson(payload));
}

async function run(): Promise<void> {
  const { stage, expectedRuleHash } = parseStageArguments();
  if (stage === "finalize") {
    finalize(expectedRuleHash as string);
    return;
  }
  const ruleHash = currentRuleSourceHash();
  if (stage === "held-out" && expectedRuleHash !== ruleHash)
    throw new Error(
      "Frozen rule source hash does not match current query rules.",
    );
  const outputFile = path.join(
    OUTPUT_DIRECTORY,
    stage === "pool" ? "pool-outcomes.json" : "held-out-outcomes.json",
  );
  if (existsSync(outputFile))
    throw new Error(
      `${stage} stage output already exists; refusing to overwrite it.`,
    );
  const splits = stage === "pool" ? POOL_SPLITS : HELD_OUT_SPLITS;
  const sealMetadata = stage === "held-out" ? verifyHeldOutSeals() : null;
  const baselineSplits =
    stage === "pool" ? POOL_SPLITS : [...POOL_SPLITS, ...HELD_OUT_SPLITS];
  const duplicateGroups = readDuplicateGroups(
    CORPUS_MANIFEST,
    new Set(baselineSplits),
  );
  const pairs = splits.flatMap((split) =>
    readSplitPairs(split, duplicateGroups),
  );
  const poolPairs =
    stage === "pool"
      ? pairs
      : POOL_SPLITS.flatMap((split) => readSplitPairs(split, duplicateGroups));
  const groups = groupBySnapshot(pairs);
  const policyAndResponses = new Map<
    Split,
    ReturnType<typeof readP2Baseline>
  >();
  for (const split of baselineSplits)
    policyAndResponses.set(split, readP2Baseline(split));
  const poolBaselines = new Map<Split, ReturnType<typeof readP2Baseline>>(
    POOL_SPLITS.flatMap((split) => {
      const baseline = policyAndResponses.get(split);
      return baseline ? [[split, baseline] as const] : [];
    }),
  );
  const calibrators = buildP2Calibrators(poolPairs, poolBaselines);
  const results = processSnapshotGroups(
    groups,
    policyAndResponses,
    calibrators,
    ruleHash,
  );
  const inputHashes = Object.fromEntries(
    splits.flatMap((split) =>
      ["state", "labels"].map((kind) => {
        const file = path.join(DATASET_DIRECTORY, `${split}-${kind}.jsonl`);
        return [
          `${split}${kind === "state" ? "State" : "Labels"}Sha256`,
          sha256(readFileSync(file)),
        ];
      }),
    ),
  );
  for (const split of baselineSplits) {
    const baseline = policyAndResponses.get(split);
    if (!baseline)
      throw new Error(`Missing saved Tier A baseline for ${split}.`);
    inputHashes[`${split}TierAPolicySha256`] = baseline.policySha256;
    inputHashes[`${split}TierAResponsesSha256`] = baseline.responseSha256;
  }
  inputHashes.corpusManifestSha256 = sha256(readFileSync(CORPUS_MANIFEST));
  inputHashes.collectionReportSha256 = sha256(readFileSync(COLLECTION_REPORT));
  writeStageOutput(
    outputFile,
    stage,
    results,
    policyAndResponses.get("train") as ReturnType<typeof readP2Baseline>,
    ruleHash,
    sealMetadata,
    inputHashes,
  );
  process.stdout.write(
    stableJson({
      stage,
      requestCount: results.outcomes.length,
      snapshotCount: results.verifiedSnapshots.length,
      frozenRuleSourceSha256: ruleHash,
      output: path.relative(ROOT_DIRECTORY, outputFile),
      minimumObservedFreeMemoryPercent:
        results.minimumObservedFreeMemoryPercent,
    }),
  );
}

void run().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}${JSON_LINE_ENDING}`);
  process.exitCode = 1;
});
