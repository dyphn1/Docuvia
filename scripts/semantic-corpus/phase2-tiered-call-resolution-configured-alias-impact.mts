/** Complete TRAIN/CALIBRATION-only paired source replay; no ranking or policy tuning. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
  CALL_RESOLUTION_RANKING_POLICY_VERSION,
  type CallResolutionHypothesisRequest,
  type CallResolutionHypothesisWorkspaceInput,
} from "../../lib/contracts/src/index.js";
import {
  CallResolutionHypothesisService,
  type CallResolutionHypothesisWithCandidateStageTrace,
} from "../../lib/core/src/semantic/call-resolution-hypothesis.service.js";
import {
  candidateOracleTargetMapping,
  filterInputsToUniqueOracleTargets,
} from "./phase2-tiered-call-resolution-candidate-audit.mjs";
import { candidateObservationDecisionFingerprint } from "./phase2-tiered-call-resolution-candidate-stage-evidence.mjs";
import type { Phase2EvaluationObservation } from "./phase2-tiered-call-resolution-evaluation.mjs";
import {
  makeAstProcessor,
  mapCandidateKeysToUnambiguousAliases,
  processPhase2Snapshot,
  type Phase2PinnedSnapshot,
  type Phase2SnapshotSourceResult,
} from "./phase2-tiered-call-resolution-source.mjs";
import {
  allFactRows,
  canonicalHash,
  labelsForSplitIsolated,
  parseJsonlRowsForSplit,
  sha256,
  verifyPhase1SourceSidecars,
  writeJson,
  writeJsonl,
  type Phase2CorpusSource,
  type Phase2FactFile,
} from "./phase2-tiered-call-resolution-support.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE =
  "evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction";
const ALIAS_OUTPUT =
  "evaluate/results/semantic-corpus/v1/phase2-p2a-v5-configured-alias-impact";
const DEFAULT_IMPORT_OUTPUT =
  "evaluate/results/semantic-corpus/v1/phase2-p2a-v6-default-import-impact";
const ALIAS_REPLAY = `${ALIAS_OUTPUT}/configured-alias-paired-replay.jsonl`;
const ALIAS_REPLAY_SHA256 =
  "c1147a42d82855d50c59e8ddd2a2215d91c58de805536d3dcce51e232c0cbc64";
const PINS = {
  predictionManifest:
    "de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e",
  predictions:
    "6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622",
  replayManifest:
    "3c276df3fbc46b6c53d6987257e1bc030ec3e5adee1ff6b065feccbcf1b1c809",
  callsites: "b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362",
  facts: "ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e",
  corpusSpec:
    "867b96f393be018c7552036b18d8164d8fcdd9f21fe8d3a2f100d674fd64e69a",
  collectionReport:
    "159413d22bee7c14f0e76e510e06d7110f897732f4e6413653a4c37b80938c14",
  train: {
    count: 13496,
    ids: "83d1f36810abcb10306b15d2579afa4e113419f91a45c0fa59aab704aa6b20b6",
    labels: "4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a",
  },
  calibration: {
    count: 2966,
    ids: "c95b92a9d5cd284250cdfaf178b990b77b59cf6d60b81e5068a2c7c573fe76c9",
    labels: "5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426",
  },
} as const;
type Split = "train" | "calibration";
type CorpusSplit = Split | "test" | "temporal";

export function assertFeaturePopulation(
  rows: readonly { sampleId: string; split: string }[],
  split: Split,
  ids: ReadonlySet<string>,
): void {
  if (
    (split !== "train" && split !== "calibration") ||
    rows.some((row) => row.split !== split)
  )
    throw new Error(
      "Feature impact requires TRAIN/CALIBRATION-only isolated rows.",
    );
  if (
    rows.length !== ids.size ||
    new Set(rows.map((row) => row.sampleId)).size !== rows.length ||
    rows.some((row) => !ids.has(row.sampleId))
  )
    throw new Error("Feature impact requires complete unique sample IDs.");
}

interface CandidateSetRow {
  readonly keys: readonly string[];
  readonly mapped: readonly (string | null)[];
  readonly gold: readonly string[];
}
function distribution(sizes: readonly number[]) {
  const sorted = [...sizes].sort((a, b) => a - b);
  const frequency: Record<string, number> = {};
  for (const size of sorted) frequency[size] = (frequency[size] ?? 0) + 1;
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? 0,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
    max: sorted.at(-1) ?? 0,
    frequency,
  };
}
export function measureFeatureCandidateSets(rows: readonly CandidateSetRow[]) {
  if (rows.some((row) => row.keys.length !== row.mapped.length))
    throw new Error(
      "Feature measurement requires one mapping per candidate key.",
    );
  const sets = rows.map((row) => ({
    keys: row.keys.length,
    mapped: new Set(row.mapped.filter((id): id is string => id !== null)),
    gold: row.gold,
  }));
  const goldTargetOccurrences = sets.reduce((n, row) => n + row.gold.length, 0);
  const coveredGoldTargetOccurrences = sets.reduce(
    (n, row) => n + row.gold.filter((id) => row.mapped.has(id)).length,
    0,
  );
  return {
    allSiteCount: rows.length,
    goldTargetOccurrences,
    coveredGoldTargetOccurrences,
    candidateRecall:
      goldTargetOccurrences === 0
        ? null
        : coveredGoldTargetOccurrences / goldTargetOccurrences,
    unscorableSiteCount: sets.filter((row) => row.gold.length === 0).length,
    keyMemberships: sets.reduce((n, row) => n + row.keys, 0),
    mappedMemberships: sets.reduce((n, row) => n + row.mapped.size, 0),
    keyZeroSites: sets.filter((row) => row.keys === 0).length,
    mappedZeroSites: sets.filter((row) => row.mapped.size === 0).length,
    keySize: distribution(sets.map((row) => row.keys)),
    mappedSize: distribution(sets.map((row) => row.mapped.size)),
  };
}
function pinnedBytes(file: string, expected: string): Buffer {
  const bytes = readFileSync(path.join(ROOT, file));
  if (sha256(bytes) !== expected)
    throw new Error(`Pinned source input changed: ${file}.`);
  return bytes;
}
function requestKey(
  file: string,
  line: number,
  column: number,
  calleeName: string,
) {
  return JSON.stringify([file, line, column, calleeName]);
}
class FeatureTraceService extends CallResolutionHypothesisService {
  readonly calls = new Map<
    string,
    {
      request: CallResolutionHypothesisRequest;
      traced: CallResolutionHypothesisWithCandidateStageTrace;
    }
  >();
  configurationEvidence: CallResolutionHypothesisWorkspaceInput["configuredPathAliases"];
  override indexWorkspace(input: CallResolutionHypothesisWorkspaceInput) {
    this.configurationEvidence = input.configuredPathAliases;
    return super.indexWorkspace(input);
  }
  override hypothesize(request: CallResolutionHypothesisRequest) {
    const traced = this.hypothesizeWithCandidateStageTrace(request);
    const key = requestKey(
      request.callerFilePath,
      request.callSite.startLine,
      request.callSite.startColumn,
      request.callSite.calleeName,
    );
    const previous = this.calls.get(key);
    if (previous && canonicalHash(previous.traced) !== canonicalHash(traced))
      throw new Error("Repeated exact source request changed its trace.");
    this.calls.set(key, { request, traced });
    return traced.result;
  }
}
function keyMapper(facts: readonly Phase2FactFile[]) {
  const cache = new Map<string, string | null>();
  return (key: string): string | null => {
    if (cache.has(key)) return cache.get(key)!;
    const mapped = mapCandidateKeysToUnambiguousAliases([key], facts);
    const id =
      mapped.aliases.length === 1 &&
      mapped.ambiguous === 0 &&
      mapped.unmapped === 0
        ? mapped.aliases[0]!
        : null;
    cache.set(key, id);
    return id;
  };
}
function capturedEvidence(
  captured: FeatureTraceService["calls"] extends Map<string, infer V>
    ? V | undefined
    : never,
  mapKey: (key: string) => string | null,
) {
  const rawKeys = captured?.traced.result.generatedCandidateKeys ?? [];
  const proposalKeys =
    captured?.traced.candidateStageTrace.afterMaxCandidates ?? [];
  return {
    rawKeys,
    rawMapped: rawKeys.map(mapKey),
    proposalKeys,
    proposalMapped: proposalKeys.map(mapKey),
    sourceContentHash: captured?.request.callerSourceContentHash ?? null,
    callSiteInputHash: captured ? canonicalHash(captured.request) : null,
    featureInputHash: captured?.traced.result.featureInputHash ?? null,
    sourceFingerprint:
      captured?.request.workspaceIndex.sourceFingerprint ?? null,
    callSiteFact: captured?.request.callSite ?? null,
    reason: captured?.traced.result.reason ?? "source-position-excluded",
    status: captured?.traced.result.status ?? null,
    selectedTargetKey: captured?.traced.result.selected?.targetKey ?? null,
    strictProofStatus: captured?.traced.result.strictProof.status ?? null,
  };
}
function evidenceKind(captured: ReturnType<typeof capturedEvidence>) {
  const fact = captured.callSiteFact;
  if (!fact) return "source-position-excluded";
  if (fact.calleeKind === "bare")
    return `callee-${fact.calleeBinding?.kind ?? "none"}`;
  if (fact.calleeKind === "this") return "receiver-this";
  return `receiver-${fact.receiverBinding?.kind ?? "unbound"}-${fact.peerMemberNames.length ? "with-peers" : "without-peers"}`;
}
type ReplayRow = {
  sampleId: string;
  split: CorpusSplit;
  repoFamily: string;
  calleeKind: string;
  evidenceKind: string;
  source: Phase2CorpusSource;
  baseline: ReturnType<typeof capturedEvidence>;
  feature: ReturnType<typeof capturedEvidence>;
};
function memberships(before: readonly string[], after: readonly string[]) {
  const beforeSet = new Set(before),
    afterSet = new Set(after);
  return {
    added: after.filter((key) => !beforeSet.has(key)),
    removed: before.filter((key) => !afterSet.has(key)),
    existingOrderPreserved:
      JSON.stringify(before.filter((key) => afterSet.has(key))) ===
      JSON.stringify(after.filter((key) => beforeSet.has(key))),
  };
}

async function run(): Promise<void> {
  const defaultImportMode =
    process.argv.length === 3 && process.argv[2] === "--default-import";
  if (
    process.argv.length !== (defaultImportMode ? 3 : 2) ||
    (process.argv.length === 3 && !defaultImportMode)
  )
    throw new Error(
      "Runner accepts only the optional --default-import mode; split/path overrides are forbidden.",
    );
  const output = defaultImportMode ? DEFAULT_IMPORT_OUTPUT : ALIAS_OUTPUT;
  const manifest = JSON.parse(
    pinnedBytes(
      `${SOURCE}/candidate-prediction-manifest.json`,
      PINS.predictionManifest,
    ).toString("utf8"),
  );
  const priorReplay = JSON.parse(
    pinnedBytes(
      "docs/gitbook/analysis/tiered-call-resolution-phase2-p2a-proposal-filter-stage-train-evidence/proposal-filter-stage-replay-manifest.json",
      PINS.replayManifest,
    ).toString("utf8"),
  );
  if (
    manifest.labelsRead !== false ||
    manifest.candidateGeneratorVersion !== "declared-member-hypothesis-v4" ||
    manifest.candidateOracleMappingScope !== "snapshotId+repoId" ||
    manifest.splitCounts.train !== PINS.train.count ||
    manifest.splitCounts.calibration !== PINS.calibration.count
  )
    throw new Error("Expected source-only pinned v4 population differs.");
  const sliceA = defaultImportMode
    ? JSON.parse(
        readFileSync(
          path.join(
            ROOT,
            `${ALIAS_OUTPUT}/configured-alias-impact-summary.json`,
          ),
          "utf8",
        ),
      )
    : null;
  const implementationBase = defaultImportMode
    ? sliceA.implementationFiles
    : priorReplay.replay.implementationFiles;
  const implementationFiles = Object.fromEntries(
    [
      ...new Set([
        ...Object.keys(implementationBase),
        "lib/contracts/src/index.ts",
        ...(defaultImportMode
          ? [
              "lib/contracts/src/interfaces/ast.interfaces.ts",
              "lib/ast-core/src/core/edge-computer.ts",
              "lib/core/src/ast/ast-worker.ts",
              "lib/core/src/ast/declared-type-facts.ts",
            ]
          : []),
      ]),
    ].map((file) => [file, sha256(readFileSync(path.join(ROOT, file)))]),
  );
  const changedImplementationPaths = Object.keys(implementationFiles).filter(
    (file) => implementationFiles[file] !== implementationBase[file],
  );
  const allowedChanges = new Set(
    defaultImportMode
      ? [
          "lib/contracts/src/interfaces/ast.interfaces.ts",
          "lib/contracts/src/interfaces/call-resolution-hypothesis.interfaces.ts",
          "lib/contracts/src/index.ts",
          "lib/ast-core/src/core/edge-computer.ts",
          "lib/core/src/ast/ast-worker.ts",
          "lib/core/src/ast/declared-type-facts.ts",
          "lib/core/src/semantic/call-resolution-hypothesis-index.ts",
          "scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts",
        ]
      : [
          "lib/contracts/src/interfaces/call-resolution-hypothesis.interfaces.ts",
          "lib/contracts/src/index.ts",
          "lib/core/src/semantic/call-resolution-hypothesis-index.ts",
          "scripts/semantic-corpus/phase2-tiered-call-resolution-source.mts",
        ],
  );
  if (changedImplementationPaths.some((file) => !allowedChanges.has(file)))
    throw new Error(
      "The feature changed an implementation outside its pinned contract/index/source boundary.",
    );
  const sourceHashes = verifyPhase1SourceSidecars();
  if (
    sourceHashes["callsites.jsonl"] !== PINS.callsites ||
    sourceHashes["declared-type-facts-pass-a.jsonl"] !== PINS.facts
  )
    throw new Error("Pinned source/fact provenance differs.");
  const predictionLines = pinnedBytes(
    `${SOURCE}/predictions.jsonl`,
    PINS.predictions,
  )
    .toString("utf8")
    .split(/\r?\n/u);
  const sourceLines = pinnedBytes(
    "evaluate/results/semantic-corpus/v1/phase1-tiered-call-resolution-run-1/callsites.jsonl",
    PINS.callsites,
  )
    .toString("utf8")
    .split(/\r?\n/u);
  const predictions: Record<CorpusSplit, Phase2EvaluationObservation[]> = {
    train: [],
    calibration: [],
    test: [],
    temporal: [],
  };
  const sources: Record<CorpusSplit, Phase2CorpusSource[]> = {
    train: [],
    calibration: [],
    test: [],
    temporal: [],
  };
  const ids: Record<Split, Set<string>> = {
    train: new Set(),
    calibration: new Set(),
  };
  const sourceSplits: readonly CorpusSplit[] = defaultImportMode
    ? ["train", "calibration", "test", "temporal"]
    : ["train", "calibration"];
  for (const split of sourceSplits) {
    predictions[split] = parseJsonlRowsForSplit<Phase2EvaluationObservation>(
      predictionLines,
      split,
    ).sort((a, b) => a.sampleId.localeCompare(b.sampleId));
    sources[split] = parseJsonlRowsForSplit<Phase2CorpusSource>(
      sourceLines,
      split,
    ).sort((a, b) => a.sampleId.localeCompare(b.sampleId));
    const splitIds = new Set(predictions[split].map((row) => row.sampleId));
    if (
      splitIds.size !== predictions[split].length ||
      sources[split].length !== predictions[split].length ||
      new Set(sources[split].map((row) => row.sampleId)).size !==
        splitIds.size ||
      sources[split].some((row) => !splitIds.has(row.sampleId)) ||
      predictions[split].some((row) => row.split !== split)
    )
      throw new Error(
        `Complete unique ${split} source-only population changed.`,
      );
    if (split === "train" || split === "calibration") {
      ids[split] = splitIds;
      assertFeaturePopulation(predictions[split], split, ids[split]);
      assertFeaturePopulation(sources[split], split, ids[split]);
      if (
        ids[split].size !== PINS[split].count ||
        canonicalHash(
          split === "train"
            ? [...ids[split]].sort((a, b) => a.localeCompare(b))
            : [...ids[split]].sort(),
        ) !== PINS[split].ids
      )
        throw new Error(`Complete ${split} population changed.`);
    } else if (splitIds.size !== manifest.splitCounts[split]) {
      throw new Error(`Complete ${split} source-only population changed.`);
    }
  }
  const specification = JSON.parse(
    pinnedBytes(
      "evaluate/semantic-corpus/corpus-spec.v1.json",
      PINS.corpusSpec,
    ).toString("utf8"),
  );
  const collection = JSON.parse(
    pinnedBytes(
      "evaluate/results/semantic-corpus/v1/run-c/collection-report.json",
      PINS.collectionReport,
    ).toString("utf8"),
  );
  const allSources = [
    ...sources.train,
    ...sources.calibration,
    ...sources.test,
    ...sources.temporal,
  ];
  if (
    defaultImportMode &&
    (allSources.length !== manifest.predictionRows ||
      new Set(allSources.map((source) => source.sampleId)).size !==
        allSources.length)
  )
    throw new Error(
      "Expected the complete 31,578 source-only corpus population.",
    );
  const allPredictions = [
    ...predictions.train,
    ...predictions.calibration,
    ...predictions.test,
    ...predictions.temporal,
  ];
  const pinnedAliasRows = new Map<string, ReplayRow>();
  if (defaultImportMode) {
    const priorBytes = readFileSync(path.join(ROOT, ALIAS_REPLAY));
    if (sha256(priorBytes) !== ALIAS_REPLAY_SHA256)
      throw new Error("Pinned Slice A source-only replay changed.");
    for (const line of priorBytes.toString("utf8").split(/\r?\n/u)) {
      if (!line) continue;
      const row = JSON.parse(line) as ReplayRow;
      if (pinnedAliasRows.has(row.sampleId))
        throw new Error("Pinned Slice A replay contains duplicate sample IDs.");
      pinnedAliasRows.set(row.sampleId, row);
    }
    for (const split of ["train", "calibration"] as const) {
      const priorRows = [...pinnedAliasRows.values()].filter(
        (row) => row.split === split,
      );
      assertFeaturePopulation(priorRows, split, ids[split]);
    }
  }
  const selectedSnapshots = new Set(
    allSources.map((source) => source.snapshotId),
  );
  const snapshots: Phase2PinnedSnapshot[] = collection.snapshots
    .filter((snapshot: { snapshotId: string }) =>
      selectedSnapshots.has(snapshot.snapshotId),
    )
    .map((snapshot: Phase2PinnedSnapshot) => {
      const spec = specification.snapshots.find(
        (item: { snapshotId: string }) =>
          item.snapshotId === snapshot.snapshotId,
      );
      if (!spec || spec.subtree !== snapshot.subtree)
        throw new Error("Pinned source snapshot spec differs.");
      return {
        snapshotId: snapshot.snapshotId,
        repoId: snapshot.repoId,
        revision: snapshot.revision,
        subtree: snapshot.subtree,
        snapshotHash: snapshot.snapshotHash,
        sourceDir: spec.sourceDir,
      };
    });
  if (snapshots.length !== selectedSnapshots.size)
    throw new Error("Source snapshots incomplete.");
  const facts = allFactRows().filter((fact) =>
    selectedSnapshots.has(fact.snapshotId),
  );
  const configurationHash =
    new CallResolutionHypothesisService().indexWorkspace({
      sourceFingerprint: "0".repeat(64),
      sourceIndexComplete: false,
      sourceFiles: [],
    }).configurationHash;
  const byPinned = new Map(allPredictions.map((row) => [row.sampleId, row]));
  const replayRows: ReplayRow[] = [],
    snapshotEvidence: Record<string, unknown>[] = [];
  const tempRoot = mkdtempSync(
    path.join(
      tmpdir(),
      defaultImportMode ? "docuvia-v6-default-" : "docuvia-v5-alias-",
    ),
  );
  try {
    for (const snapshot of snapshots) {
      const snapshotSources = allSources.filter(
        (source) => source.snapshotId === snapshot.snapshotId,
      );
      const snapshotFacts = facts.filter(
        (fact) =>
          fact.snapshotId === snapshot.snapshotId &&
          fact.repoId === snapshot.repoId,
      );
      const services = [
        new FeatureTraceService(),
        new FeatureTraceService(),
      ] as const;
      const results: Phase2SnapshotSourceResult[] = [];
      for (const [index, service] of services.entries()) {
        process.stdout.write(
          `[${defaultImportMode ? "default-import" : "configured-alias"}] ${index === 0 ? (defaultImportMode ? "slice-a-baseline" : "baseline") : "feature"} ${snapshot.snapshotId}\n`,
        );
        const result = await processPhase2Snapshot({
          snapshot,
          repositoriesDirectory: path.resolve(ROOT, ".."),
          temporaryDirectory: path.join(tempRoot, snapshot.snapshotId),
          sourceRows: snapshotSources,
          factRows: snapshotFacts,
          service,
          processor: makeAstProcessor(),
          factsSidecarHash: PINS.facts,
          includeConfiguredPathAliases: defaultImportMode || index === 1,
          includeCombinedDefaultImportTargets: defaultImportMode && index === 1,
        });
        if (
          result.snapshotHash !== snapshot.snapshotHash ||
          result.configurationHash !== configurationHash ||
          result.parseFailureCount !== 0
        )
          throw new Error("Paired source/configuration provenance differs.");
        results.push(result);
      }
      if (!defaultImportMode) {
        const pinnedFingerprint = manifest.sourceFingerprints.find(
          (item: { snapshotId: string }) =>
            item.snapshotId === snapshot.snapshotId,
        );
        if (
          results[0]!.sourceFingerprint !== pinnedFingerprint?.sourceFingerprint
        )
          throw new Error(
            "No-config source fingerprint differs from pinned v4.",
          );
      }
      const baselineObservations = new Map(
        results[0]!.observations.map((row) => [row.sampleId, row]),
      );
      const mapKey = keyMapper(snapshotFacts);
      for (const source of snapshotSources) {
        const pinned = byPinned.get(source.sampleId)!,
          baselineObservation = baselineObservations.get(source.sampleId)!;
        // Slice A intentionally changes rule signatures; every remaining no-config decision field reproduces v4.
        if (
          !defaultImportMode &&
          candidateObservationDecisionFingerprint(pinned) !==
            candidateObservationDecisionFingerprint({
              ...baselineObservation,
              ruleSignature: pinned.ruleSignature,
            })
        )
          throw new Error(`No-config v4 decision changed: ${source.sampleId}.`);
        const captures = services.map((service) =>
          service.calls.get(
            requestKey(
              source.filePath,
              source.line,
              source.column,
              source.calleeName ?? "",
            ),
          ),
        );
        if (
          source.positionStatus === "unique" &&
          captures.some((capture) => !capture)
        )
          throw new Error(`Exact parser request missing: ${source.sampleId}.`);
        if (source.positionStatus !== "unique" && captures.some(Boolean))
          throw new Error("Replay eligibility gate unexpectedly bypassed.");
        const [baseline, feature] = captures.map((capture) =>
          capturedEvidence(capture, mapKey),
        );
        if (
          defaultImportMode &&
          (source.split === "train" || source.split === "calibration")
        ) {
          const prior = pinnedAliasRows.get(source.sampleId);
          if (
            !prior ||
            canonicalHash(prior.source) !== canonicalHash(source) ||
            canonicalHash(prior.feature.rawKeys) !==
              canonicalHash(baseline!.rawKeys) ||
            canonicalHash(prior.feature.proposalKeys) !==
              canonicalHash(baseline!.proposalKeys)
          )
            throw new Error(
              `Current Slice A baseline differs from its pinned replay: ${source.sampleId}.`,
            );
        }
        const rawDelta = memberships(baseline!.rawKeys, feature!.rawKeys),
          proposalDelta = memberships(
            baseline!.proposalKeys,
            feature!.proposalKeys,
          );
        if (
          !rawDelta.existingOrderPreserved ||
          !proposalDelta.existingOrderPreserved
        )
          throw new Error(
            "Existing candidate order or raw memberships changed.",
          );
        replayRows.push({
          sampleId: source.sampleId,
          split: source.split as CorpusSplit,
          repoFamily: source.repoFamily,
          calleeKind: baselineObservation.calleeKind ?? "unmapped",
          evidenceKind: evidenceKind(baseline!),
          source,
          baseline: baseline!,
          feature: feature!,
        });
      }
      snapshotEvidence.push({
        ...snapshot,
        configurationEvidence: services[1].configurationEvidence ?? null,
        baselineSourceFingerprint: results[0]!.sourceFingerprint,
        featureSourceFingerprint: results[1]!.sourceFingerprint,
        baselineParsedImportTargets: results[0]!.parsedImportTargetFileCount,
        featureParsedImportTargets: results[1]!.parsedImportTargetFileCount,
        parseFailureCount: 0,
        rowCount: snapshotSources.length,
      });
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  replayRows.sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  const splitResults: Record<string, unknown> = {};
  for (const split of ["train", "calibration"] as const) {
    const rows = replayRows.filter((row) => row.split === split);
    assertFeaturePopulation(rows, split, ids[split]);
    const excluded = rows.filter(
      (row) => row.source.positionStatus !== "unique",
    );
    if (
      excluded.length !== (split === "train" ? 7 : 0) ||
      rows.some(
        (row) =>
          row.source.positionStatus === "unique" &&
          (!row.baseline.callSiteFact ||
            !row.feature.callSiteFact ||
            !row.baseline.sourceContentHash ||
            !row.feature.sourceContentHash),
      )
    )
      throw new Error("Pinned replay parser/eligibility boundary changed.");
    // Isolated label loading occurs only after all source populations and paired baseline decisions are verified.
    const labels = await labelsForSplitIsolated(split, ids[split]);
    assertFeaturePopulation(labels, split, ids[split]);
    const labelRowsHash = canonicalHash(
      [...labels].sort((a, b) => a.sampleId.localeCompare(b.sampleId)),
    );
    if (labelRowsHash !== PINS[split].labels)
      throw new Error(`Isolated ${split} label hash changed.`);
    const unique = filterInputsToUniqueOracleTargets(
      predictions[split],
      labels,
      candidateOracleTargetMapping(facts),
    );
    const goldById = new Map(
      unique.labels.map((row) => [
        row.sampleId,
        row.reviewStatus === "confirmed" ? row.positiveTargetIds : [],
      ]),
    );
    const measure = (
      group: readonly ReplayRow[],
      variant: "baseline" | "feature",
      stage: "raw" | "proposal",
    ) =>
      measureFeatureCandidateSets(
        group.map((row) => ({
          keys:
            stage === "raw" ? row[variant].rawKeys : row[variant].proposalKeys,
          mapped:
            stage === "raw"
              ? row[variant].rawMapped
              : row[variant].proposalMapped,
          gold: goldById.get(row.sampleId)!,
        })),
      );
    const aggregate = (group: readonly ReplayRow[]) => ({
      baseline: {
        raw: measure(group, "baseline", "raw"),
        proposal: measure(group, "baseline", "proposal"),
      },
      feature: {
        raw: measure(group, "feature", "raw"),
        proposal: measure(group, "feature", "proposal"),
      },
    });
    const groups = new Map<string, ReplayRow[]>();
    for (const row of rows) {
      const key = `${row.repoFamily}|${row.calleeKind}|${row.evidenceKind}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const changedRows = rows.flatMap((row) => {
      const raw = memberships(row.baseline.rawKeys, row.feature.rawKeys),
        proposal = memberships(
          row.baseline.proposalKeys,
          row.feature.proposalKeys,
        );
      if (
        !raw.added.length &&
        !proposal.added.length &&
        !proposal.removed.length
      )
        return [];
      const gold = goldById.get(row.sampleId)!;
      const addedGoldRaw = gold.filter(
        (id) =>
          !row.baseline.rawMapped.includes(id) &&
          row.feature.rawMapped.includes(id),
      );
      const addedGoldProposal = gold.filter(
        (id) =>
          !row.baseline.proposalMapped.includes(id) &&
          row.feature.proposalMapped.includes(id),
      );
      const removedGoldProposal = gold.filter(
        (id) =>
          row.baseline.proposalMapped.includes(id) &&
          !row.feature.proposalMapped.includes(id),
      );
      return [
        {
          sampleId: row.sampleId,
          repoFamily: row.repoFamily,
          calleeKind: row.calleeKind,
          evidenceKind: row.evidenceKind,
          source: {
            filePath: row.source.filePath,
            line: row.source.line,
            column: row.source.column,
            calleeName: row.source.calleeName,
          },
          sourceContentHash: row.feature.sourceContentHash,
          callSiteInputHash: row.feature.callSiteInputHash,
          baselineFeatureInputHash: row.baseline.featureInputHash,
          featureInputHash: row.feature.featureInputHash,
          raw,
          proposal,
          addedGoldRaw,
          addedGoldProposal,
          removedGoldProposal,
          baselineSizes: {
            raw: row.baseline.rawKeys.length,
            proposal: row.baseline.proposalKeys.length,
          },
          featureSizes: {
            raw: row.feature.rawKeys.length,
            proposal: row.feature.proposalKeys.length,
          },
          featureOutcome: {
            status: row.feature.status,
            reason: row.feature.reason,
            selectedTargetKey: row.feature.selectedTargetKey,
            strictProofStatus: row.feature.strictProofStatus,
          },
        },
      ];
    });
    const targetRows =
      defaultImportMode && split === "calibration"
        ? rows.filter(
            (row) =>
              row.source.filePath ===
                "src/app/report/[scan_id]/page.test.tsx" &&
              [111, 128, 150].includes(row.source.line) &&
              row.source.calleeName === "ReportPage",
          )
        : [];
    if (defaultImportMode && split === "calibration") {
      if (targetRows.length !== 3)
        throw new Error(
          "Expected the three audited CALIBRATION default-import rows.",
        );
      for (const row of targetRows) {
        const gold = goldById.get(row.sampleId) ?? [];
        if (
          gold.length !== 1 ||
          row.baseline.rawMapped.includes(gold[0]!) ||
          row.baseline.proposalMapped.includes(gold[0]!) ||
          !row.feature.rawMapped.includes(gold[0]!) ||
          !row.feature.proposalMapped.includes(gold[0]!)
        )
          throw new Error(
            `Audited default-import row did not gain its unique gold candidate: ${row.sampleId}.`,
          );
      }
    }
    splitResults[split] = {
      sampleIdsHash: PINS[split].ids,
      labelRowsHash,
      sourcePositionExcludedCount: excluded.length,
      sourcePositionExcludedIdsHash: canonicalHash(
        excluded.map((row) => row.sampleId).sort(),
      ),
      exactParserFactCount: rows.length - excluded.length,
      parserFactMissingCount: 0,
      allNoConfigDecisionFieldsExceptVersionedRuleSignatureEquivalent: true,
      allExistingCandidateOrderPreserved: true,
      ...aggregate(rows),
      byFamilyCallShapeEvidence: [...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, group]) => ({ name, ...aggregate(group) })),
      changes: {
        siteCount: changedRows.length,
        rawAddedMemberships: changedRows.reduce(
          (n, row) => n + row.raw.added.length,
          0,
        ),
        rawRemovedMemberships: 0,
        proposalAddedMemberships: changedRows.reduce(
          (n, row) => n + row.proposal.added.length,
          0,
        ),
        proposalRemovedMemberships: changedRows.reduce(
          (n, row) => n + row.proposal.removed.length,
          0,
        ),
        addedGoldRaw: changedRows.reduce(
          (n, row) => n + row.addedGoldRaw.length,
          0,
        ),
        addedGoldProposal: changedRows.reduce(
          (n, row) => n + row.addedGoldProposal.length,
          0,
        ),
        removedGoldProposal: changedRows.reduce(
          (n, row) => n + row.removedGoldProposal.length,
          0,
        ),
      },
      ...(defaultImportMode && split === "calibration"
        ? {
            auditedDefaultImportRows: targetRows.map((row) => ({
              sampleId: row.sampleId,
              source: {
                filePath: row.source.filePath,
                line: row.source.line,
                column: row.source.column,
                calleeName: row.source.calleeName,
              },
              goldTargetKey: goldById.get(row.sampleId)?.[0] ?? null,
              baselineHasGoldRaw: false,
              baselineHasGoldProposal: false,
              featureHasGoldRaw: true,
              featureHasGoldProposal: true,
              featureCandidateKeyCount: row.feature.rawKeys.length,
              featureProposalKeyCount: row.feature.proposalKeys.length,
              featureCallBinding:
                row.feature.callSiteFact?.calleeBinding ?? null,
            })),
          }
        : {}),
      changedRows,
    };
  }
  const allMembershipChanges = (rows: readonly ReplayRow[]) => {
    const deltas = rows.map((row) => ({
      raw: memberships(row.baseline.rawKeys, row.feature.rawKeys),
      proposal: memberships(
        row.baseline.proposalKeys,
        row.feature.proposalKeys,
      ),
    }));
    return {
      rowsCompared: rows.length,
      changedRows: deltas.filter(
        ({ raw, proposal }) =>
          raw.added.length +
            raw.removed.length +
            proposal.added.length +
            proposal.removed.length >
          0,
      ).length,
      rawAdded: deltas.reduce((count, { raw }) => count + raw.added.length, 0),
      rawRemoved: deltas.reduce(
        (count, { raw }) => count + raw.removed.length,
        0,
      ),
      proposalAdded: deltas.reduce(
        (count, { proposal }) => count + proposal.added.length,
        0,
      ),
      proposalRemoved: deltas.reduce(
        (count, { proposal }) => count + proposal.removed.length,
        0,
      ),
    };
  };
  const replayFile = path.join(
    ROOT,
    output,
    defaultImportMode
      ? "default-import-paired-replay.jsonl"
      : "configured-alias-paired-replay.jsonl",
  );
  writeJsonl(replayFile, replayRows);
  const summaryFile = path.join(
    ROOT,
    output,
    defaultImportMode
      ? "default-import-impact-summary.json"
      : "configured-alias-impact-summary.json",
  );
  writeJson(summaryFile, {
    schemaVersion: 1,
    measurement: defaultImportMode
      ? "phase2-p2a-v6-default-import-impact/1"
      : "phase2-p2a-v5-configured-alias-impact/1",
    dataBoundary: {
      labelSplits: ["train", "calibration"],
      labelLoader: "labelsForSplitIsolated",
      heldoutLabelsRead: false,
      systemOneArtifactsRead: false,
      runCCorpusManifestRead: false,
      allSitesDenominator: true,
      unscorableAndExcludedRowsRetained: true,
      trainSevenDirectCapabilityRowsNotMerged: true,
      ...(defaultImportMode
        ? {
            sourceOnlyRowsCompared: replayRows.length,
            sourceOnlySplitCounts: {
              train: predictions.train.length,
              calibration: predictions.calibration.length,
              test: predictions.test.length,
              temporal: predictions.temporal.length,
            },
            sourceOnlyMembershipChanges: allMembershipChanges(replayRows),
            baselineSliceAReplaySha256: ALIAS_REPLAY_SHA256,
          }
        : {}),
    },
    candidateGeneratorVersion: CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION,
    rankingPolicyVersion: CALL_RESOLUTION_RANKING_POLICY_VERSION,
    configurationHash,
    pinnedV4ConfigurationHash: manifest.configurationHash,
    configurationIdentityChangedOnlyByGeneratorVersion: true,
    maxCandidates: 25,
    policyChanged: false,
    sourcePins: PINS,
    implementationFiles,
    implementationHash: canonicalHash(implementationFiles),
    runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    changedImplementationPaths,
    snapshots: snapshotEvidence,
    replay: {
      path:
        output +
        (defaultImportMode
          ? "/default-import-paired-replay.jsonl"
          : "/configured-alias-paired-replay.jsonl"),
      sha256: sha256(readFileSync(replayFile)),
      rows: replayRows.length,
    },
    splits: splitResults,
  });
  if (defaultImportMode)
    writeJson(path.join(ROOT, output, "default-import-impact-artifacts.json"), {
      summaryPath: output + "/default-import-impact-summary.json",
      summarySha256: sha256(readFileSync(summaryFile)),
      replayPath: output + "/default-import-paired-replay.jsonl",
      replaySha256: sha256(readFileSync(replayFile)),
      pinnedSliceAReplaySha256: ALIAS_REPLAY_SHA256,
    });
  process.stdout.write(
    `[${defaultImportMode ? "default-import" : "configured-alias"}] completed ${replayRows.length} source-only rows\n`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await run();
